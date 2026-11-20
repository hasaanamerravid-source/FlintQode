//! Run service: start the interpreter for a file and stream its output.
//!
//! Only one process runs at a time. Toolchain paths from the settings (and
//! from the project configuration) win over the programs on the PATH, the
//! same way the Electron build resolved them.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, Command};
use tokio::sync::{oneshot, Mutex};

use crate::process::{find_executable, has_executable};

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
    kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<i32>,
}

#[derive(Default)]
pub struct RunState {
    current: Mutex<Option<CurrentRun>>,
}

struct CurrentRun {
    token: u64,
    stop: oneshot::Sender<()>,
    done: oneshot::Receiver<()>,
    cleanup: Vec<PathBuf>,
}

struct PlannedCommand {
    cmd: String,
    args: Vec<String>,
    cwd: PathBuf,
    env: Vec<(String, String)>,
}

struct RunPlan {
    display: String,
    prepare: Option<PlannedCommand>,
    command: PlannedCommand,
    cleanup: Vec<PathBuf>,
}

static TOKEN: AtomicU64 = AtomicU64::new(0);

fn emit(app: &AppHandle, kind: &str, text: Option<String>, code: Option<i32>) {
    let _ = app.emit(
        "run:output",
        RunEvent {
            kind: kind.to_string(),
            text,
            code,
        },
    );
}

fn missing_tool(command: &str) -> String {
    let label = match command {
        "node" => "Node.js",
        "npx" => "npm",
        "python" | "python3" => "Python",
        "go" => "Go",
        "cargo" => "Rust (Cargo)",
        "java" => "Java",
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

fn tool_path(request: &RunRequest, key: &str, fallback: &str) -> String {
    let Some(configured) = request
        .toolchain
        .get(key)
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    else {
        return fallback.to_string();
    };
    let path = Path::new(configured);
    if path.is_dir() {
        let name = if cfg!(windows) && !fallback.ends_with(".exe") {
            format!("{fallback}.exe")
        } else {
            fallback.to_string()
        };
        let candidate = path.join("bin").join(name);
        if candidate.is_file() {
            return candidate.to_string_lossy().to_string();
        }
    }
    configured.to_string()
}

fn find_local_bin(start: &Path, name: &str) -> Option<PathBuf> {
    let names: Vec<String> = if cfg!(windows) {
        vec![
            format!("{name}.cmd"),
            format!("{name}.exe"),
            name.to_string(),
        ]
    } else {
        vec![name.to_string()]
    };
    let mut current = Some(start);
    while let Some(dir) = current {
        let bin = dir.join("node_modules").join(".bin");
        for candidate in &names {
            let full = bin.join(candidate);
            if full.is_file() {
                return Some(full);
            }
        }
        current = dir.parent();
    }
    None
}

fn find_up(start: &Path, name: &str) -> Option<PathBuf> {
    let mut current = Some(start);
    while let Some(dir) = current {
        let candidate = dir.join(name);
        if candidate.exists() {
            return Some(candidate);
        }
        current = dir.parent();
    }
    None
}

fn find_project(start: &Path) -> Option<PathBuf> {
    let mut current = Some(start);
    while let Some(dir) = current {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_lowercase();
                if name.ends_with(".csproj") {
                    return Some(entry.path());
                }
            }
        }
        current = dir.parent();
    }
    None
}

fn temp_binary(source: &Path) -> PathBuf {
    let base: String = source
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "program".to_string())
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '_' || character == '-' {
                character
            } else {
                '_'
            }
        })
        .take(40)
        .collect();
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or(0);
    let extension = if cfg!(windows) { ".exe" } else { "" };
    std::env::temp_dir().join(format!("opennotes-{base}-{stamp}{extension}"))
}

fn has_main_method(path: &str) -> bool {
    std::fs::read_to_string(path)
        .map(|text| {
            regex::Regex::new(r"\bvoid\s+main\s*\(")
                .map(|regex| regex.is_match(&text))
                .unwrap_or(true)
        })
        .unwrap_or(true)
}

