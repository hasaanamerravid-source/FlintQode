//! Integrated terminal.
//!
//! A small PTY layer: it owns pseudo-terminals and moves raw bytes between the
//! webview and the shell. There is no command marker, no echo fabrication and
//! no ANSI parsing on the native side — the renderer uses xterm.js, which
//! understands the PTY stream itself.

use std::collections::HashMap;
use std::io::{ErrorKind, Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;

use crate::process::{find_executable, home_dir};

const EVENT: &str = "terminal:output";
const READ_SIZE: usize = 16 * 1024;

/// State managed by Tauri. One entry per terminal tab.
#[derive(Default)]
pub struct TerminalState {
    sessions: Mutex<HashMap<String, Session>>,
    active: Mutex<String>,
    next_id: AtomicU64,
}

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Arc<StdMutex<Box<dyn Write + Send>>>,
    child: Arc<StdMutex<Box<dyn Child + Send>>>,
    exited: Arc<AtomicBool>,
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
struct PtyEvent {
    #[serde(rename = "type")]
    kind: &'static str,
    #[serde(rename = "sessionId")]
    session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<i32>,
}

fn emit_data(app: &AppHandle, session_id: &str, text: String) {
    if text.is_empty() {
        return;
    }
    let _ = app.emit(
        EVENT,
        PtyEvent {
            kind: "data",
            session_id: session_id.to_string(),
            text: Some(text),
            code: None,
        },
    );
}

fn emit_exit_once(app: &AppHandle, session_id: &str, exited: &AtomicBool, code: Option<i32>) {
    if exited.swap(true, Ordering::SeqCst) {
        return;
    }
    let _ = app.emit(
        EVENT,
        PtyEvent {
            kind: "exit",
            session_id: session_id.to_string(),
            text: None,
            code,
        },
    );
}

/// The shell to run inside a new PTY: (program, arguments, display name).
fn shell_command() -> (String, Vec<String>, String) {
    #[cfg(windows)]
    {
        if let Some(program) = find_executable("powershell").or_else(|| find_executable("pwsh")) {
            return (
                program.to_string_lossy().into_owned(),
                vec!["-NoLogo".to_string(), "-NoProfile".to_string()],
                "powershell".to_string(),
            );
        }
        (
            "cmd.exe".to_string(),
            vec!["/Q".to_string()],
            "cmd".to_string(),
        )
    }

    #[cfg(not(windows))]
    {
        if let Some(shell) = std::env::var_os("SHELL").map(PathBuf::from) {
            if shell.is_file() {
                return (
                    shell.to_string_lossy().into_owned(),
                    Vec::new(),
                    "shell".to_string(),
                );
            }
        }
        if let Some(bash) = find_executable("bash") {
            return (
                bash.to_string_lossy().into_owned(),
                vec!["--norc".to_string(), "--noprofile".to_string()],
                "bash".to_string(),
            );
        }
        ("/bin/sh".to_string(), Vec::new(), "sh".to_string())
    }
}

fn working_directory(cwd: Option<String>) -> PathBuf {
    cwd.and_then(|value| {
        let path = PathBuf::from(value);
        path.is_dir().then_some(path)
    })
    .unwrap_or_else(|| {
        std::env::current_dir()
            .ok()
            .filter(|path| path.is_dir())
            .unwrap_or_else(home_dir)
    })
}

/// Decode PTY bytes without breaking a multi-byte character split across two
/// reads. At most 8 trailing bytes are held back.
fn decode(tail: &mut Vec<u8>, bytes: &[u8]) -> String {
    tail.extend_from_slice(bytes);
    match std::str::from_utf8(tail) {
        Ok(text) => {
            let result = text.to_string();
            tail.clear();
            result
        }
        Err(error) => {
            let valid = error.valid_up_to();
            let mut result = String::from_utf8_lossy(&tail[..valid]).into_owned();
            tail.drain(..valid);
            if tail.len() > 8 {
                result.push_str(&String::from_utf8_lossy(tail));
                tail.clear();
            }
            result
        }
    }
}

struct Opened {
    session: Session,
    reader: Box<dyn Read + Send>,
}

fn open_session(cwd: Option<String>, label: Option<String>) -> Result<Opened, String> {
    let directory = working_directory(cwd);
    let (program, args, kind) = shell_command();

    let pty = native_pty_system();
    let pair = pty
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| error.to_string())?;

    let mut command = CommandBuilder::new(&program);
    for arg in &args {
        command.arg(arg);
    }
    command.cwd(&directory);
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| error.to_string())?;
    drop(pair.slave);
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| error.to_string())?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| error.to_string())?;

    Ok(Opened {
        session: Session {
            master: pair.master,
            writer: Arc::new(StdMutex::new(writer)),
            child: Arc::new(StdMutex::new(child)),
            exited: Arc::new(AtomicBool::new(false)),
            cwd: directory.to_string_lossy().into_owned(),
            shell: program,
            label: label.unwrap_or(kind),
        },
        reader,
    })
}

