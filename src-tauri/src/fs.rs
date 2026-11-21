//! Filesystem commands.
//!
//! The behaviour matches the old Electron main process: byte order marks are
//! detected, UTF-16 and the common legacy encodings are decoded, binary files
//! are reported instead of being opened, and very large files are truncated.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

use encoding_rs::Encoding;
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

const MAX_EDIT_BYTES: u64 = 24 * 1024 * 1024;
const IGNORED: [&str; 9] = [
    "node_modules",
    ".git",
    ".svn",
    ".hg",
    "dist",
    "out",
    ".cache",
    ".next",
    "target",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub mtime: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePayload {
    pub path: String,
    pub content: String,
    pub encoding: String,
    pub eol: String,
    pub binary: bool,
    pub kind: String,
    pub size: u64,
    pub truncated: bool,
}

#[derive(Default)]
pub struct Watchers(pub Mutex<HashMap<String, RecommendedWatcher>>);

/// Detect the dominant line ending of a text buffer.
pub fn detect_eol(text: &str) -> &'static str {
    let bytes = text.as_bytes();
    let mut crlf = 0u64;
    let mut lf = 0u64;
    let mut cr = 0u64;
    let mut index = 0usize;
    while index < bytes.len() {
        match bytes[index] {
            b'\r' => {
                if bytes.get(index + 1) == Some(&b'\n') {
                    crlf += 1;
                    index += 1;
                } else {
                    cr += 1;
                }
            }
            b'\n' => lf += 1,
            _ => {}
        }
        index += 1;
    }
    if crlf == 0 && lf == 0 && cr == 0 {
        return "\n";
    }
    if crlf >= lf && crlf >= cr {
        "\r\n"
    } else if cr >= lf {
        "\r"
    } else {
        "\n"
    }
}

/// Normalise every line ending to `\n` for the editor.
pub fn normalize_eol(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

/// Apply a line ending style to `\n`-normalised text.
pub fn apply_eol(text: &str, eol: &str) -> String {
    match eol {
        "\r" => text.replace('\n', "\r"),
        "\r\n" => text.replace('\n', "\r\n"),
        _ => text.to_string(),
    }
}

fn detect_bom(bytes: &[u8]) -> (&'static str, usize) {
    if bytes.len() >= 3 && bytes[0] == 0xef && bytes[1] == 0xbb && bytes[2] == 0xbf {
        return ("utf8", 3);
    }
    if bytes.len() >= 2 && bytes[0] == 0xff && bytes[1] == 0xfe {
        return ("utf16-le", 2);
    }
    if bytes.len() >= 2 && bytes[0] == 0xfe && bytes[1] == 0xff {
        return ("utf16-be", 2);
    }
    ("utf8", 0)
}

fn is_probably_binary(bytes: &[u8]) -> bool {
    // A single stray null byte in the first 8 KB no longer makes a file binary.
    // Only a high density of null bytes (typical of real binary data) does.
    let sample: Vec<u8> = bytes.iter().copied().take(8000).collect();
    if sample.is_empty() {
        return false;
    }
    let nulls = sample.iter().filter(|b| **b == 0).count();
    (nulls * 100) / sample.len() > 5
}

/// Decode a buffer. Returns the text, the encoding and whether it is binary.
pub fn decode_text(bytes: &[u8]) -> (String, String, bool) {
    let (encoding, skip) = detect_bom(bytes);
    let utf16 = encoding == "utf16-le" || encoding == "utf16-be";
    if !utf16 && is_probably_binary(bytes) {
        return (String::new(), "binary".to_string(), true);
    }
    let body = &bytes[skip..];
    let text = match encoding {
        "utf16-le" => encoding_rs::UTF_16LE.decode(body).0.into_owned(),
        "utf16-be" => encoding_rs::UTF_16BE.decode(body).0.into_owned(),
        _ => encoding_rs::UTF_8.decode(body).0.into_owned(),
    };
    (text, encoding.to_string(), false)
}

/// Decode a file with an explicitly chosen legacy encoding.
fn decode_with(bytes: &[u8], encoding: &str) -> String {
    let label = encoding.trim().to_lowercase();
    if matches!(label.as_str(), "" | "utf8" | "utf8-bom") {
        return encoding_rs::UTF_8.decode(bytes).0.into_owned();
    }
    if label == "utf16-le" || label == "utf16le" {
        return encoding_rs::UTF_16LE.decode(bytes).0.into_owned();
    }
    if label == "utf16-be" || label == "utf16be" {
        return encoding_rs::UTF_16BE.decode(bytes).0.into_owned();
    }
    // The labels the settings offer are mostly the WHATWG labels, so they can
    // be looked up directly. cp437 is not part of encoding_rs; Latin-1 is the
    // closest printable fallback.
    let mapped = if label == "cp437" {
        "windows-1252"
    } else {
        label.as_str()
    };
    match Encoding::for_label(mapped.as_bytes()) {
        Some(codec) => codec.decode(bytes).0.into_owned(),
        None => encoding_rs::UTF_8.decode(bytes).0.into_owned(),
    }
}

/// Encode text for writing. A BOM is added when the encoding asks for one.
pub fn encode_text(text: &str, encoding: &str) -> Vec<u8> {
    let label = encoding.trim().to_lowercase();
    let mut out = Vec::new();
    let codec: &'static Encoding = match label.as_str() {
        "utf16-le" | "utf16le" => {
            out.extend_from_slice(&[0xff, 0xfe]);
            encoding_rs::UTF_16LE
        }
        "utf16-be" | "utf16be" => {
            out.extend_from_slice(&[0xfe, 0xff]);
            encoding_rs::UTF_16BE
        }
        "" | "utf8" | "utf8-bom" => {
            if label == "utf8-bom" {
                out.extend_from_slice(&[0xef, 0xbb, 0xbf]);
            }
            encoding_rs::UTF_8
        }
        "cp437" => Encoding::for_label(b"windows-1252").unwrap_or(encoding_rs::UTF_8),
        other => Encoding::for_label(other.as_bytes()).unwrap_or(encoding_rs::UTF_8),
    };
    let (encoded, _, _) = codec.encode(text);
    out.extend_from_slice(&encoded);
    out
}

