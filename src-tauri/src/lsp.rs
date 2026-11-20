//! Language server host.
//!
//! The native process owns the language servers: it starts them, keeps them
//! alive and speaks the JSON-RPC protocol with them. The renderer never
//! spawns anything - it only sends documents and asks for answers.
//!
//! The framing is written by hand, exactly as the Electron build did:
//!
//! ```text
//! Content-Length: <n>\r\n\r\n<json>
//! ```
//!
//! One server is started per language group (TypeScript and JavaScript share
//! one process, C and C++ as well) and it is reused for every document of
//! that language.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::{oneshot, Mutex as AsyncMutex};

use crate::process::{find_executable, home_dir};

/* ------------------------------------------------------------------ *
 * The protocol types
 * ------------------------------------------------------------------ */

#[derive(Debug, Deserialize)]
pub struct DidOpenParams {
    pub language: String,
    pub uri: String,
    #[serde(default)]
    pub text: String,
}

#[derive(Debug, Deserialize)]
pub struct DidCloseParams {
    pub language: String,
    pub uri: String,
}

#[derive(Debug, Deserialize)]
pub struct RequestParams {
    pub language: String,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ServerOverride {
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub cwd: Option<String>,
    pub env: Option<HashMap<String, String>>,
    pub initialization_options: Option<Value>,
    #[serde(default)]
    pub disabled: bool,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LspConfigure {
    #[serde(default)]
    pub servers: HashMap<String, ServerOverride>,
    pub root_path: Option<String>,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LspProblem {
    pub line: usize,
    pub column: usize,
    pub from: usize,
    pub to: usize,
    pub severity: String,
    pub message: String,
    pub source: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LspStatusEvent {
    language: String,
    state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    hint: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LspDiagnosticsEvent {
    language: String,
    uri: String,
    problems: Vec<LspProblem>,
}

struct Reply {
    ok: bool,
    result: Value,
    error: Option<String>,
}

impl Reply {
    fn ok(result: Value) -> Self {
        Self {
            ok: true,
            result,
            error: None,
        }
    }

    fn error(message: impl Into<String>) -> Self {
        Self {
            ok: false,
            result: Value::Null,
            error: Some(message.into()),
        }
    }
}

#[derive(Clone)]
struct Document {
    language: String,
    text: String,
    version: i64,
}

/* ------------------------------------------------------------------ *
 * The language servers
 * ------------------------------------------------------------------ */

/// The default servers. The settings can replace the command and the
/// arguments of every language.
fn default_server(language: &str) -> Option<(&'static str, &'static [&'static str])> {
    match language {
        "go" => Some(("gopls", &[])),
        "java" => Some(("jdtls", &[])),
        "csharp" => Some(("csharp-ls", &[])),
        "rust" => Some(("rust-analyzer", &[])),
        "python" => Some(("pyright-langserver", &["--stdio"])),
        "typescript" => Some(("typescript-language-server", &["--stdio"])),
        "javascript" => Some(("typescript-language-server", &["--stdio"])),
        "jsx" => Some(("typescript-language-server", &["--stdio"])),
        "tsx" => Some(("typescript-language-server", &["--stdio"])),
        "c" => Some(("clangd", &["--background"])),
        "cpp" => Some(("clangd", &["--background"])),
        "php" => Some(("phpactor", &["language-server"])),
        "ruby" => Some(("ruby-lsp", &[])),
        "kotlin" => Some(("kotlin-language-server", &[])),
        "swift" => Some(("sourcekit-lsp", &[])),
        "lua" => Some(("lua-language-server", &[])),
        _ => None,
    }
}

const LANGUAGES: [&str; 16] = [
    "go",
    "java",
    "csharp",
    "rust",
    "python",
    "typescript",
    "javascript",
    "jsx",
    "tsx",
    "c",
    "cpp",
    "php",
    "ruby",
    "kotlin",
    "swift",
    "lua",
];

/// Languages that are served by the very same server process.
fn server_key(language: &str) -> String {
    match language.to_lowercase().as_str() {
        "javascript" => "typescript".to_string(),
        "jsx" => "typescript".to_string(),
        "tsx" => "typescript".to_string(),
        "cpp" => "c".to_string(),
        "objectivec" => "c".to_string(),
        other => other.to_string(),
    }
}

/// Every language that is served by the process of a key.
fn languages_of(key: &str) -> Vec<String> {
    LANGUAGES
        .iter()
        .filter(|language| server_key(language) == key)
        .map(|language| language.to_string())
        .collect()
}

fn install_hint(command: &str) -> Option<String> {
    let hint = match command {
        "gopls" => "Install it with `go install golang.org/x/tools/gopls@latest`.",
        "jdtls" => "Install the Eclipse JDT Language Server and put its launcher on the PATH.",
        "csharp-ls" => "Install the C# language server and put it on the PATH.",
        "rust-analyzer" => "Install it with `rustup component add rust-analyzer`.",
        "pyright-langserver" => "Install it with `npm install -g pyright`.",
        "typescript-language-server" => {
            "Install it with `npm install -g typescript-language-server typescript`."
        }
        "clangd" => "Install the LLVM toolchain - clangd comes with it.",
        "phpactor" => "Install it with `composer global require phpactor/phpactor`.",
        "ruby-lsp" => "Install it with `gem install ruby-lsp`.",
        "kotlin-language-server" => {
            "Install the Kotlin language server and put it on the PATH."
        }
        "sourcekit-lsp" => "It is part of the Swift toolchain.",
        "lua-language-server" => "Install it with `npm install -g lua-language-server`.",
        _ => return None,
    };
    Some(hint.to_string())
}

/// Look for a program in the node_modules of the running project (a local
/// install), the same fallback the Electron build had.
fn find_local_executable(name: &str) -> Option<PathBuf> {
    let names: Vec<String> = if cfg!(windows) {
        vec![format!("{name}.cmd"), format!("{name}.exe"), name.to_string()]
    } else {
        vec![name.to_string()]
    };
    let mut current = std::env::current_dir().ok()?;
    loop {
        let bin = current.join("node_modules").join(".bin");
        for candidate in &names {
            let full = bin.join(candidate);
            if full.is_file() {
                return Some(full);
            }
        }
        match current.parent() {
            Some(parent) => current = parent.to_path_buf(),
            None => return None,
        }
    }
}

fn resolve_command(name: &str) -> Option<PathBuf> {
    find_executable(name).or_else(|| find_local_executable(name))
}

fn home_or_temp() -> PathBuf {
    let home = home_dir();
    if home.is_dir() {
        home
    } else {
        std::env::temp_dir()
    }
}

/* ------------------------------------------------------------------ *
 * Small text helpers (the protocol counts UTF-16 code units)
 * ------------------------------------------------------------------ */

fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

/// The line and the UTF-16 column of a byte offset.
fn position_at(text: &str, offset: usize) -> (usize, usize) {
    let limit = offset.min(text.len());
    let mut line = 0usize;
    let mut start = 0usize;
    for (at, character) in text.char_indices() {
        if at >= limit {
            break;
        }
        if character == '\n' {
            line += 1;
            start = at + 1;
        }
    }
    (line, utf16_len(&text[start..limit]))
}

/// The UTF-16 offset of a line and a column.
fn offset_at(text: &str, line: usize, character: usize) -> usize {
    let mut current_line = 0usize;
    let mut start = 0usize;
    if line > 0 {
        for (at, byte) in text.bytes().enumerate() {
            if byte == b'\n' {
                current_line += 1;
                if current_line == line {
                    start = at + 1;
                    break;
                }
            }
        }
        if current_line < line {
            return utf16_len(text);
        }
    }
    let end = text[start..]
        .find('\n')
        .map(|index| start + index)
        .unwrap_or(text.len());
    let slice = &text[start..end];
    let mut counted = 0usize;
    let mut byte_offset = 0usize;
    for (at, value) in slice.char_indices() {
        if counted >= character {
            byte_offset = at;
            break;
        }
        counted += value.len_utf16();
        byte_offset = at + value.len_utf8();
    }
    utf16_len(&text[..start + byte_offset.min(slice.len())])
}

/// The longest common prefix of two texts, cut to a character boundary.
fn common_prefix(old: &str, new: &str) -> usize {
    let max = old.len().min(new.len());
    let old_bytes = old.as_bytes();
    let new_bytes = new.as_bytes();
    let mut prefix = 0usize;
    while prefix < max && old_bytes[prefix] == new_bytes[prefix] {
        prefix += 1;
    }
    while prefix > 0 && !old.is_char_boundary(prefix) {
        prefix -= 1;
    }
    prefix
}

fn common_suffix(old: &str, new: &str, prefix: usize) -> usize {
    let max = old.len().min(new.len()).saturating_sub(prefix);
    let old_bytes = old.as_bytes();
    let new_bytes = new.as_bytes();
    let mut suffix = 0usize;
    while suffix < max
        && old_bytes[old.len() - 1 - suffix] == new_bytes[new.len() - 1 - suffix]
    {
        suffix += 1;
    }
    while suffix > 0 && !old.is_char_boundary(old.len() - suffix) {
        suffix -= 1;
    }
    suffix
}

/* ------------------------------------------------------------------ *
 * The host state
 * ------------------------------------------------------------------ */

pub struct LspState {
    servers: Mutex<HashMap<String, Arc<LanguageServer>>>,
    documents: Arc<Mutex<HashMap<String, Document>>>,
    options: Mutex<LspOptions>,
}

impl Default for LspState {
    fn default() -> Self {
        Self {
            servers: Mutex::new(HashMap::new()),
            documents: Arc::new(Mutex::new(HashMap::new())),
            options: Mutex::new(LspOptions::default()),
        }
    }
}

#[derive(Default, Clone)]
struct LspOptions {
    servers: HashMap<String, ServerOverride>,
    root_path: Option<String>,
}

struct ResolvedConfig {
    command: String,
    args: Vec<String>,
    cwd: Option<PathBuf>,
    env: Vec<(String, String)>,
    initialization_options: Value,
}

fn resolve_config(options: &LspOptions, language: &str) -> Option<ResolvedConfig> {
    let key = server_key(language);
    let (default_command, default_args) = default_server(&key)?;
    let override_entry = options
        .servers
        .get(&language.to_lowercase())
        .or_else(|| options.servers.get(&key));
    if override_entry.map(|entry| entry.disabled).unwrap_or(false) {
        return None;
    }
    let command = override_entry
        .and_then(|entry| entry.command.clone())
        .unwrap_or_else(|| default_command.to_string());
    let args = override_entry
        .and_then(|entry| entry.args.clone())
        .unwrap_or_else(|| default_args.iter().map(|value| value.to_string()).collect());
    let cwd = override_entry
        .and_then(|entry| entry.cwd.clone())
        .or_else(|| options.root_path.clone())
        .map(PathBuf::from);
    let env = override_entry
        .and_then(|entry| entry.env.clone())
        .map(|map| map.into_iter().collect())
        .unwrap_or_default();
    let initialization_options = override_entry
        .and_then(|entry| entry.initialization_options.clone())
        .unwrap_or(Value::Null);
    Some(ResolvedConfig {
        command,
        args,
        cwd,
        env,
        initialization_options,
    })
}

/* ------------------------------------------------------------------ *
 * One language server process
 * ------------------------------------------------------------------ */

struct LanguageServer {
    key: String,
    languages: Vec<String>,
    config: ResolvedConfig,
    root: Option<PathBuf>,
    app: AppHandle,
    documents: Arc<Mutex<HashMap<String, Document>>>,
    state: Mutex<String>,
    child: Mutex<Option<Child>>,
    stdin: AsyncMutex<Option<ChildStdin>>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Reply>>>,
    next_id: AtomicU64,
    sync_kind: AtomicU8,
    open_close: AtomicBool,
    start_lock: AsyncMutex<()>,
}

impl LanguageServer {
    fn new(
        key: String,
        config: ResolvedConfig,
        root: Option<PathBuf>,
        app: AppHandle,
        documents: Arc<Mutex<HashMap<String, Document>>>,
    ) -> Self {
        Self {
            languages: languages_of(&key),
            key,
            config,
            root,
            app,
            documents,
            state: Mutex::new("stopped".to_string()),
            child: Mutex::new(None),
            stdin: AsyncMutex::new(None),
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            sync_kind: AtomicU8::new(1),
            open_close: AtomicBool::new(true),
            start_lock: AsyncMutex::new(()),
        }
    }

    fn state(&self) -> String {
        self.state.lock().map(|value| value.clone()).unwrap_or_else(|_| "stopped".to_string())
    }

    fn set_state(&self, state: &str, message: Option<String>, hint: Option<String>) {
        if let Ok(mut guard) = self.state.lock() {
            *guard = state.to_string();
        }
        for language in &self.languages {
            let _ = self.app.emit(
                "lsp:status",
                LspStatusEvent {
                    language: language.clone(),
                    state: state.to_string(),
                    message: message.clone(),
                    hint: hint.clone(),
                },
            );
        }
    }

    async fn ensure_started(self: &Arc<Self>) -> bool {
        if self.state() == "ready" {
            return true;
        }
        let _guard = self.start_lock.lock().await;
        if self.state() == "ready" {
            return true;
        }
        self.launch().await
    }

    async fn launch(self: &Arc<Self>) -> bool {
        self.set_state("starting", None, None);
        let command = self.config.command.clone();
        if command.trim().is_empty() {
            self.set_state(
                "error",
                Some(format!("No language server command was configured for {}.", self.key)),
                None,
            );
            return false;
        }

        let Some(resolved) = resolve_command(&command) else {
            let hint = install_hint(&command);
            self.set_state(
                "error",
                Some(format!("{command} was not found on this machine")),
                hint,
            );
            return false;
        };

        let program = resolved.to_string_lossy().to_string();
        let mut process = Command::new(&program);
        process
            .args(&self.config.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        if let Some(cwd) = &self.config.cwd {
            process.current_dir(cwd);
        }
        for (key, value) in &self.config.env {
            process.env(key, value);
        }
        #[cfg(unix)]
        process.process_group(0);

        let mut child = match process.spawn() {
            Ok(child) => child,
            Err(error) => {
                self.set_state(
                    "error",
                    Some(format!("Could not start {command}: {error}")),
                    install_hint(&command),
                );
                return false;
            }
        };

        let Some(stdin) = child.stdin.take() else {
            self.set_state("error", Some("The language server has no input stream.".to_string()), None);
            let _ = child.start_kill();
            return false;
        };
        let stdout = child.stdout.take();
        if let Ok(mut guard) = self.child.lock() {
            *guard = Some(child);
        }
        *self.stdin.lock().await = Some(stdin);

        if let Some(stdout) = stdout {
            let server = self.clone();
            tokio::spawn(async move {
                read_stdout(server, stdout).await;
            });
        }

        if let Some(mut stderr) = self.child.lock().ok().and_then(|mut guard| guard.as_mut().and_then(|child| child.stderr.take())) {
            tokio::spawn(async move {
                let mut buffer = [0u8; 4096];
                while matches!(stderr.read(&mut buffer).await, Ok(read) if read > 0) {
                    // The server writes its log to stderr; it is not shown.
                }
            });
        }

        self.initialize().await
    }

    fn initialize_params(&self) -> Value {
        let root = self.root.as_ref().map(|path| path.to_string_lossy().to_string());
        let root_uri = root.as_deref().map(to_file_uri);
        let name = self
            .root
            .as_ref()
            .and_then(|path| path.file_name())
            .map(|value| value.to_string_lossy().to_string());
        json!({
            "processId": std::process::id(),
            "clientInfo": { "name": "OpenNotes", "version": env!("CARGO_PKG_VERSION") },
            "locale": "en",
            "rootPath": root,
            "rootUri": root_uri,
            "workspaceFolders": match (&root_uri, &name) {
                (Some(uri), Some(name)) => json!([{ "uri": uri, "name": name }]),
                _ => Value::Null,
            },
            "initializationOptions": self.config.initialization_options,
            "capabilities": client_capabilities(),
            "trace": "off",
        })
    }

    async fn initialize(self: &Arc<Self>) -> bool {
        let reply = self
            .send_request("initialize", self.initialize_params(), Duration::from_secs(20))
            .await;
        if !reply.ok {
            let message = reply
                .error
                .unwrap_or_else(|| format!("{} did not start correctly.", self.config.command));
            self.set_state("error", Some(message.clone()), None);
            self.stop().await;
            return false;
        }
        self.read_capabilities(&reply.result);
        self.notify("initialized", json!({})).await;
        self.set_state("ready", None, None);
        true
    }

    fn read_capabilities(&self, result: &Value) {
        let Some(sync) = result
            .get("capabilities")
            .and_then(|capabilities| capabilities.get("textDocumentSync"))
        else {
            return;
        };
        if let Some(number) = sync.as_u64() {
            self.sync_kind.store(number.min(2) as u8, Ordering::SeqCst);
            return;
        }
        if let Some(options) = sync.as_object() {
            if let Some(change) = options.get("change").and_then(Value::as_u64) {
                self.sync_kind.store(change.min(2) as u8, Ordering::SeqCst);
            }
            if let Some(open_close) = options.get("openClose").and_then(Value::as_bool) {
                self.open_close.store(open_close, Ordering::SeqCst);
            }
        }
    }

    async fn stop(&self) {
        self.fail_pending("The language server was stopped.");
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let shutdown = json!({ "jsonrpc": "2.0", "id": id, "method": "shutdown", "params": Value::Null });
        let _ = self.send_raw(&shutdown).await;
        let exit = json!({ "jsonrpc": "2.0", "method": "exit", "params": Value::Null });
        let _ = self.send_raw(&exit).await;
        *self.stdin.lock().await = None;
        let child = self.child.lock().ok().and_then(|mut guard| guard.take());
        if let Some(mut child) = child {
            kill_tree(&mut child).await;
        }
        self.set_state("stopped", None, None);
    }

    async fn open_document(&self, uri: &str, language: &str, text: &str) {
        if self.sync_kind.load(Ordering::SeqCst) == 0 {
            return;
        }
        self.notify(
            "textDocument/didOpen",
            json!({
                "textDocument": { "uri": uri, "languageId": language, "version": 1, "text": text }
            }),
        )
        .await;
    }

    async fn change_document(&self, uri: &str, version: i64, old_text: &str, new_text: &str) {
        let sync_kind = self.sync_kind.load(Ordering::SeqCst);
        if sync_kind == 0 {
            return;
        }
        let change = if sync_kind == 2 {
            let prefix = common_prefix(old_text, new_text);
            let suffix = common_suffix(old_text, new_text, prefix);
            let old_end = old_text.len() - suffix;
            let new_end = new_text.len() - suffix;
            let (start_line, start_character) = position_at(old_text, prefix);
            let (end_line, end_character) = position_at(old_text, old_end);
            json!({
                "range": {
                    "start": { "line": start_line, "character": start_character },
                    "end": { "line": end_line, "character": end_character },
                },
                "text": &new_text[prefix..new_end],
            })
        } else {
            json!({ "text": new_text })
        };
        self.notify(
            "textDocument/didChange",
            json!({
                "textDocument": { "uri": uri, "version": version },
                "contentChanges": [change],
            }),
        )
        .await;
    }

    async fn close_document(&self, uri: &str) {
        if !self.open_close.load(Ordering::SeqCst) {
            return;
        }
        self.notify(
            "textDocument/didClose",
            json!({ "textDocument": { "uri": uri } }),
        )
        .await;
    }

    async fn request(&self, method: &str, params: Value) -> Option<Value> {
        if self.state() != "ready" {
            return None;
        }
        let reply = self
            .send_request(method, params, Duration::from_secs(5))
            .await;
        if reply.ok {
            Some(reply.result)
        } else {
            None
        }
    }

    async fn notify(&self, method: &str, params: Value) {
        let message = json!({ "jsonrpc": "2.0", "method": method, "params": params });
        let _ = self.send_raw(&message).await;
    }

    async fn send_request(&self, method: &str, params: Value, timeout: Duration) -> Reply {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (sender, receiver) = oneshot::channel();
        if let Ok(mut pending) = self.pending.lock() {
            pending.insert(id, sender);
        } else {
            return Reply::error("The language server is not available.");
        }
        let message = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        if !self.send_raw(&message).await {
            if let Ok(mut pending) = self.pending.lock() {
                pending.remove(&id);
            }
            return Reply::error("The language server is not running.");
        }
        match tokio::time::timeout(timeout, receiver).await {
            Ok(Ok(reply)) => reply,
            _ => {
                if let Ok(mut pending) = self.pending.lock() {
                    pending.remove(&id);
                }
                Reply::error("The language server did not answer in time.")
            }
        }
    }

    async fn send_raw(&self, message: &Value) -> bool {
        let Ok(body) = serde_json::to_vec(message) else {
            return false;
        };
        let mut guard = self.stdin.lock().await;
        let Some(stdin) = guard.as_mut() else {
            return false;
        };
        let header = format!("Content-Length: {}\r\n\r\n", body.len());
        if stdin.write_all(header.as_bytes()).await.is_err() {
            return false;
        }
        if stdin.write_all(&body).await.is_err() {
            return false;
        }
        stdin.flush().await.is_ok()
    }

    fn fail_pending(&self, error: &str) {
        if let Ok(mut pending) = self.pending.lock() {
            for (_, sender) in pending.drain() {
                let _ = sender.send(Reply::error(error));
            }
        }
    }

    async fn handle_message(self: &Arc<Self>, message: Value) {
        let method = message
            .get("method")
            .and_then(Value::as_str)
            .map(str::to_string);
        let id = message.get("id").filter(|value| !value.is_null()).cloned();
        match (method, id) {
            (Some(method), Some(id)) => {
                let params = message.get("params").cloned().unwrap_or(Value::Null);
                let result = self.answer_for(&method, &params);
                let response = json!({ "jsonrpc": "2.0", "id": id, "result": result });
                let _ = self.send_raw(&response).await;
            }
            (Some(method), None) => {
                let params = message.get("params").cloned().unwrap_or(Value::Null);
                self.handle_notification(&method, &params).await;
            }
            (None, Some(id)) => {
                let number = id.as_u64();
                let Some(number) = number else {
                    return;
                };
                let sender = self
                    .pending
                    .lock()
                    .ok()
                    .and_then(|mut pending| pending.remove(&number));
                let Some(sender) = sender else {
                    return;
                };
                if let Some(error) = message.get("error") {
                    let text = error
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("The language server reported an error.");
                    let _ = sender.send(Reply::error(text));
                } else {
                    let result = message.get("result").cloned().unwrap_or(Value::Null);
                    let _ = sender.send(Reply::ok(result));
                }
            }
            _ => {}
        }
    }

    fn answer_for(&self, method: &str, _params: &Value) -> Value {
        match method {
            "workspace/configuration" => json!([]),
            "workspace/workspaceFolders" => match &self.root {
                Some(root) => {
                    let name = root
                        .file_name()
                        .map(|value| value.to_string_lossy().to_string())
                        .unwrap_or_default();
                    json!([{ "uri": to_file_uri(&root.to_string_lossy()), "name": name }])
                }
                None => Value::Null,
            },
            "workspace/applyEdit" => json!({ "applied": false }),
            _ => Value::Null,
        }
    }

    async fn handle_notification(self: &Arc<Self>, method: &str, params: &Value) {
        match method {
            "textDocument/publishDiagnostics" => self.publish_diagnostics(params),
            "exit" => self.stop().await,
            _ => {}
        }
    }

    fn publish_diagnostics(&self, params: &Value) {
        let Some(uri) = params.get("uri").and_then(Value::as_str) else {
            return;
        };
        let (language, text) = {
            let Ok(documents) = self.documents.lock() else {
                return;
            };
            match documents.get(uri) {
                Some(document) => (document.language.clone(), document.text.clone()),
                None => (
                    self.languages.first().cloned().unwrap_or_else(|| "lsp".to_string()),
                    String::new(),
                ),
            }
        };
        let mut problems = Vec::new();
        if let Some(list) = params.get("diagnostics").and_then(Value::as_array) {
            for item in list {
                if let Some(problem) = to_problem(item, &text, &language) {
                    problems.push(problem);
                }
            }
        }
        let _ = self.app.emit(
            "lsp:diagnostics",
            LspDiagnosticsEvent {
                language,
                uri: uri.to_string(),
                problems,
            },
        );
    }

    async fn on_reader_closed(self: &Arc<Self>) {
        if let Ok(mut guard) = self.child.lock() {
            *guard = None;
        }
        *self.stdin.lock().await = None;
        self.fail_pending("The language server stopped.");
        if self.state() != "stopped" {
            self.set_state("stopped", None, None);
        }
    }
}

async fn read_stdout(server: Arc<LanguageServer>, mut stdout: ChildStdout) {
    let mut buffer: Vec<u8> = Vec::new();
    let mut chunk = vec![0u8; 8192];
    loop {
        let read = match stdout.read(&mut chunk).await {
            Ok(0) => break,
            Ok(read) => read,
            Err(_) => break,
        };
        buffer.extend_from_slice(&chunk[..read]);
        loop {
            let Some(index) = find_header_end(&buffer) else {
                break;
            };
            let header = String::from_utf8_lossy(&buffer[..index]).to_string();
            let Some(length) = parse_content_length(&header) else {
                buffer.drain(..index + 4);
                continue;
            };
            let start = index + 4;
            if buffer.len() < start + length {
                break;
            }
            let body = buffer[start..start + length].to_vec();
            buffer.drain(..start + length);
            if let Ok(message) = serde_json::from_slice::<Value>(&body) {
                server.handle_message(message).await;
            }
        }
    }
    server.on_reader_closed().await;
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn parse_content_length(header: &str) -> Option<usize> {
    for line in header.split("\r\n") {
        let Some(index) = line.find(':') else {
            continue;
        };
        if !line[..index].trim().eq_ignore_ascii_case("content-length") {
            continue;
        }
        return line[index + 1..].trim().parse::<usize>().ok();
    }
    None
}

async fn kill_tree(child: &mut Child) {
    #[cfg(unix)]
    {
        if let Some(pid) = child.id() {
            unsafe {
                libc::kill(-(pid as i32), libc::SIGTERM);
            }
        }
    }
    let _ = child.kill().await;
}

/* ------------------------------------------------------------------ *
 * Problems
 * ------------------------------------------------------------------ */

fn severity_of(value: Option<u64>) -> &'static str {
    match value {
        Some(1) => "error",
        Some(2) => "warning",
        _ => "info",
    }
}

fn to_problem(raw: &Value, text: &str, language: &str) -> Option<LspProblem> {
    let start = raw.get("range").and_then(|range| range.get("start"))?;
    let start_line = start.get("line").and_then(Value::as_u64)? as usize;
    let start_character = start
        .get("character")
        .and_then(Value::as_u64)
        .unwrap_or(0) as usize;
    let end = raw.get("range").and_then(|range| range.get("end"));
    let end_line = end
        .and_then(|value| value.get("line"))
        .and_then(Value::as_u64)
        .map(|value| value as usize)
        .unwrap_or(start_line);
    let end_character = end
        .and_then(|value| value.get("character"))
        .and_then(Value::as_u64)
        .map(|value| value as usize)
        .unwrap_or(start_character);

    let from = offset_at(text, start_line, start_character);
    let to = offset_at(text, end_line, end_character).max(from);
    Some(LspProblem {
        line: start_line + 1,
        column: start_character + 1,
        from,
        to,
        severity: severity_of(raw.get("severity").and_then(Value::as_u64)).to_string(),
        message: raw
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        source: raw
            .get("source")
            .and_then(Value::as_str)
            .unwrap_or(language)
            .to_string(),
    })
}

/* ------------------------------------------------------------------ *
 * URIs
 * ------------------------------------------------------------------ */

/// Turn a path into a `file:` uri. A uri stays as it is.
pub fn to_file_uri(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if trimmed.starts_with("file://") {
        return trimmed.to_string();
    }
    let has_scheme = trimmed
        .split_once(':')
        .map(|(scheme, _)| {
            !scheme.is_empty()
                && scheme.chars().next().map(|c| c.is_ascii_alphabetic()).unwrap_or(false)
                && scheme
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
        })
        .unwrap_or(false);
    let is_drive = trimmed.len() > 2
        && trimmed.as_bytes()[1] == b':'
        && matches!(trimmed.as_bytes()[2], b'\\' | b'/');
    if has_scheme && !is_drive {
        return trimmed.to_string();
    }
    let path = Path::new(trimmed);
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map(|dir| dir.join(path))
            .unwrap_or_else(|_| path.to_path_buf())
    };
    url::Url::from_file_path(&absolute)
        .map(|url| url.to_string())
        .unwrap_or_else(|_| trimmed.to_string())
}

/// Turn a `file:` uri into a path (a path stays as it is).
pub fn from_file_uri(value: &str) -> String {
    if !value.starts_with("file://") {
        return value.to_string();
    }
    url::Url::parse(value)
        .ok()
        .and_then(|url| url.to_file_path().ok())
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| value.to_string())
}

/* ------------------------------------------------------------------ *
 * The client capabilities
 * ------------------------------------------------------------------ */

fn client_capabilities() -> Value {
    json!({
        "general": { "positionEncodings": ["utf-16"] },
        "workspace": {
            "applyEdit": false,
            "configuration": true,
            "didChangeConfiguration": { "dynamicRegistration": false },
            "didChangeWatchedFiles": { "dynamicRegistration": false },
            "executeCommand": { "dynamicRegistration": false },
            "symbol": { "dynamicRegistration": false },
            "workspaceEdit": { "documentChanges": false },
            "workspaceFolders": true
        },
        "textDocument": {
            "synchronization": {
                "dynamicRegistration": false,
                "didSave": false,
                "willSave": false,
                "willSaveWaitUntil": false
            },
            "publishDiagnostics": {
                "relatedInformation": true,
                "versionSupport": false,
                "tagSupport": { "valueSet": [1, 2] },
                "codeDescriptionSupport": true,
                "dataSupport": true
            },
            "hover": { "dynamicRegistration": false, "contentFormat": ["markdown", "plaintext"] },
            "completion": {
                "dynamicRegistration": false,
                "completionItem": {
                    "snippetSupport": true,
                    "documentationFormat": ["markdown", "plaintext"],
                    "resolveSupport": { "properties": ["documentation", "detail", "additionalTextEdits"] }
                }
            },
            "definition": { "dynamicRegistration": false, "linkSupport": true },
            "typeDefinition": { "dynamicRegistration": false, "linkSupport": true },
            "implementation": { "dynamicRegistration": false, "linkSupport": true },
            "references": { "dynamicRegistration": false },
            "documentSymbol": { "dynamicRegistration": false, "hierarchicalDocumentSymbolSupport": true },
            "signatureHelp": { "dynamicRegistration": false },
            "formatting": { "dynamicRegistration": false },
            "rangeFormatting": { "dynamicRegistration": false },
            "codeAction": { "dynamicRegistration": false },
            "codeLens": { "dynamicRegistration": false },
            "rename": { "dynamicRegistration": false },
            "inlayHint": { "dynamicRegistration": false }
        },
        "window": {
            "workDoneProgress": true,
            "showMessage": {},
            "showDocument": { "support": true }
        }
    })
}

/* ------------------------------------------------------------------ *
 * The commands
 * ------------------------------------------------------------------ */

async fn ensure_server(
    app: &AppHandle,
    state: &LspState,
    language: &str,
) -> Option<Arc<LanguageServer>> {
    let normalized = language.trim().to_lowercase();
    if normalized.is_empty() {
        return None;
    }
    let key = server_key(&normalized);
    let config = {
        let options = state.options.lock().ok()?.clone();
        resolve_config(&options, &normalized)?
    };
    let existing = state
        .servers
        .lock()
        .ok()
        .and_then(|servers| servers.get(&key).cloned());
    let server = match existing {
        Some(server) => server,
        None => {
            let root = state
                .options
                .lock()
                .ok()
                .and_then(|options| options.root_path.clone())
                .map(PathBuf::from);
            let server = Arc::new(LanguageServer::new(
                key.clone(),
                config,
                root,
                app.clone(),
                state.documents.clone(),
            ));
            if let Ok(mut servers) = state.servers.lock() {
                servers.insert(key, server.clone());
            }
            server
        }
    };
    if server.ensure_started().await {
        Some(server)
    } else {
        None
    }
}

#[tauri::command]
pub async fn lsp_start(
    app: AppHandle,
    state: State<'_, LspState>,
    languages: Vec<String>,
) -> Result<Vec<String>, String> {
    let mut started = Vec::new();
    for language in languages {
        if ensure_server(&app, &state, &language).await.is_some() {
            started.push(language.trim().to_lowercase());
        }
    }
    Ok(started)
}

#[tauri::command]
pub async fn lsp_did_open(
    app: AppHandle,
    state: State<'_, LspState>,
    params: DidOpenParams,
) -> Result<bool, String> {
    let language = params.language.trim().to_lowercase();
    let uri = to_file_uri(&params.uri);
    if language.is_empty() || uri.is_empty() {
        return Ok(false);
    }
    let Some(server) = ensure_server(&app, &state, &language).await else {
        return Ok(false);
    };
    if let Ok(mut documents) = state.documents.lock() {
        documents.insert(
            uri.clone(),
            Document {
                language: language.clone(),
                text: params.text.clone(),
                version: 1,
            },
        );
    }
    server.open_document(&uri, &language, &params.text).await;
    Ok(true)
}

#[tauri::command]
pub async fn lsp_did_change(
    app: AppHandle,
    state: State<'_, LspState>,
    params: DidOpenParams,
) -> Result<bool, String> {
    let language = params.language.trim().to_lowercase();
    let uri = to_file_uri(&params.uri);
    if language.is_empty() || uri.is_empty() {
        return Ok(false);
    }
    let Some(server) = ensure_server(&app, &state, &language).await else {
        return Ok(false);
    };
    let (version, old_text) = {
        let Ok(mut documents) = state.documents.lock() else {
            return Ok(false);
        };
        match documents.get(&uri) {
            Some(document) => {
                let version = document.version + 1;
                let old = document.text.clone();
                documents.insert(
                    uri.clone(),
                    Document {
                        language,
                        text: params.text.clone(),
                        version,
                    },
                );
                (version, old)
            }
            None => {
                documents.insert(
                    uri.clone(),
                    Document {
                        language: language.clone(),
                        text: params.text.clone(),
                        version: 1,
                    },
                );
                (1, String::new())
            }
        }
    };
    server
        .change_document(&uri, version, &old_text, &params.text)
        .await;
    Ok(true)
}

#[tauri::command]
pub async fn lsp_did_close(
    app: AppHandle,
    state: State<'_, LspState>,
    params: DidCloseParams,
) -> Result<bool, String> {
    let language = params.language.trim().to_lowercase();
    let uri = to_file_uri(&params.uri);
    if uri.is_empty() {
        return Ok(false);
    }
    if let Ok(mut documents) = state.documents.lock() {
        documents.remove(&uri);
    }
    if language.is_empty() {
        return Ok(true);
    }
    let key = server_key(&language);
    let server = state
        .servers
        .lock()
        .ok()
        .and_then(|servers| servers.get(&key).cloned());
    if let Some(server) = server {
        server.close_document(&uri).await;
    }
    Ok(true)
}

#[tauri::command]
pub async fn lsp_request(
    app: AppHandle,
    state: State<'_, LspState>,
    params: RequestParams,
) -> Result<Option<Value>, String> {
    let language = params.language.trim().to_lowercase();
    let method = params.method.trim().to_string();
    if language.is_empty() || method.is_empty() {
        return Ok(None);
    }
    let Some(server) = ensure_server(&app, &state, &language).await else {
        return Ok(None);
    };
    Ok(server.request(&method, params.params).await)
}

#[tauri::command]
pub async fn lsp_stop(state: State<'_, LspState>, language: Option<String>) -> Result<bool, String> {
    let target = language
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty());
    if let Some(language) = target {
        let key = server_key(&language);
        let server = state
            .servers
            .lock()
            .ok()
            .and_then(|mut servers| servers.remove(&key));
        if let Some(server) = server {
            server.stop().await;
        }
        return Ok(true);
    }
    let servers: Vec<Arc<LanguageServer>> = state
        .servers
        .lock()
        .ok()
        .map(|mut map| map.drain().map(|(_, server)| server).collect())
        .unwrap_or_default();
    for server in servers {
        server.stop().await;
    }
    Ok(true)
}

#[tauri::command]
pub async fn lsp_configure(
    app: AppHandle,
    state: State<'_, LspState>,
    config: LspConfigure,
) -> Result<bool, String> {
    let next = LspOptions {
        servers: config
            .servers
            .into_iter()
            .map(|(key, value)| (key.trim().to_lowercase(), value))
            .collect(),
        root_path: config.root_path,
    };
    if let Ok(mut options) = state.options.lock() {
        *options = next.clone();
    }

    // A server whose command changed is stopped: the next document opens it
    // again with the new command.
    let stale: Vec<(String, Arc<LanguageServer>)> = {
        let Ok(servers) = state.servers.lock() else {
            return Ok(false);
        };
        servers
            .iter()
            .filter_map(|(key, server)| {
                let Some(language) = server.languages.first() else {
                    return None;
                };
                let Some(resolved) = resolve_config(&next, language) else {
                    return Some((key.clone(), server.clone()));
                };
                let same = resolved.command == server.config.command
                    && resolved.args == server.config.args;
                if same {
                    None
                } else {
                    Some((key.clone(), server.clone()))
                }
            })
            .collect()
    };
    for (key, server) in stale {
        if let Ok(mut servers) = state.servers.lock() {
            servers.remove(&key);
        }
        server.stop().await;
    }
    let _ = app;
    Ok(true)
}

/// Stop every server (the app is going down).
pub async fn stop_all(state: &LspState) {
    let servers: Vec<Arc<LanguageServer>> = state
        .servers
        .lock()
        .ok()
        .map(|mut map| map.drain().map(|(_, server)| server).collect())
        .unwrap_or_default();
    for server in servers {
        server.stop().await;
    }
}

/// Kept for a future "open the terminal in the project" command.
#[allow(dead_code)]
fn project_root(root: &Option<PathBuf>) -> PathBuf {
    root.clone().unwrap_or_else(home_or_temp)
}
