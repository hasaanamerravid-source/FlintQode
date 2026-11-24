//! Run service.
//!
//! One program at a time is launched for the active editor file. Its output is
//! streamed to the renderer on `run:output`, and stopping a run cancels the
//! whole process tree. Toolchain overrides from the settings and from the
//! project configuration take precedence over programs on PATH.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::AsyncReadExt;
use tokio::process::{Child, Command};
use tokio::sync::{oneshot, Mutex};

use crate::process::{find_executable, has_executable, stop_process_tree};

const EVENT: &str = "run:output";
static NEXT_TOKEN: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RunRequest {
    pub file_path: String,
    pub language: String,
    #[serde(default)]
    pub toolchain: HashMap<String, String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RunEvent {
    #[serde(rename = "type")]
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<i32>,
}

#[derive(Default)]
pub struct RunState {
    current: Mutex<Option<Current>>,
}

struct Current {
    token: u64,
    cancel: oneshot::Sender<()>,
    done: oneshot::Receiver<()>,
    cleanup: Vec<PathBuf>,
}

#[derive(Clone)]
struct Invocation {
    program: String,
    args: Vec<String>,
    cwd: PathBuf,
    env: Vec<(String, String)>,
}

struct Plan {
    display: String,
    prepare: Option<(String, Vec<String>)>,
    run: Invocation,
    cleanup: Vec<PathBuf>,
}

fn emit(app: &AppHandle, kind: &'static str, text: Option<String>, code: Option<i32>) {
    let _ = app.emit(EVENT, RunEvent { kind, text, code });
}

fn missing(program: &str) -> String {
    let label = match program {
        "node" | "npx" => "Node.js",
        "python" | "python3" => "Python",
        "go" => "Go",
        "cargo" => "Rust (Cargo)",
        "java" => "Java",
        "javac" => "the Java SDK",
        "dotnet" => "the .NET SDK",
        "php" => "PHP",
        "ruby" => "Ruby",
        "lua" => "Lua",
        "gcc" | "clang" => "a C compiler",
        "g++" | "clang++" => "a C++ compiler",
        other => other,
    };
    format!("{label} was not found on this machine. Install {label} and try again.")
}

/// Resolve a configured tool path. A configured directory means "<dir>/bin/<program>".
fn tool(request: &RunRequest, keys: &[&str], fallback: &str) -> String {
    for key in keys {
        if let Some(value) = request
            .toolchain
            .get(*key)
            .map(|value| value.trim())
            .filter(|v| !v.is_empty())
        {
            let path = Path::new(value);
            if path.is_dir() {
                let binary = if cfg!(windows) && !fallback.ends_with(".exe") {
                    format!("{fallback}.exe")
                } else {
                    fallback.to_string()
                };
                let candidate = path.join("bin").join(binary);
                if candidate.is_file() {
                    return candidate.to_string_lossy().into_owned();
                }
            }
            return value.to_string();
        }
    }
    fallback.to_string()
}

fn require(program: &str) -> Result<(), String> {
    if find_executable(program).is_some() {
        Ok(())
    } else {
        Err(missing(program))
    }
}

fn walk_up(start: &Path, name: &str) -> Option<PathBuf> {
    let mut dir = Some(start);
    while let Some(current) = dir {
        let candidate = current.join(name);
        if candidate.exists() {
            return Some(candidate);
        }
        dir = current.parent();
    }
    None
}

fn nearest_project(start: &Path, extension: &str) -> Option<PathBuf> {
    let mut dir = Some(start);
    while let Some(current) = dir {
        if let Ok(entries) = std::fs::read_dir(current) {
            for entry in entries.flatten() {
                if entry.path().is_file()
                    && entry
                        .path()
                        .extension()
                        .and_then(|value| value.to_str())
                        .is_some_and(|value| value.eq_ignore_ascii_case(extension))
                {
                    return Some(entry.path());
                }
            }
        }
        dir = current.parent();
    }
    None
}

fn local_tsx(start: &Path) -> Option<PathBuf> {
    let names = if cfg!(windows) {
        vec!["tsx.cmd", "tsx.exe", "tsx"]
    } else {
        vec!["tsx"]
    };
    let mut dir = Some(start);
    while let Some(current) = dir {
        let bin = current.join("node_modules").join(".bin");
        for name in &names {
            let candidate = bin.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
        dir = current.parent();
    }
    None
}

fn temp_binary(stem: &str) -> PathBuf {
    let safe: String = stem
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .take(40)
        .collect();
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or(0);
    let suffix = if cfg!(windows) { ".exe" } else { "" };
    std::env::temp_dir().join(format!("flintqode-{safe}-{nanos}{suffix}"))
}

fn has_main(path: &Path) -> bool {
    std::fs::read_to_string(path)
        .map(|text| regex::Regex::new(r"\bvoid\s+main\s*\(").is_ok_and(|re| re.is_match(&text)))
        .unwrap_or(true)
}

fn language_of(request: &RunRequest, path: &Path) -> String {
    let given = request.language.trim().to_lowercase();
    if !given.is_empty() && given != "text" && given != "plaintext" {
        return given;
    }
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase()
}

fn plan(request: &RunRequest) -> Result<Plan, String> {
    let path = PathBuf::from(request.file_path.trim());
    if !path.is_file() {
        return Err(format!("The file does not exist: {}", path.display()));
    }
    let cwd = path
        .parent()
        .filter(|dir| !dir.as_os_str().is_empty())
        .map(Path::to_path_buf)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let file = path.to_string_lossy().into_owned();
    let stem = path
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "program".to_string());
    let language = language_of(request, &path);
    let simple = |program: String, args: Vec<String>| -> Plan {
        let display = format!("{} {}", program, args.join(" "));
        Plan {
            display,
            prepare: None,
            run: Invocation {
                program,
                args,
                cwd: cwd.clone(),
                env: Vec::new(),
            },
            cleanup: Vec::new(),
        }
    };

    match language.as_str() {
        "javascript" | "javascriptreact" | "js" | "mjs" | "cjs" => {
            let node = tool(request, &["javascript", "node"], "node");
            require(&node)?;
            Ok(simple(node, vec![file]))
        }
        "typescript" | "typescriptreact" | "ts" | "tsx" => {
            if let Some(local) = local_tsx(&cwd) {
                return Ok(simple(local.to_string_lossy().into_owned(), vec![file]));
            }
            let tsx = tool(request, &["typescript", "tsx"], "tsx");
            if has_executable(&tsx) {
                return Ok(simple(tsx, vec![file]));
            }
            let npx = tool(request, &["node", "npx"], "npx");
            require(&npx)?;
            let mut result = simple(npx, vec!["--no-install".into(), "tsx".into(), file]);
            result
                .run
                .env
                .push(("npm_config_yes".into(), "false".into()));
            Ok(result)
        }
        "python" | "py" => {
            let python = tool(
                request,
                &["python", "python3"],
                if cfg!(windows) { "python" } else { "python3" },
            );
            require(&python)?;
            Ok(simple(python, vec![file]))
        }
        "go" => {
            let go = tool(request, &["go"], "go");
            require(&go)?;
            Ok(simple(go, vec!["run".into(), file]))
        }
        "rust" | "rs" => {
            let cargo = tool(request, &["rust", "cargo"], "cargo");
            require(&cargo)?;
            let manifest =
                walk_up(&cwd, "Cargo.toml").ok_or("Rust files need a Cargo.toml project.")?;
            let mut result = simple(
                cargo,
                vec![
                    "run".into(),
                    "--manifest-path".into(),
                    manifest.to_string_lossy().into_owned(),
                ],
            );
            result.display = "cargo run".to_string();
            Ok(result)
        }
        "c" | "cpp" | "c++" | "cc" => {
            let cpp = matches!(language.as_str(), "cpp" | "c++");
            let compiler = if cpp {
                tool(request, &["cpp", "c++", "g++"], "g++")
            } else {
                tool(request, &["c", "gcc"], "gcc")
            };
            require(&compiler)?;
            let binary = temp_binary(&stem);
            let mut args = vec![
                file.clone(),
                "-o".into(),
                binary.to_string_lossy().into_owned(),
            ];
            if cpp {
                args.push("-std=c++17".into());
            }
            let display = format!("{} && {}", compiler, binary.display());
            Ok(Plan {
                display,
                prepare: Some((compiler, args)),
                run: Invocation {
                    program: binary.to_string_lossy().into_owned(),
                    args: Vec::new(),
                    cwd: cwd.clone(),
                    env: Vec::new(),
                },
                cleanup: vec![binary],
            })
        }
        "csharp" | "cs" => {
            let dotnet = tool(request, &["csharp", "dotnet"], "dotnet");
            require(&dotnet)?;
            let project = nearest_project(&cwd, "csproj").ok_or("No .csproj project was found.")?;
            Ok(simple(
                dotnet,
                vec![
                    "run".into(),
                    "--project".into(),
                    project.to_string_lossy().into_owned(),
                ],
            ))
        }
        "java" => {
            let java = tool(request, &["java"], "java");
            require(&java)?;
            if !has_main(&path) {
                return Err("The Java file needs a `void main(...)` method.".to_string());
            }
            Ok(simple(java, vec![file]))
        }
        "php" | "ruby" | "lua" | "perl" => {
            let program = tool(request, &[language.as_str()], &language);
            require(&program)?;
            Ok(simple(program, vec![file]))
        }
        "shell" | "bash" | "sh" => {
            let shell = tool(request, &["bash", "shell"], "bash");
            require(&shell)?;
            Ok(simple(shell, vec![file]))
        }
        "powershell" | "ps1" => {
            let shell = tool(request, &["powershell", "pwsh"], "powershell");
            require(&shell)?;
            Ok(simple(
                shell,
                vec![
                    "-ExecutionPolicy".into(),
                    "Bypass".into(),
                    "-File".into(),
                    file,
                ],
            ))
        }
        "batch" | "bat" | "cmd" if cfg!(windows) => {
            Ok(simple("cmd.exe".into(), vec!["/c".into(), file]))
        }
        _ => Err("This file type cannot be executed.".to_string()),
    }
}

fn spawn(invocation: &Invocation) -> Result<Child, String> {
    let mut command = Command::new(&invocation.program);
    command
        .args(&invocation.args)
        .current_dir(&invocation.cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    for (key, value) in &invocation.env {
        command.env(key, value);
    }
    #[cfg(unix)]
    command.process_group(0);
    command
        .spawn()
        .map_err(|error| format!("Could not start {}: {error}", invocation.program))
}

async fn stream(app: AppHandle, mut pipe: impl AsyncReadExt + Unpin, stdout: bool) {
    let mut buffer = vec![0u8; 8192];
    loop {
        match pipe.read(&mut buffer).await {
            Ok(0) | Err(_) => break,
            Ok(count) => emit(
                &app,
                if stdout { "stdout" } else { "stderr" },
                Some(String::from_utf8_lossy(&buffer[..count]).into_owned()),
                None,
            ),
        }
    }
}

pub async fn stop_current(app: &AppHandle, state: &State<'_, RunState>) {
    let current = state.current.lock().await.take();
    let Some(current) = current else { return };
    let _ = current.cancel.send(());
    let _ = tokio::time::timeout(Duration::from_secs(2), current.done).await;
    for path in &current.cleanup {
        let _ = std::fs::remove_file(path);
    }
    let _ = app;
}

#[tauri::command]
pub async fn run_start(
    app: AppHandle,
    state: State<'_, RunState>,
    request: RunRequest,
) -> Result<bool, String> {
    stop_current(&app, &state).await;

    let mut selected = match plan(&request) {
        Ok(plan) => plan,
        Err(error) => {
            emit(&app, "error", Some(error), None);
            return Ok(false);
        }
    };

    emit(&app, "start", Some(selected.display.clone()), None);

    if let Some((compiler, args)) = selected.prepare.take() {
        let compile = Command::new(&compiler)
            .args(&args)
            .current_dir(&selected.run.cwd)
            .output()
            .await;
        match compile {
            Ok(output) if output.status.success() => {}
            Ok(output) => {
                let log = String::from_utf8_lossy(&output.stderr).into_owned();
                if !log.trim().is_empty() {
                    emit(&app, "stderr", Some(log), None);
                }
                for path in &selected.cleanup {
                    let _ = std::fs::remove_file(path);
                }
                emit(&app, "exit", None, output.status.code());
                return Ok(false);
            }
            Err(error) => {
                for path in &selected.cleanup {
                    let _ = std::fs::remove_file(path);
                }
                emit(&app, "error", Some(error.to_string()), None);
                return Ok(false);
            }
        }
    }

    let mut child = match spawn(&selected.run) {
        Ok(child) => child,
        Err(error) => {
            for path in &selected.cleanup {
                let _ = std::fs::remove_file(path);
            }
            emit(&app, "error", Some(error), None);
            return Ok(false);
        }
    };
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let token = NEXT_TOKEN.fetch_add(1, Ordering::SeqCst) + 1;
    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
    let (done_tx, done_rx) = oneshot::channel::<()>();
    *state.current.lock().await = Some(Current {
        token,
        cancel: cancel_tx,
        done: done_rx,
        cleanup: selected.cleanup.clone(),
    });

    if let Some(pipe) = stdout {
        let app = app.clone();
        tokio::spawn(async move { stream(app, pipe, true).await });
    }
    if let Some(pipe) = stderr {
        let app = app.clone();
        tokio::spawn(async move { stream(app, pipe, false).await });
    }

    let cleanup = selected.cleanup.clone();
    let wait_app = app.clone();
    tokio::spawn(async move {
        let mut cancel_rx = cancel_rx;
        let status = tokio::select! {
            result = child.wait() => result.ok().and_then(|status| status.code()),
            _ = &mut cancel_rx => {
                #[cfg(unix)]
                stop_process_tree(&mut child, libc::SIGTERM).await;
                #[cfg(not(unix))]
                stop_process_tree(&mut child, 0).await;
                let _ = child.wait().await;
                None
            }
        };
        for path in &cleanup {
            let _ = std::fs::remove_file(path);
        }
        let state = wait_app.state::<RunState>();
        let mut guard = state.current.lock().await;
        if guard.as_ref().is_some_and(|current| current.token == token) {
            *guard = None;
        }
        drop(guard);
        emit(&wait_app, "exit", None, status);
        let _ = done_tx.send(());
    });

    Ok(true)
}

#[tauri::command]
pub async fn run_stop(app: AppHandle, state: State<'_, RunState>) -> Result<bool, String> {
    stop_current(&app, &state).await;
    Ok(true)
}