fn detect_kind(path: &str, text: &str) -> String {
    let extension = Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase();
    if ["html", "htm", "xhtml"].contains(&extension.as_str()) {
        return "html".to_string();
    }
    if ["md", "markdown", "mdx", "mdown"].contains(&extension.as_str()) {
        return "markdown".to_string();
    }
    if ["csv", "tsv"].contains(&extension.as_str()) {
        return "csv".to_string();
    }
    if text.trim_start().starts_with('<') {
        return "html".to_string();
    }
    "text".to_string()
}

fn to_entry(path: &Path, metadata: &fs::Metadata) -> DirEntry {
    let mtime = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_millis() as f64)
        .unwrap_or(0.0);
    DirEntry {
        name: path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| path.to_string_lossy().to_string()),
        path: path.to_string_lossy().to_string(),
        is_dir: metadata.is_dir(),
        size: metadata.len(),
        mtime,
    }
}

fn empty_payload(path: &str) -> FilePayload {
    FilePayload {
        path: path.to_string(),
        content: String::new(),
        encoding: "utf8".to_string(),
        eol: "\n".to_string(),
        binary: false,
        kind: "text".to_string(),
        size: 0,
        truncated: false,
    }
}

#[tauri::command]
pub fn fs_read_file(path: String) -> FilePayload {
    // Canonicalize so that the same file opened with different casing always
    // resolves to the same path everywhere in the renderer.
    let path = std::fs::canonicalize(&path)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or(path);
    let mut buffer = Vec::new();
    let mut size = 0u64;
    let mut limit = 0u64;
    if let Ok(mut file) = File::open(&path) {
        if let Ok(metadata) = file.metadata() {
            size = metadata.len();
            limit = size.min(MAX_EDIT_BYTES);
            buffer.reserve(limit as usize);
        }
        if limit > 0 {
            let _ = file.take(limit).read_to_end(&mut buffer);
        }
    } else {
        return empty_payload(&path);
    }

    let (encoding, skip) = detect_bom(&buffer);
    let utf16 = encoding == "utf16-le" || encoding == "utf16-be";
    if !utf16 && is_probably_binary(&buffer) {
        return FilePayload {
            path,
            content: String::new(),
            encoding: "binary".to_string(),
            eol: "\n".to_string(),
            binary: true,
            kind: "binary".to_string(),
            size,
            truncated: false,
        };
    }

    let decoded = decode_with(&buffer[skip..], encoding);
    let kind = detect_kind(&path, &decoded);
    FilePayload {
        path,
        content: normalize_eol(&decoded),
        encoding: encoding.to_string(),
        eol: detect_eol(&decoded).to_string(),
        binary: false,
        kind,
        size,
        truncated: size > MAX_EDIT_BYTES,
    }
}

