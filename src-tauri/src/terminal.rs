//! Integrated shell.
//!
//! The shell is piped, not a pty. That keeps the implementation small and
//! portable: the panel draws its own prompt, ANSI colours are stripped and
//! full-screen programs are not supported. Commands are followed by a marker
//! line, which is how the renderer learns that the shell is ready again.

use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::Mutex;

use crate::process::{find_executable, home_dir};

#[derive(Default)]
pub struct TerminalState {
    pub inner: Mutex<Option<TerminalSession>>,
    pub token: std::sync::atomic::AtomicU64,
}

struct TerminalSession {
    child: Child,
    stdin: ChildStdin,
    kind: ShellKind,
    eol: &'static str,
    marker: String,
    cwd: String,
    shell: String,
}

#[derive(Clone, Copy)]
enum ShellKind {
    PowerShell,
    Cmd,
    Bash,
}

impl ShellKind {
    fn marker_command(self, token: &str) -> String {
        match self {
            ShellKind::PowerShell => format!("Write-Output \"{token}\""),
            _ => format!("echo {token}"),
        }
    }
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

struct ShellSpec {
    cmd: String,
    args: Vec<String>,
    kind: ShellKind,
    eol: &'static str,
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
                    "-NonInteractive".to_string(),
                    "-Command".to_string(),
                    "-".to_string(),
                ],
                kind: ShellKind::PowerShell,
                eol: "\n",
            };
        }
        return ShellSpec {
            cmd: "cmd.exe".to_string(),
            args: vec!["/Q".to_string(), "/K".to_string()],
            kind: ShellKind::Cmd,
            eol: "\r\n",
        };
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
            kind: ShellKind::Bash,
            eol: "\n",
        }
    }
}

fn clean_text(text: &str) -> String {
    // Remove OSC sequences, CSI sequences and the remaining escape bytes.
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(character) = chars.next() {
        match character {
            '\u{1b}' => match chars.next() {
                Some(']') => {
                    while let Some(next) = chars.next() {
                        if next == '\u{7}' {
                            break;
                        }
                        if next == '\u{1b}' && chars.peek() == Some(&'\\') {
                            chars.next();
                            break;
                        }
                    }
                }
                Some('[') => {
                    for next in chars.by_ref() {
                        if ('@'..='~').contains(&next) {
                            break;
                        }
                    }
                }
                Some(_) => {}
                None => break,
            },
            '\r' => {}
            '\u{0}'..='\u{8}' | '\u{b}' | '\u{c}' | '\u{e}'..='\u{1f}' | '\u{7f}' => {}
            other => out.push(other),
        }
    }
    out
}

async fn kill_session(session: &mut TerminalSession) {
    // Stop the shell process group, escalating from SIGTERM to SIGKILL while
    // the child is confirmed to still be running.
    #[cfg(unix)]
    {
        crate::process::stop_process_tree(&mut session.child, libc::SIGKILL).await;
    }
    #[cfg(not(unix))]
    {
        let _ = session.child.start_kill();
    }
}

fn emit(app: &AppHandle, event: TerminalEvent) {
    let _ = app.emit("terminal:output", event);
}

#[tauri::command]
pub async fn terminal_start(
    app: AppHandle,
    state: State<'_, TerminalState>,
    cwd: Option<String>,
) -> Result<TerminalStartResult, String> {
    let folder = cwd
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
        .unwrap_or_else(home_dir);
    let spec = pick_shell();
    let token = state
        .token
        .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
        + 1;

    {
        let mut guard = state.inner.lock().await;
        if let Some(mut previous) = guard.take() {
            kill_session(&mut previous).await;
        }
    }

    let mut command = Command::new(&spec.cmd);
    command
        .args(&spec.args)
        .current_dir(&folder)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    command.process_group(0);

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            return Ok(TerminalStartResult {
                ok: false,
                cwd: folder.to_string_lossy().to_string(),
                shell: spec.kind.kind_name(),
                error: Some(error.to_string()),
            });
        }
    };

    let Some(stdin) = child.stdin.take() else {
        return Err("The shell has no input stream.".to_string());
    };
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let marker = format!("__OPENNOTES_DONE_{}_{}__", std::process::id(), token);

    let result = TerminalStartResult {
        ok: true,
        cwd: folder.to_string_lossy().to_string(),
        shell: spec.cmd.clone(),
        error: None,
    };

    {
        let mut guard = state.inner.lock().await;
        *guard = Some(TerminalSession {
            child,
            stdin,
            kind: spec.kind,
            eol: spec.eol,
            marker: marker.clone(),
            cwd: result.cwd.clone(),
            shell: result.shell.clone(),
        });
    }

    if let Some(stream) = stdout {
        let handle = app.clone();
        tokio::spawn(async move {
            read_stream(handle, stream, true, marker, token).await;
        });
    }
    if let Some(stream) = stderr {
        let handle = app.clone();
        tokio::spawn(async move {
            read_stream(handle, stream, false, String::new(), token).await;
        });
    }

    Ok(result)
}

