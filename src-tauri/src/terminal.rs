//! Integrated terminal (PTY).
//!
//! Every tab gets its own pseudo-terminal. The renderer keeps one session per
//! tab and can switch between them.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;

use crate::process::{find_executable, home_dir};

#[derive(Default)]
pub struct TerminalState {
    pub inner: Mutex<HashMap<String, TerminalSession>>,
    pub active: Mutex<String>,
    pub token: AtomicU64,
}

struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send>,
    marker: String,
    cwd: String,
    shell: String,
    label: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalStartResult {
    pub id: String,
    pub ok: bool,
    pub cwd: String,
    pub shell: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalWriteRequest {
    pub session_id: String,
    pub text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalListItem {
    pub id: String,
    pub label: String,
    pub cwd: String,
    pub shell: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalEvent {
    #[serde(rename = "type")]
    kind: String,
    #[serde(rename = "sessionId")]
    session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<i32>,
}

#[derive(Clone)]
struct ShellSpec {
    cmd: String,
    args: Vec<String>,
    kind_name: String,
}

fn pick_shell() -> ShellSpec {
    #[cfg(windows)]
    {
        if let Some(program) = find_executable("powershell").or_else(|| find_executable("pwsh")) {
            return ShellSpec {
                cmd: program.to_string_lossy().to_string(),
                args: vec!["-NoLogo".to_string(), "-NoProfile".to_string()],
                kind_name: "powershell".to_string(),
            };
        }
        ShellSpec {
            cmd: "cmd.exe".to_string(),
            args: vec!["/Q".to_string()],
            kind_name: "cmd".to_string(),
        }
    }

    #[cfg(not(windows))]
    {
        let bash = find_executable("bash");
        ShellSpec {
            cmd: bash
                .as_ref()
                .map(|path| path.to_string_lossy().to_string())
                .unwrap_or_else(|| "/bin/sh".to_string()),
            args: if bash.is_some() {
                vec!["--norc".to_string(), "--noprofile".to_string()]
            } else {
                Vec::new()
            },
            kind_name: "bash".to_string(),
        }
    }
}

fn emit(app: &AppHandle, kind: &str, session_id: &str, text: Option<String>, code: Option<i32>) {
    let _ = app.emit(
        "terminal:output",
        TerminalEvent {
            kind: kind.to_string(),
            session_id: session_id.to_string(),
            text,
            code,
        },
    );
}

fn marker_for(kind_name: &str, token: u64) -> String {
    format!("__FLINTQODE_DONE_{}_{}_{}__", kind_name, std::process::id(), token)
}

/// Spawn a new PTY and return the session id and shell info.
async fn spawn_session(
    app: &AppHandle,
    state: &State<'_, TerminalState>,
    cwd: Option<String>,
    label: Option<String>,
) -> Result<TerminalStartResult, String> {
    let directory = working_directory(cwd);
    let spec = pick_shell();
    let token = state.token.fetch_add(1, Ordering::SeqCst) + 1;
    let session_id = format!("term-{token}");
    let marker = marker_for(&spec.kind_name, token);

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| error.to_string())?;

    let mut command = CommandBuilder::new(&spec.cmd);
    for arg in &spec.args {
        command.arg(arg);
    }
    command.cwd(&directory);

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| error.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|error| error.to_string())?;
    let writer = pair.master.take_writer().map_err(|error| error.to_string())?;

    let session = TerminalSession {
        master: pair.master,
        writer,
        child,
        marker: marker.clone(),
        cwd: directory.to_string_lossy().to_string(),
        shell: spec.cmd.clone(),
        label: label.unwrap_or_else(|| spec.kind_name.clone()),
    };

    let app_clone = app.clone();
    let marker_clone = marker;
    let session_id_clone = session_id.clone();
    std::thread::spawn(move || {
        let mut buffer = String::new();
        let mut chunk = [0u8; 4096];
        loop {
            match reader.read(&mut chunk) {
                Ok(0) => break,
                Ok(count) => {
                    buffer.push_str(&String::from_utf8_lossy(&chunk[..count]));
                    while let Some(pos) = buffer.find('\n') {
                        let line = buffer[..=pos].to_string();
                        buffer = buffer[pos + 1..].to_string();
                        let trimmed = line.trim();
                        if trimmed == marker_clone {
                            emit(&app_clone, "stdout", &session_id_clone, Some(String::new()), None);
                        } else {
                            emit(&app_clone, "stdout", &session_id_clone, Some(line), None);
                        }
                    }
                }
                Err(_) => break,
            }
        }
        if !buffer.is_empty() {
            if buffer.trim() == marker_clone {
                emit(&app_clone, "stdout", &session_id_clone, Some(String::new()), None);
            } else {
                emit(&app_clone, "stdout", &session_id_clone, Some(buffer), None);
            }
        }
        emit(&app_clone, "exit", &session_id_clone, None, None);
    });

    let result = TerminalStartResult {
        id: session_id,
        ok: true,
        cwd: session.cwd.clone(),
        shell: session.shell.clone(),
        label: session.label.clone(),
        error: None,
    };

    let mut guard = state.inner.lock().await;
    guard.insert(session_id.clone(), session);
    let mut active = state.active.lock().await;
    *active = session_id.clone();
    Ok(result)
}

#[tauri::command]
pub async fn terminal_new(
    app: AppHandle,
    state: State<'_, TerminalState>,
    cwd: Option<String>,
    label: Option<String>,
) -> Result<TerminalStartResult, String> {
    spawn_session(&app, &state, cwd, label).await
}

#[tauri::command]
pub async fn terminal_close(state: State<'_, TerminalState>, session_id: String) -> Result<bool, String> {
    let mut guard = state.inner.lock().await;
    if let Some(mut session) = guard.remove(&session_id) {
        let _ = session.child.kill();
        let _ = session.master.take_writer().map(|mut writer| writer.write_all(b"exit\r\n").is_ok());
    }
    Ok(true)
}

#[tauri::command]
pub async fn terminal_list(state: State<'_, TerminalState>) -> Result<Vec<TerminalListItem>, String> {
    let guard = state.inner.lock().await;
    Ok(guard
        .values()
        .map(|session| TerminalListItem {
            id: session.label.clone(),
            label: session.label.clone(),
            cwd: session.cwd.clone(),
            shell: session.shell.clone(),
        })
        .collect())
}

/// Legacy start: spawns a new session (keeps existing callers working).
#[tauri::command]
pub async fn terminal_start(
    app: AppHandle,
    state: State<'_, TerminalState>,
    cwd: Option<String>,
) -> Result<TerminalStartResult, String> {
    spawn_session(&app, &state, cwd, None).await
}

#[tauri::command]
pub async fn terminal_write(
    state: State<'_, TerminalState>,
    request: TerminalWriteRequest,
) -> Result<bool, String> {
    let mut guard = state.inner.lock().await;
    let Some(session) = guard.get_mut(&request.session_id) else {
        return Ok(false);
    };
    let mut payload = request.text.replace("\r\n", "\n").replace('\n', "\r\n");
    if !payload.ends_with("\r\n") {
        payload.push_str("\r\n");
    }
    let marker_line = if session.shell.contains("powershell") || session.shell.contains("pwsh") {
        format!("Write-Output \"{}\"\r\n", session.marker)
    } else {
        format!("echo {}\r\n", session.marker)
    };
    session
        .writer
        .write_all(payload.as_bytes())
        .map_err(|error| error.to_string())?;
    session
        .writer
        .write_all(marker_line.as_bytes())
        .map_err(|error| error.to_string())?;
    session.writer.flush().map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn terminal_interrupt(
    app: AppHandle,
    state: State<'_, TerminalState>,
    session_id: String,
) -> Result<bool, String> {
    let mut guard = state.inner.lock().await;
    let Some(session) = guard.get_mut(&session_id) else {
        return Ok(false);
    };
    let _ = session.writer.write_all(b"\x03");
    let _ = session.writer.flush();
    emit(&app, "stdout", &session_id, Some(String::new()), None);
    Ok(true)
}

#[tauri::command]
pub async fn terminal_stop(
    app: AppHandle,
    state: State<'_, TerminalState>,
    session_id: String,
) -> Result<bool, String> {
    let mut guard = state.inner.lock().await;
    if let Some(mut session) = guard.remove(&session_id) {
        let _ = session.child.kill();
        let _ = session.writer.write_all(b"exit\r\n");
        emit(&app, "exit", &session_id, None, None);
    }
    Ok(true)
}

#[tauri::command]
pub async fn terminal_resize(
    state: State<'_, TerminalState>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> Result<bool, String> {
    let guard = state.inner.lock().await;
    if let Some(session) = guard.get(&session_id) {
        session
            .master
            .resize(PtySize {
                rows: rows as u16,
                cols: cols as u16,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| error.to_string())?;
        return Ok(true);
    }
    Ok(false)
}

#[tauri::command]
pub async fn terminal_active(state: State<'_, TerminalState>) -> Result<String, String> {
    let active = state.active.lock().await;
    Ok(active.clone())
}

#[allow(dead_code)]
pub fn working_directory(cwd: Option<String>) -> PathBuf {
    cwd.map(PathBuf::from)
        .filter(|path| path.is_dir())
        .unwrap_or_else(home_dir)
}

#[allow(dead_code)]
fn is_directory(path: &str) -> bool {
    Path::new(path).is_dir()
}