/// Stream a PTY to the webview until the shell closes.
fn watch(
    app: AppHandle,
    mut reader: Box<dyn Read + Send>,
    child: Arc<StdMutex<Box<dyn Child + Send>>>,
    exited: Arc<AtomicBool>,
    id: String,
) {
    let read_app = app.clone();
    let read_id = id.clone();
    let read_exited = Arc::clone(&exited);
    let read_child = Arc::clone(&child);
    std::thread::spawn(move || {
        let mut bytes = [0u8; READ_SIZE];
        let mut pending = Vec::new();
        loop {
            match reader.read(&mut bytes) {
                Ok(0) => break,
                Ok(count) => emit_data(&read_app, &read_id, decode(&mut pending, &bytes[..count])),
                Err(error) if error.kind() == ErrorKind::Interrupted => continue,
                Err(_) => break,
            }
        }
        if !pending.is_empty() {
            emit_data(
                &read_app,
                &read_id,
                String::from_utf8_lossy(&pending).into_owned(),
            );
        }
        let code = read_child
            .lock()
            .ok()
            .and_then(|mut guard| guard.try_wait().ok().flatten())
            .map(|status| status.exit_code() as i32);
        emit_exit_once(&read_app, &read_id, &read_exited, code);
    });

    // Polling as well makes sure the webview always receives an `exit` event,
    // even when the PTY reader blocks or the shell closes unexpectedly.
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(100));
        let status = child
            .lock()
            .ok()
            .and_then(|mut guard| guard.try_wait().ok().flatten());
        if let Some(status) = status {
            emit_exit_once(&app, &id, &exited, Some(status.exit_code() as i32));
            break;
        }
        if exited.load(Ordering::SeqCst) {
            break;
        }
    });
}

async fn create_session(
    app: &AppHandle,
    state: &State<'_, TerminalState>,
    cwd: Option<String>,
    label: Option<String>,
) -> Result<TerminalStartResult, String> {
    let id = format!("term-{}", state.next_id.fetch_add(1, Ordering::SeqCst) + 1);
    let opened = open_session(cwd, label)?;
    let result = TerminalStartResult {
        id: id.clone(),
        ok: true,
        cwd: opened.session.cwd.clone(),
        shell: opened.session.shell.clone(),
        label: opened.session.label.clone(),
        error: None,
    };
    watch(
        app.clone(),
        opened.reader,
        Arc::clone(&opened.session.child),
        Arc::clone(&opened.session.exited),
        id.clone(),
    );
    state
        .sessions
        .lock()
        .await
        .insert(id.clone(), opened.session);
    *state.active.lock().await = id;
    Ok(result)
}

#[tauri::command]
pub async fn terminal_new(
    app: AppHandle,
    state: State<'_, TerminalState>,
    cwd: Option<String>,
    label: Option<String>,
) -> Result<TerminalStartResult, String> {
    create_session(&app, &state, cwd, label).await
}

#[tauri::command]
pub async fn terminal_start(
    app: AppHandle,
    state: State<'_, TerminalState>,
    cwd: Option<String>,
) -> Result<TerminalStartResult, String> {
    create_session(&app, &state, cwd, None).await
}

#[tauri::command]
pub async fn terminal_list(
    state: State<'_, TerminalState>,
) -> Result<Vec<TerminalListItem>, String> {
    let sessions = state.sessions.lock().await;
    let mut items: Vec<TerminalListItem> = sessions
        .iter()
        .map(|(id, session)| TerminalListItem {
            id: id.clone(),
            label: session.label.clone(),
            cwd: session.cwd.clone(),
            shell: session.shell.clone(),
        })
        .collect();
    items.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(items)
}

#[tauri::command]
pub async fn terminal_active(
    state: State<'_, TerminalState>,
    session_id: Option<String>,
) -> Result<String, String> {
    if let Some(id) = session_id {
        if state.sessions.lock().await.contains_key(&id) {
            *state.active.lock().await = id.clone();
            return Ok(id);
        }
        return Err("Unknown terminal session".into());
    }
    Ok(state.active.lock().await.clone())
}

#[tauri::command]
pub async fn terminal_write(
    state: State<'_, TerminalState>,
    request: TerminalWriteRequest,
) -> Result<bool, String> {
    {
        let sessions = state.sessions.lock().await;
        let Some(session) = sessions.get(&request.session_id) else {
            return Ok(false);
        };
        let mut writer = session
            .writer
            .lock()
            .map_err(|_| "Terminal is busy".to_string())?;
        writer
            .write_all(request.text.as_bytes())
            .and_then(|_| writer.flush())
            .map_err(|error| error.to_string())?;
    }
    *state.active.lock().await = request.session_id;
    Ok(true)
}

#[tauri::command]
pub async fn terminal_interrupt(
    state: State<'_, TerminalState>,
    session_id: String,
) -> Result<bool, String> {
    let sessions = state.sessions.lock().await;
    let Some(session) = sessions.get(&session_id) else {
        return Ok(false);
    };
    let mut writer = session
        .writer
        .lock()
        .map_err(|_| "Terminal is busy".to_string())?;
    writer
        .write_all(&[0x03])
        .and_then(|_| writer.flush())
        .map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn terminal_resize(
    state: State<'_, TerminalState>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> Result<bool, String> {
    let sessions = state.sessions.lock().await;
    let Some(session) = sessions.get(&session_id) else {
        return Ok(false);
    };
    session
        .master
        .resize(PtySize {
            rows: rows.max(1) as u16,
            cols: cols.max(1) as u16,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn terminal_stop(
    app: AppHandle,
    state: State<'_, TerminalState>,
    session_id: String,
) -> Result<bool, String> {
    let mut sessions = state.sessions.lock().await;
    let Some(session) = sessions.remove(&session_id) else {
        return Ok(false);
    };
    if let Ok(mut writer) = session.writer.lock() {
        let _ = writer.write_all(b"exit\r\n");
        let _ = writer.flush();
    }
    if let Ok(mut child) = session.child.lock() {
        let _ = child.kill();
    }
    emit_exit_once(&app, &session_id, &session.exited, None);
    let mut active = state.active.lock().await;
    if *active == session_id {
        *active = sessions.keys().next().cloned().unwrap_or_default();
    }
    Ok(true)
}

#[tauri::command]
pub async fn terminal_close(
    app: AppHandle,
    state: State<'_, TerminalState>,
    session_id: String,
) -> Result<bool, String> {
    terminal_stop(app, state, session_id).await
}