#[tauri::command]
pub fn fs_write_file(
    path: String,
    content: String,
    encoding: String,
    eol: String,
) -> Result<(), String> {
    let path = std::fs::canonicalize(&path)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or(path);
    let payload = apply_eol(&normalize_eol(&content), &eol);
    let bytes = encode_text(&payload, &encoding);
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(&path, bytes).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn fs_read_dir(path: String) -> Vec<DirEntry> {
    let dir = Path::new(&path);
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut result = Vec::new();
    for entry in entries.flatten() {
        let full = entry.path();
        if let Ok(metadata) = entry.metadata() {
            result.push(to_entry(&full, &metadata));
        }
    }
    result.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    result
}

#[tauri::command]
pub fn fs_list_recursive(path: String, max_depth: Option<u32>) -> Vec<DirEntry> {
    let limit = max_depth.unwrap_or(12);
    let mut result = Vec::new();
    let mut stack = vec![(PathBuf::from(path), 0u32)];
    while let Some((dir, depth)) = stack.pop() {
        if depth > limit {
            continue;
        }
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if IGNORED.contains(&name.as_str()) || name.starts_with('.') {
                continue;
            }
            let full = entry.path();
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            result.push(to_entry(&full, &metadata));
            if metadata.is_dir() {
                stack.push((full, depth + 1));
            }
        }
    }
    result
}

#[tauri::command]
pub fn fs_stat(path: String) -> Option<DirEntry> {
    let full = Path::new(&path);
    let metadata = fs::metadata(full).ok()?;
    Some(to_entry(full, &metadata))
}

#[tauri::command]
pub fn fs_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
pub fn fs_make_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn fs_remove(path: String) -> Result<(), String> {
    let target = Path::new(&path);
    if target.is_dir() {
        fs::remove_dir_all(target).map_err(|error| error.to_string())
    } else {
        match fs::remove_file(target) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }
}

#[tauri::command]
pub fn fs_rename(from: String, to: String) -> Result<(), String> {
    fs::rename(&from, &to).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn fs_copy_file(from: String, to: String) -> Result<(), String> {
    fs::copy(&from, &to)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn fs_show_in_folder(path: String) -> Result<(), String> {
    let target = Path::new(&path);
    #[cfg(target_os = "windows")]
    {
        crate::process::spawn_detached("explorer", &[format!("/select,{}", target.display())], None)
            .map_err(|error| error.to_string())
    }
    #[cfg(target_os = "macos")]
    {
        crate::process::spawn_detached(
            "open",
            &["-R".to_string(), target.display().to_string()],
            None,
        )
        .map_err(|error| error.to_string())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let folder = target.parent().unwrap_or(target);
        crate::process::spawn_detached("xdg-open", &[folder.display().to_string()], None)
            .map_err(|error| error.to_string())
    }
}

#[tauri::command]
pub fn fs_read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn fs_write_text_file(path: String, text: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(&path, text).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn fs_watch(app: AppHandle, state: State<'_, Watchers>, path: String) -> Result<(), String> {
    let path = std::fs::canonicalize(&path)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or(path);
    let watched = path.clone();
    let handle = app.clone();
    let mut watcher =
        notify::recommended_watcher(move |result: notify::Result<notify::Event>| match result {
            Ok(event) => {
                if matches!(
                    event.kind,
                    EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_)
                ) {
                    let _ = handle.emit("fs:changed", watched.clone());
                }
            }
            Err(error) => eprintln!("[opennotes] watcher: {error}"),
        })
        .map_err(|error| error.to_string())?;

    watcher
        .watch(Path::new(&path), RecursiveMode::NonRecursive)
        .map_err(|error| error.to_string())?;

    if let Ok(mut watchers) = state.0.lock() {
        if let Some(mut old) = watchers.remove(&path) {
            let _ = old.unwatch(Path::new(&path));
        }
        watchers.insert(path, watcher);
    }
    Ok(())
}

#[tauri::command]
pub fn fs_unwatch(state: State<'_, Watchers>, path: String) -> Result<(), String> {
    let path = std::fs::canonicalize(&path)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or(path);
    if let Ok(mut watchers) = state.0.lock() {
        if let Some(mut watcher) = watchers.remove(&path) {
            let _ = watcher.unwatch(Path::new(&path));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn fs_search(request: crate::search::SearchRequest) -> crate::search::SearchResult {
    crate::search::search_in_files(&request)
}

#[tauri::command]
pub fn fs_replace_in_files(request: crate::search::SearchRequest) -> crate::search::ReplaceResult {
    crate::search::replace_in_files(&request)
}

/// A tiny helper for the commands that take a path and only need the text of
/// a settings-like file.
pub fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Option<T> {
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}
