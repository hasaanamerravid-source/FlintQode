//! Project wide search and replace.
//!
//! The scan runs on a small Rayon pool in the native process, so a large
//! folder never blocks the editor. The folder rules match the Electron build:
//! dependency and build folders are skipped, hidden files are ignored and
//! files above 4 MB are not searched.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use rayon::prelude::*;
use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::fs::{decode_text, encode_text};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    pub folder: String,
    pub query: String,
    pub regex: Option<bool>,
    pub case_sensitive: Option<bool>,
    pub whole_word: Option<bool>,
    pub include: Option<String>,
    pub max_results: Option<usize>,
    pub replacement: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub path: String,
    pub line: usize,
    pub column: usize,
    pub text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub matches: Vec<SearchMatch>,
    pub files: usize,
    pub skipped: usize,
    pub truncated: bool,
    pub took: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceResult {
    pub changed: usize,
    pub replaced: usize,
    pub took: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

const SKIPPED_FOLDERS: [&str; 34] = [
    ".git",
    ".hg",
    ".svn",
    ".idea",
    ".vscode",
    ".vs",
    "node_modules",
    "bower_components",
    "jspm_packages",
    "vendor",
    "dist",
    "build",
    "out",
    "target",
    "bin",
    "obj",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".turbo",
    ".cache",
    ".parcel-cache",
    ".gradle",
    ".mvn",
    ".venv",
    "venv",
    "env",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".tox",
    "coverage",
    "htmlcov",
    "site-packages",
];

const MAX_FILE_BYTES: u64 = 4 * 1024 * 1024;
const MAX_FILES: usize = 20_000;
const MAX_RESULTS: usize = 2_000;
const MAX_PER_FILE: usize = 200;

fn matcher_of(request: &SearchRequest) -> Option<Regex> {
    let query = request.query.trim();
    if query.is_empty() {
        return None;
    }
    let mut source = if request.regex.unwrap_or(false) {
        query.to_string()
    } else {
        regex::escape(query)
    };
    if request.whole_word.unwrap_or(false) {
        source = format!(r"\b(?:{source})\b");
    }
    if !request.case_sensitive.unwrap_or(false) {
        source = format!("(?i){source}");
    }
    Regex::new(&source).ok().or_else(|| Regex::new(&format!("(?i){}", regex::escape(query))).ok())
}

fn matches_glob(name: &str, glob: &str) -> bool {
    let pattern = glob.trim().to_lowercase();
    if pattern.is_empty() {
        return true;
    }
    let name = name.to_lowercase();
    if pattern.contains('*') {
        let escaped = regex::escape(&pattern).replace(r"\*", ".*");
        return Regex::new(&format!("^{escaped}$"))
            .map(|regex| regex.is_match(&name))
            .unwrap_or(true);
    }
    name.ends_with(&pattern)
}

fn collect_files(folder: &str, glob: &str, limit: usize) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut queue = vec![PathBuf::from(folder)];
    while !queue.is_empty() && out.len() < limit {
        let current = queue.remove(0);
        let Ok(entries) = fs::read_dir(&current) else {
            continue;
        };
        for entry in entries.flatten() {
            if out.len() >= limit {
                break;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let lower = name.to_lowercase();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_dir() {
                if SKIPPED_FOLDERS.contains(&lower.as_str()) {
                    continue;
                }
                if name.starts_with('.') && name.len() > 1 && !lower.starts_with(".github") {
                    continue;
                }
                queue.push(entry.path());
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            if name.starts_with('.') && name.len() > 1 {
                continue;
            }
            if !matches_glob(&name, glob) {
                continue;
            }
            if let Ok(metadata) = entry.metadata() {
                if metadata.len() > MAX_FILE_BYTES {
                    continue;
                }
                out.push(entry.path());
            }
        }
    }
    out
}

fn position_of(text: &str, offset: usize) -> (usize, usize) {
    let before = &text[..offset.min(text.len())];
    let line = before.bytes().filter(|byte| *byte == b'\n').count() + 1;
    let line_start = before.rfind('\n').map(|index| index + 1).unwrap_or(0);
    let column = text[line_start..offset.min(text.len())].chars().count() + 1;
    (line, column)
}

fn line_at(text: &str, offset: usize) -> String {
    let at = offset.min(text.len());
    let start = text[..at].rfind('\n').map(|index| index + 1).unwrap_or(0);
    let end = text[at..]
        .find('\n')
        .map(|index| at + index)
        .unwrap_or(text.len());
    text[start..end].chars().take(400).collect()
}

/// Search the files of a folder.
pub fn search_in_files(request: &SearchRequest) -> SearchResult {
    let started = Instant::now();
    let Some(matcher) = matcher_of(request) else {
        return SearchResult {
            matches: Vec::new(),
            files: 0,
            skipped: 0,
            truncated: false,
            took: started.elapsed().as_millis() as u64,
            error: None,
        };
    };
    if request.folder.trim().is_empty() {
        return SearchResult {
            matches: Vec::new(),
            files: 0,
            skipped: 0,
            truncated: false,
            took: started.elapsed().as_millis() as u64,
            error: None,
        };
    }

    let limit = request.max_results.unwrap_or(MAX_RESULTS).min(MAX_RESULTS);
    let files = collect_files(&request.folder, request.include.as_deref().unwrap_or(""), MAX_FILES);
    let scanned = files.len();

    let per_file: Vec<(bool, Vec<SearchMatch>)> = files
        .par_iter()
        .map(|path| {
            let Ok(bytes) = fs::read(path) else {
                return (true, Vec::new());
            };
            let (text, _, binary) = decode_text(&bytes);
            if binary {
                return (true, Vec::new());
            }
            let mut found = Vec::new();
            for hit in matcher.find_iter(&text) {
                let (line, column) = position_of(&text, hit.start());
                found.push(SearchMatch {
                    path: path.to_string_lossy().to_string(),
                    line,
                    column,
                    text: line_at(&text, hit.start()),
                });
                if found.len() >= MAX_PER_FILE {
                    break;
                }
            }
            (false, found)
        })
        .collect();

    let mut matches = Vec::new();
    let mut skipped = 0usize;
    for (was_skipped, found) in per_file {
        if was_skipped {
            skipped += 1;
            continue;
        }
        for hit in found {
            if matches.len() >= limit {
                break;
            }
            matches.push(hit);
        }
    }

    SearchResult {
        truncated: matches.len() >= limit,
        matches,
        files: scanned,
        skipped,
        took: started.elapsed().as_millis() as u64,
        error: None,
    }
}

/// Replace the hits in the files of a folder.
pub fn replace_in_files(request: &SearchRequest) -> ReplaceResult {
    let started = Instant::now();
    let Some(matcher) = matcher_of(request) else {
        return ReplaceResult {
            changed: 0,
            replaced: 0,
            took: started.elapsed().as_millis() as u64,
            error: None,
        };
    };
    if request.folder.trim().is_empty() {
        return ReplaceResult {
            changed: 0,
            replaced: 0,
            took: started.elapsed().as_millis() as u64,
            error: None,
        };
    }

    let files = collect_files(&request.folder, request.include.as_deref().unwrap_or(""), MAX_FILES);
    let replacement = request.replacement.as_deref().unwrap_or("");
    let mut changed = 0usize;
    let mut replaced = 0usize;
    for path in files {
        let Ok(bytes) = fs::read(&path) else {
            continue;
        };
        let (text, encoding, binary) = decode_text(&bytes);
        if binary || !matcher.is_match(&text) {
            continue;
        }
        let count = matcher.find_iter(&text).count();
        let next = matcher.replace_all(&text, replacement).into_owned();
        if fs::write(&path, encode_text(&next, &encoding)).is_ok() {
            changed += 1;
            replaced += count;
        }
    }

    ReplaceResult {
        changed,
        replaced,
        took: started.elapsed().as_millis() as u64,
        error: None,
    }
}

/// Expose the folder scan to the command palette's quick switcher (currently
/// the renderer uses `fs.listRecursive`, this keeps the helper available).
#[allow(dead_code)]
pub fn is_hidden(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.starts_with('.'))
        .unwrap_or(false)
}
