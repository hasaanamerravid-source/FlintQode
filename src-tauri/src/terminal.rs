//! Integrated terminal (PTY).
//!
//! Every tab gets its own pseudo-terminal. The renderer keeps one session per
//! tab and can switch between them.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};

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
    /// "bash", "cmd" or "powershell" (how the marker command is written).
    kind: String,
    /// Commands that were just written; the shell echoes them back and the
    /// reader removes that copy so the log shows each command only once.
    echoes: Arc<StdMutex<Vec<String>>>,
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
    // Accept both spellings: the renderer used to send `session_id`, and
    // older builds still do. The canonical serde name is `sessionId`.
    #[serde(alias = "session_id")]
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

/// The command that prints the completion marker.
///
/// The marker is assembled from two pieces so the line the terminal echoes
/// back (the command itself) does not contain the marker and cannot be
/// mistaken for the end of the command.
fn marker_command(kind_name: &str, marker: &str) -> String {
    let suffix = marker.trim_start_matches("__FLINTQODE");
    if kind_name.contains("powershell") || kind_name.contains("pwsh") {
        format!("Write-Output ('__FLINTQODE' + '{suffix}')")
    } else if kind_name == "cmd" {
        format!("echo __FLINTQODE^{suffix}")
    } else {
        format!("printf '__FLINTQODE%s\\n' '{suffix}'")
    }
}

/// Length of the longest suffix of `text` that could be the beginning of
/// `marker`. The reader keeps those bytes buffered so a marker split across
/// two reads is still recognised (and never printed).
fn partial_marker_len(text: &str, marker: &str) -> usize {
    let bytes = text.as_bytes();
    let marker = marker.as_bytes();
    if marker.is_empty() {
        return 0;
    }
    let max = bytes.len().min(marker.len() - 1);
    for len in (0..=max).rev() {
        if bytes[bytes.len() - len..] == marker[..len] {
            return len;
        }
    }
    0
}

/// Remove the shell's echo of a command from the output buffer.
///
/// Terminals echo what is typed, and the panel already prints the command as
/// an input line, so the echo is dropped. The buffer is untouched when the
/// echo has not arrived yet; a large buffer means the shell does not echo, in
/// which case the pending entry is discarded instead of stalling the output.
fn strip_echoes(buffer: &mut String, echoes: &StdMutex<Vec<String>>) {
    let Ok(mut pending) = echoes.lock() else {
        return;
    };
    while !pending.is_empty() {
        let command = pending[0].trim_end_matches(['\r', '\n']).to_string();
        if command.is_empty() {
            pending.remove(0);
            continue;
        }
        let Some(pos) = buffer.find(&command) else {
            if buffer.len() > 4096 {
                // No echo: this shell (or a full screen program) does not
                // print what is written. Forget the entry and stream on.
                pending.remove(0);
                continue;
            }
            break;
        };
        let after = pos + command.len();
        let rest = &buffer[after..];
        let mut skip = 0usize;
        if rest.starts_with('\r') {
            skip += 1;
        }
        if rest[skip..].starts_with('\n') {
            skip += 1;
        }
        if skip == 0 {
            // The echoed line has not been completed yet.
            if buffer.len() > 4096 {
                pending.remove(0);
                continue;
            }
            break;
        }
        buffer.replace_range(pos..after + skip, "");
        pending.remove(0);
    }
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
    let marker_line = marker_command(&spec.kind_name, &marker);

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
    // A predictable terminal description: without TERM many programs fall
    // back to plain output or refuse to draw their interface at all.
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    // The panel draws its own prompt and input line, so the shell prompt is
    // redundant (and would otherwise be chopped into partial lines).
    command.env("PS1", "");

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| error.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|error| error.to_string())?;
    let writer = pair.master.take_writer().map_err(|error| error.to_string())?;

    let echoes = Arc::new(StdMutex::new(Vec::new()));
    let echoes_clone = Arc::clone(&echoes);

    let session = TerminalSession {
        master: pair.master,
        writer,
        child,
        marker: marker.clone(),
        kind: spec.kind_name.clone(),
        echoes: Arc::clone(&echoes),
        cwd: directory.to_string_lossy().to_string(),
        shell: spec.cmd.clone(),
        label: label.unwrap_or_else(|| spec.kind_name.clone()),
    };

    let app_clone = app.clone();
    let marker_clone = marker;
    let echo_line = marker_line.clone();
    let session_id_clone = session_id.clone();
    std::thread::spawn(move || {
        let mut buffer = String::new();
        let mut chunk = [0u8; 8192];
        let echoed_crlf = format!("{echo_line}\r\n");
        let echoed_lf = format!("{echo_line}\n");
        loop {
            match reader.read(&mut chunk) {
                Ok(0) => break,
                Ok(count) => {
                    buffer.push_str(&String::from_utf8_lossy(&chunk[..count]));
                    // The terminal echoes the marker command back. Drop it so
                    // it never shows up in the log.
                    if buffer.contains(echo_line.as_str()) {
                        buffer = buffer.replace(&echoed_crlf, "").replace(&echoed_lf, "");
                    }
                    // Drop the echo of every command that was just written.
                    strip_echoes(&mut buffer, &echoes_clone);
                    // Strip every complete marker. Its presence means the
                    // command that was written has finished, so an empty
                    // stdout event tells the renderer to clear the spinner.
                    while let Some(pos) = buffer.find(marker_clone.as_str()) {
                        let before = buffer[..pos].to_string();
                        let mut after = pos + marker_clone.len();
                        let rest = &buffer[after..];
                        if rest.starts_with("\r\n") {
                            after += 2;
                        } else if rest.starts_with('\n') {
                            after += 1;
                        }
                        if !before.is_empty() {
                            emit(&app_clone, "stdout", &session_id_clone, Some(before), None);
                        }
                        emit(&app_clone, "stdout", &session_id_clone, Some(String::new()), None);
                        buffer = buffer[after..].to_string();
                    }
                    // Emit everything except a possible partial marker at
                    // the end; prompts and partial lines are forwarded as-is
                    // so the terminal feels live (and interactive programs
                    // such as vim keep working).
                    let keep = partial_marker_len(&buffer, marker_clone.as_str());
                    if buffer.len() > keep {
                        let ready = buffer[..buffer.len() - keep].to_string();
                        buffer = buffer[buffer.len() - keep..].to_string();
                        if !ready.is_empty() {
                            emit(&app_clone, "stdout", &session_id_clone, Some(ready), None);
                        }
                    }
                }
                Err(_) => break,
            }
        }
        if !buffer.is_empty() {
            emit(&app_clone, "stdout", &session_id_clone, Some(buffer), None);
        }
        emit(&app_clone, "exit", &session_id_clone, None, None);
    });

    let id = session_id.clone();
    let result = TerminalStartResult {
        id,
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
        .iter()
        .map(|(id, session)| TerminalListItem {
            id: id.clone(),
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
    let marker_line = format!("{}\r\n", marker_command(&session.kind, &session.marker));
    // Remember what was written so the reader can drop the shell's echo.
    if let Ok(mut pending) = session.echoes.lock() {
        for line in request.text.lines() {
            pending.push(line.to_string());
        }
    }
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
