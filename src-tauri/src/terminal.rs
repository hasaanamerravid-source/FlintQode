//! Integrated terminal (PTY).

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;

use crate::process::{find_executable, home_dir};

#[derive(Default)]
pub struct TerminalState {
    pub inner: Mutex<Option<TerminalSession>>,
    pub token: AtomicU64,
}

struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send>,
    marker: String,
    cwd: String,
    shell: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalStartResult {
    pub ok: bool,
    pub cwd: String,
    pub shell: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalEvent {
    #[serde(rename = "type")]
    kind: String,
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
                args: vec![
                    "-NoLogo".to_string(),
                    "-NoProfile".to_string(),
                ],
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

fn emit(app: &AppHandle, kind: &str, text: Option<String>, code: Option<i32>) {
    let _ = app.emit(
        "terminal:output",
        TerminalEvent {
            kind: kind.to_string(),
            text,
            code,
        },
    );
}

#[tauri::command]
pub async fn terminal_start(
    app: AppHandle,
    state: State<'_, TerminalState>,
    cwd: Option<String>,
) -> Result<TerminalStartResult, String> {
    {
        let mut guard = state.inner.lock().await;
        if let Some(mut old) = guard.take() {
            let _ = old.child.kill();
        }
    }

    let directory = working_directory(cwd);
    let spec = pick_shell();
    let shell_name = spec.cmd.clone();
    let token = state.token.fetch_add(1, Ordering::SeqCst) + 1;
    let marker = format!("__FLINTQODE_DONE_{}_{}__", std::process::id(), token);

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
        shell: shell_name.clone(),
    };

    let app_clone = app.clone();
    let marker_clone = marker.clone();
    let shell_kind = spec.kind_name.clone();
    std::thread::spawn(move || {
        let mut buffer = String::new();
        let mut chunk = [0u8; 4096];
        loop {
            match reader.read(&mut chunk) {
                Ok(0) => break,
                Ok(count) => {
                    buffer.push_str(&String::from_utf8_lossy(&chunk[..count]));
                    // Process complete lines, keeping the trailing partial line.
                    while let Some(pos) = buffer.find('\n') {
                        let line = buffer[..=pos].to_string();
                        buffer = buffer[pos + 1..].to_string();
                        let trimmed = line.trim();
                        if trimmed == marker_clone {
                            emit(&app_clone, "stdout", Some(String::new()), None);
                        } else {
                            emit(&app_clone, "stdout", Some(line), None);
                        }
                    }
                }
                Err(_) => break,
            }
        }
        if !buffer.is_empty() {
            if buffer.trim() == marker_clone {
                emit(&app_clone, "stdout", Some(String::new()), None);
            } else {
                emit(&app_clone, "stdout", Some(buffer), None);
            }
        }
        let _ = shell_kind;
        emit(&app_clone, "exit", None, None);
    });

    let result = TerminalStartResult {
        ok: true,
        cwd: session.cwd.clone(),
        shell: session.shell.clone(),
        error: None,
    };

    let mut guard = state.inner.lock().await;
    *guard = Some(session);
    Ok(result)
}

#[tauri::command]
pub async fn terminal_write(
    state: State<'_, TerminalState>,
    text: String,
) -> Result<bool, String> {
    let mut guard = state.inner.lock().await;
    let Some(session) = guard.as_mut() else {
        return Ok(false);
    };
    let mut payload = text.replace("\r\n", "\n").replace('\n', "\r\n");
    if !payload.ends_with("\r\n") {
        payload.push_str("\r\n");
    }
    // Append a marker so the renderer learns when the command has finished.
    let marker_cmd = marker_command(&session.shell, &session.marker);
    // The shell name stored is the program path, not the kind. Infer from it.
    let marker_line = if session.shell.contains("powershell") || session.shell.contains("pwsh") {
        format!("Write-Output \"{}\"\r\n", session.marker)
    } else {
        format!("echo {}\r\n", session.marker)
    };
    let _ = marker_cmd;
    session
        .writer
        .write_all(payload.as_bytes())
        .map_err(|error| error.to_string())?;
    session
        .writer
        .write_all(marker_line.as_bytes())
        .map_err(|error| error.to_string())?;
    session
        .writer
        .flush()
        .map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn terminal_interrupt(
    app: AppHandle,
    state: State<'_, TerminalState>,
) -> Result<bool, String> {
    let mut guard = state.inner.lock().await;
    let Some(session) = guard.as_mut() else {
        return Ok(false);
    };
    let _ = session.writer.write_all(b"\x03");
    let _ = session.writer.flush();
    emit(&app, "stdout", Some(String::new()), None);
    Ok(true)
}

#[tauri::command]
pub async fn terminal_stop(
    app: AppHandle,
    state: State<'_, TerminalState>,
) -> Result<bool, String> {
    let mut guard = state.inner.lock().await;
    if let Some(mut session) = guard.take() {
        let _ = session.child.kill();
        emit(&app, "exit", None, None);
    }
    Ok(true)
}

#[tauri::command]
pub async fn terminal_resize(
    state: State<'_, TerminalState>,
    cols: u32,
    rows: u32,
) -> Result<bool, String> {
    let guard = state.inner.lock().await;
    if let Some(session) = guard.as_ref() {
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