impl ShellKind {
    fn kind_name(self) -> String {
        match self {
            ShellKind::PowerShell => "powershell".to_string(),
            ShellKind::Cmd => "cmd".to_string(),
            ShellKind::Bash => "bash".to_string(),
        }
    }
}

async fn read_stream(
    app: AppHandle,
    stream: impl tokio::io::AsyncRead + Unpin,
    is_stdout: bool,
    marker: String,
    token: u64,
) {
    let mut lines = BufReader::new(stream).lines();
    loop {
        match lines.next_line().await {
            Ok(Some(line)) => {
                let clean = clean_text(&line);
                if is_stdout && !marker.is_empty() && clean.trim() == marker {
                    emit(
                        &app,
                        TerminalEvent {
                            kind: "stdout".to_string(),
                            text: Some(String::new()),
                            code: None,
                        },
                    );
                    continue;
                }
                emit(
                    &app,
                    TerminalEvent {
                        kind: if is_stdout { "stdout" } else { "stderr" }.to_string(),
                        text: Some(format!("{clean}\n")),
                        code: None,
                    },
                );
            }
            _ => break,
        }
    }
    if is_stdout {
        // The token is not used by the renderer; it is kept in the signature
        // so that a future pty implementation can ignore stale streams.
        let _ = token;
        emit(
            &app,
            TerminalEvent {
                kind: "exit".to_string(),
                text: None,
                code: None,
            },
        );
    }
}

#[tauri::command]
pub async fn terminal_write(state: State<'_, TerminalState>, text: String) -> Result<bool, String> {
    let mut guard = state.inner.lock().await;
    let Some(session) = guard.as_mut() else {
        return Ok(false);
    };
    let payload = text.replace("\r\n", "\n").replace('\r', "");
    for line in payload.split('\n') {
        session
            .stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|error| error.to_string())?;
        session
            .stdin
            .write_all(session.eol.as_bytes())
            .await
            .map_err(|error| error.to_string())?;
    }
    let marker = session.kind.marker_command(&session.marker);
    session
        .stdin
        .write_all(marker.as_bytes())
        .await
        .map_err(|error| error.to_string())?;
    session
        .stdin
        .write_all(session.eol.as_bytes())
        .await
        .map_err(|error| error.to_string())?;
    session
        .stdin
        .flush()
        .await
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
    #[cfg(unix)]
    {
        let _ = crate::process::interrupt_process_tree(&mut session.child, libc::SIGINT).await;
    }
    #[cfg(not(unix))]
    {
        let _ = session.stdin.write_all(b"\x03\n").await;
    }
    emit(
        &app,
        TerminalEvent {
            kind: "stdout".to_string(),
            text: Some(String::new()),
            code: None,
        },
    );
    Ok(true)
}

#[tauri::command]
pub async fn terminal_stop(
    app: AppHandle,
    state: State<'_, TerminalState>,
) -> Result<bool, String> {
    let mut guard = state.inner.lock().await;
    if let Some(mut session) = guard.take() {
        kill_session(&mut session).await;
        emit(
            &app,
            TerminalEvent {
                kind: "exit".to_string(),
                text: None,
                code: None,
            },
        );
    }
    Ok(true)
}

#[tauri::command]
pub fn terminal_resize(_cols: u32, _rows: u32) -> bool {
    // A pipe has no size.
    true
}

/// The folder the shell runs in (kept public for the tests and for a future
/// "open terminal here" command).
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