fn base_command(spec: &PlannedCommand, capture: bool) -> Command {
    let mut command = Command::new(&spec.cmd);
    command
        .args(&spec.args)
        .current_dir(&spec.cwd)
        .stdin(Stdio::null())
        .stdout(if capture {
            Stdio::piped()
        } else {
            Stdio::piped()
        })
        .stderr(if capture {
            Stdio::piped()
        } else {
            Stdio::piped()
        })
        .kill_on_drop(true);
    for (key, value) in &spec.env {
        command.env(key, value);
    }
    #[cfg(unix)]
    command.process_group(0);
    command
}

fn not_runnable() -> String {
    "This file type cannot be executed.".to_string()
}

fn resolve_plan(request: &RunRequest) -> Result<RunPlan, String> {
    let file_path = request.file_path.trim();
    if file_path.is_empty() {
        return Err("There is no file to run.".to_string());
    }
    let source = Path::new(file_path);
    if !source.exists() {
        return Err(format!("The file {file_path} does not exist."));
    }
    let language = request.language.to_lowercase();
    let extension = source
        .extension()
        .map(|value| value.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let from_extension = match extension.as_str() {
        "js" | "mjs" | "cjs" => "javascript",
        "jsx" => "jsx",
        "ts" => "typescript",
        "tsx" => "tsx",
        "py" => "python",
        "go" => "go",
        "rs" => "rust",
        "c" | "h" => "c",
        "cc" | "cpp" | "cxx" | "hpp" => "cpp",
        "cs" => "csharp",
        "java" => "java",
        "php" => "php",
        "rb" => "ruby",
        "lua" => "lua",
        "bat" | "cmd" => "batch",
        "ps1" | "psm1" => "powershell",
        "sh" | "bash" => "shell",
        _ => "",
    };
    let language = if language.is_empty() {
        from_extension
    } else {
        language.as_str()
    };
    let dir = source.parent().unwrap_or(Path::new(".")).to_path_buf();

    if matches!(
        language,
        "html"
            | "xml"
            | "markdown"
            | "text"
            | "plaintext"
            | "json"
            | "jsonc"
            | "yaml"
            | "toml"
            | "ini"
            | "css"
            | "scss"
            | "less"
            | "sql"
            | "csv"
            | "tsv"
            | "diff"
            | "latex"
            | "tex"
            | "log"
            | "rest"
            | "dockerfile"
            | "makefile"
            | "gitignore"
            | "gitconfig"
    ) {
        return Err(not_runnable());
    }

    let command = |cmd: String, args: Vec<String>| PlannedCommand {
        cmd,
        args,
        cwd: dir.clone(),
        env: Vec::new(),
    };

    match language {
        "javascript" | "jsx" => {
            let node = tool_path(request, "node", "node");
            if !has_executable(&node) {
                return Err(missing_tool("node"));
            }
            Ok(RunPlan {
                display: format!("node {file_path}"),
                prepare: None,
                command: command(node, vec![file_path.to_string()]),
                cleanup: Vec::new(),
            })
        }
        "typescript" | "tsx" => {
            if let Some(local) = find_local_bin(&dir, "tsx") {
                return Ok(RunPlan {
                    display: format!("tsx {file_path}"),
                    prepare: None,
                    command: command(
                        local.to_string_lossy().to_string(),
                        vec![file_path.to_string()],
                    ),
                    cleanup: Vec::new(),
                });
            }
            if has_executable("tsx") {
                return Ok(RunPlan {
                    display: format!("tsx {file_path}"),
                    prepare: None,
                    command: command("tsx".to_string(), vec![file_path.to_string()]),
                    cleanup: Vec::new(),
                });
            }
            if has_executable("npx") {
                let node = tool_path(request, "node", "node");
                let mut spec = command(
                    "npx".to_string(),
                    vec![
                        "--no-install".to_string(),
                        "tsx".to_string(),
                        file_path.to_string(),
                    ],
                );
                spec.env
                    .push(("npm_config_offline".to_string(), "true".to_string()));
                spec.env.push((
                    "npm_config_update_notifier".to_string(),
                    "false".to_string(),
                ));
                if node != "node" {
                    if let Some(parent) = Path::new(&node).parent() {
                        let path = std::env::var("PATH").unwrap_or_default();
                        spec.env
                            .push(("PATH".to_string(), format!("{}:{path}", parent.display())));
                    }
                }
                return Ok(RunPlan {
                    display: format!("npx --no-install tsx {file_path}"),
                    prepare: None,
                    command: spec,
                    cleanup: Vec::new(),
                });
            }
            Err("The tsx runner is not installed. Run `npm install -D tsx` in the project folder and try again.".to_string())
        }
        "python" => {
            let python = tool_path(request, "python", "python");
            let program = if has_executable(&python) {
                python
            } else if has_executable("python3") {
                "python3".to_string()
            } else {
                return Err(missing_tool("python"));
            };
            Ok(RunPlan {
                display: format!("{program} {file_path}"),
                prepare: None,
                command: command(program, vec![file_path.to_string()]),
                cleanup: Vec::new(),
            })
        }
        "go" => {
            let go = tool_path(request, "go", "go");
            if !has_executable(&go) {
                return Err(missing_tool("go"));
            }
            Ok(RunPlan {
                display: format!("go run {file_path}"),
                prepare: None,
                command: command(go, vec!["run".to_string(), file_path.to_string()]),
                cleanup: Vec::new(),
            })
        }
        "rust" => {
            let manifest = find_up(&dir, "Cargo.toml")
                .ok_or_else(|| "This Rust file is not part of a Cargo project. Open the folder with the Cargo.toml and run the project instead.".to_string())?;
            let cargo = tool_path(request, "rust", "cargo");
            if !has_executable(&cargo) {
                return Err(missing_tool("cargo"));
            }
            let project_dir = manifest.parent().unwrap_or(Path::new(".")).to_path_buf();
            Ok(RunPlan {
                display: format!("cargo run ({})", project_dir.display()),
                prepare: None,
                command: PlannedCommand {
                    cmd: cargo,
                    args: vec!["run".to_string()],
                    cwd: project_dir,
                    env: Vec::new(),
                },
                cleanup: Vec::new(),
            })
        }
        "c" | "cpp" => {
            let (compilers, label): (&[&str], &str) = if language == "c" {
                (&["gcc", "clang"], "a C compiler (GCC or Clang)")
            } else {
                (&["g++", "clang++"], "a C++ compiler (g++ or Clang++)")
            };
            let Some(compiler) = compilers.iter().find(|name| has_executable(name)) else {
                return Err(format!(
                    "{label} was not found on this machine. Install it and try again."
                ));
            };
            let binary = temp_binary(source);
            Ok(RunPlan {
                display: format!("{compiler} {file_path} && {}", binary.display()),
                prepare: Some(command(
                    compiler.to_string(),
                    vec![
                        file_path.to_string(),
                        "-o".to_string(),
                        binary.to_string_lossy().to_string(),
                    ],
                )),
                command: command(binary.to_string_lossy().to_string(), Vec::new()),
                cleanup: vec![binary],
            })
        }
        "csharp" => {
            let project = find_project(&dir).ok_or_else(|| {
                "No .csproj file was found next to this file. Open the project folder and run it with \"dotnet run\" instead.".to_string()
            })?;
            let dotnet = tool_path(request, "dotnet", "dotnet");
            if !has_executable(&dotnet) {
                return Err(missing_tool("dotnet"));
            }
            let project_dir = project.parent().unwrap_or(Path::new(".")).to_path_buf();
            Ok(RunPlan {
                display: format!("dotnet run --project {}", project.display()),
                prepare: None,
                command: PlannedCommand {
                    cmd: dotnet,
                    args: vec![
                        "run".to_string(),
                        "--project".to_string(),
                        project.to_string_lossy().to_string(),
                    ],
                    cwd: project_dir,
                    env: Vec::new(),
                },
                cleanup: Vec::new(),
            })
        }
        "java" => {
            let java = tool_path(request, "java", "java");
            if !has_executable(&java) {
                return Err(missing_tool("java"));
            }
            if !has_main_method(file_path) {
                return Err("This Java file has no main class. Build the project first and run the compiled class instead.".to_string());
            }
            Ok(RunPlan {
                display: format!("java {file_path}"),
                prepare: None,
                command: command(java, vec![file_path.to_string()]),
                cleanup: Vec::new(),
            })
        }
        "php" => {
            let php = tool_path(request, "php", "php");
            if !has_executable(&php) {
                return Err(missing_tool("php"));
            }
            Ok(RunPlan {
                display: format!("php {file_path}"),
                prepare: None,
                command: command(php, vec![file_path.to_string()]),
                cleanup: Vec::new(),
            })
        }
        "ruby" => {
            let ruby = tool_path(request, "ruby", "ruby");
            if !has_executable(&ruby) {
                return Err(missing_tool("ruby"));
            }
            Ok(RunPlan {
                display: format!("ruby {file_path}"),
                prepare: None,
                command: command(ruby, vec![file_path.to_string()]),
                cleanup: Vec::new(),
            })
        }
        "lua" => {
            if !has_executable("lua") {
                return Err(missing_tool("lua"));
            }
            Ok(RunPlan {
                display: format!("lua {file_path}"),
                prepare: None,
                command: command("lua".to_string(), vec![file_path.to_string()]),
                cleanup: Vec::new(),
            })
        }
        "batch" => {
            if cfg!(windows) {
                Ok(RunPlan {
                    display: format!("cmd /c {file_path}"),
                    prepare: None,
                    command: command(
                        "cmd.exe".to_string(),
                        vec!["/c".to_string(), file_path.to_string()],
                    ),
                    cleanup: Vec::new(),
                })
            } else {
                Err(not_runnable())
            }
        }
        "powershell" => {
            let shell = if has_executable("powershell") {
                "powershell"
            } else if has_executable("pwsh") {
                "pwsh"
            } else {
                return Err(missing_tool("powershell"));
            };
            Ok(RunPlan {
                display: format!("{shell} -File {file_path}"),
                prepare: None,
                command: command(
                    shell.to_string(),
                    vec![
                        "-ExecutionPolicy".to_string(),
                        "Bypass".to_string(),
                        "-File".to_string(),
                        file_path.to_string(),
                    ],
                ),
                cleanup: Vec::new(),
            })
        }
        "shell" | "bash" => {
            let Some(bash) = find_executable("bash") else {
                return Err("Bash was not found on this machine. Install Git Bash (or another shell) and try again.".to_string());
            };
            let target = if cfg!(windows) {
                file_path.replace('\\', "/")
            } else {
                file_path.to_string()
            };
            Ok(RunPlan {
                display: format!("bash {target}"),
                prepare: None,
                command: command(bash.to_string_lossy().to_string(), vec![target]),
                cleanup: Vec::new(),
            })
        }
        _ => Err(not_runnable()),
    }
}

async fn run_capture(spec: &PlannedCommand) -> Result<(Option<i32>, String), String> {
    let mut command = base_command(spec, true);
    let output = command.output().await.map_err(|error| error.to_string())?;
    let mut text = String::from_utf8_lossy(&output.stdout).to_string();
    text.push_str(&String::from_utf8_lossy(&output.stderr));
    Ok((output.status.code(), text))
}

async fn kill_child(child: &mut Child) {
    #[cfg(unix)]
    {
        if let Some(pid) = child.id() {
            unsafe {
                libc::kill(-(pid as i32), libc::SIGTERM);
            }
        }
    }
    let _ = child.start_kill();
}

async fn stop_current(app: &AppHandle, state: &RunState) {
    let current = {
        let mut guard = state.current.lock().await;
        guard.take()
    };
    let Some(current) = current else {
        return;
    };
    let CurrentRun {
        stop,
        done,
        cleanup,
        ..
    } = current;
    let _ = stop.send(());
    let _ = tokio::time::timeout(Duration::from_secs(2), done).await;
    for file in cleanup {
        let _ = std::fs::remove_file(file);
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

    let plan = match resolve_plan(&request) {
        Ok(plan) => plan,
        Err(error) => {
            emit(&app, "error", Some(error), None);
            return Ok(false);
        }
    };

    emit(&app, "start", Some(plan.display.clone()), None);

    if let Some(prepare) = &plan.prepare {
        match run_capture(prepare).await {
            Ok((code, output)) => {
                if code != Some(0) {
                    if !output.trim().is_empty() {
                        emit(&app, "stderr", Some(output), None);
                    }
                    for file in &plan.cleanup {
                        let _ = std::fs::remove_file(file);
                    }
                    emit(&app, "exit", None, code);
                    return Ok(false);
                }
            }
            Err(error) => {
                emit(&app, "error", Some(error), None);
                for file in &plan.cleanup {
                    let _ = std::fs::remove_file(file);
                }
                return Ok(false);
            }
        }
    }

    let mut command = base_command(&plan.command, false);
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            emit(
                &app,
                "error",
                Some(format!("Could not start {}: {error}", plan.command.cmd)),
                None,
            );
            for file in &plan.cleanup {
                let _ = std::fs::remove_file(file);
            }
            return Ok(false);
        }
    };

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let token = TOKEN.fetch_add(1, Ordering::SeqCst) + 1;
    let (stop_tx, stop_rx) = oneshot::channel();
    let (done_tx, done_rx) = oneshot::channel();

    {
        let mut guard = state.current.lock().await;
        *guard = Some(CurrentRun {
            token,
            stop: stop_tx,
            done: done_rx,
            cleanup: plan.cleanup.clone(),
        });
    }

    if let Some(stream) = stdout {
        let handle = app.clone();
        tokio::spawn(async move { read_stream(handle, stream, true).await });
    }
    if let Some(stream) = stderr {
        let handle = app.clone();
        tokio::spawn(async move { read_stream(handle, stream, false).await });
    }

    let task_app = app.clone();
    tokio::spawn(async move {
        let mut stop_rx = stop_rx;
        let status = tokio::select! {
            result = child.wait() => result.ok().and_then(|status| status.code()),
            _ = &mut stop_rx => {
                kill_child(&mut child).await;
                let _ = child.wait().await;
                None
            }
        };
        for file in &plan.cleanup {
            let _ = std::fs::remove_file(file);
        }
        {
            let state = task_app.state::<RunState>();
            let mut guard = state.current.lock().await;
            if guard.as_ref().map(|current| current.token) == Some(token) {
                *guard = None;
            }
        }
        emit(&task_app, "exit", None, status);
        let _ = done_tx.send(());
    });

    Ok(true)
}

async fn read_stream(
    app: AppHandle,
    mut stream: impl tokio::io::AsyncRead + Unpin,
    is_stdout: bool,
) {
    let mut buffer = vec![0u8; 8192];
    loop {
        match stream.read(&mut buffer).await {
            Ok(0) => break,
            Ok(read) => {
                let text = String::from_utf8_lossy(&buffer[..read]).to_string();
                emit(
                    &app,
                    if is_stdout { "stdout" } else { "stderr" },
                    Some(text),
                    None,
                );
            }
            Err(_) => break,
        }
    }
    // The writer side is closed; the wait task emits the exit event.
    let _ = &mut stream;
}

#[tauri::command]
pub async fn run_stop(app: AppHandle, state: State<'_, RunState>) -> Result<bool, String> {
    stop_current(&app, &state).await;
    Ok(true)
}

/// Keep the compiler from complaining about the unused import on platforms
/// where the async write is optimized away.
#[allow(dead_code)]
fn _write_helper() {
    let _ = AsyncWriteExt::flush;
}
