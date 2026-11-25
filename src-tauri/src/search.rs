//! Project wide search and replace.
//!
//! The scan runs on a small Rayon pool in the native process, so a large
//! folder never blocks the editor. The folder rules match the Electron build:
//! dependency and build folders are skipped, hidden files are ignored and
//! files above 4 MB are not searched.

use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use rayon::prelude::*;
use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::fs::{decode_text, encode_text, write_atomic};

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

/// An include rule compiled once per search instead of once per file.
enum Glob {
    All,
    Suffix(String),
    Regex(Regex),
}

impl Glob {
    fn from_pattern(glob: &str) -> Self {
        let pattern = glob.trim().to_lowercase();
        if pattern.is_empty() {
            return Self::All;
        }
        if !pattern.contains('*') {
            return Self::Suffix(pattern);
        }
        let escaped = regex::escape(&pattern).replace(r"\*", ".*");
        match Regex::new(&format!("^{escaped}$")) {
            Ok(regex) => Self::Regex(regex),
            Err(_) => Self::All,
        }
    }

    fn matches(&self, name: &str) -> bool {
        if matches!(self, Self::All) {
            return true;
        }
        let name = name.to_lowercase();
        match self {
            Self::All => true,
            Self::Suffix(suffix) => name.ends_with(suffix),
            Self::Regex(regex) => regex.is_match(&name),
        }
    }
}

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
    Regex::new(&source)
        .ok()
        .or_else(|| Regex::new(&format!("(?i){}", regex::escape(query))).ok())
}

fn collect_files(folder: &str, glob: &Glob, limit: usize) -> Vec<PathBuf> {
    let mut out = Vec::new();
    // A VecDeque keeps the scan linear. `Vec::remove(0)` shifted the entire
    // queue for every directory in a large workspace.
    let mut queue = VecDeque::from([PathBuf::from(folder)]);
    while let Some(current) = queue.pop_front() {
        if out.len() >= limit {
            break;
        }
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
                queue.push_back(entry.path());
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            if name.starts_with('.') && name.len() > 1 {
                continue;
            }
            if !glob.matches(&name) {
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

/// Byte offsets of every line start, computed once per searched file.
fn line_starts(text: &str) -> Vec<usize> {
    let mut starts = Vec::with_capacity(text.bytes().filter(|byte| *byte == b'\n').count() + 1);
    starts.push(0);
    for (index, byte) in text.bytes().enumerate() {
        if byte == b'\n' {
            starts.push(index + 1);
        }
    }
    starts
}

fn line_index(starts: &[usize], offset: usize) -> usize {
    starts
        .partition_point(|&start| start <= offset)
        .saturating_sub(1)
}

fn position_of(text: &str, starts: &[usize], offset: usize) -> (usize, usize) {
    let at = offset.min(text.len());
    let index = line_index(starts, at);
    let column = text[starts[index]..at].chars().count() + 1;
    (index + 1, column)
}

fn line_at(text: &str, starts: &[usize], offset: usize) -> String {
    let at = offset.min(text.len());
    let index = line_index(starts, at);
    let start = starts[index];
    let end = starts.get(index + 1).copied().unwrap_or(text.len());
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
    let glob = Glob::from_pattern(request.include.as_deref().unwrap_or(""));
    let files = collect_files(&request.folder, &glob, MAX_FILES);
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
            let starts = line_starts(&text);
            let mut found = Vec::new();
            for hit in matcher.find_iter(&text) {
                let (line, column) = position_of(&text, &starts, hit.start());
                found.push(SearchMatch {
                    path: path.to_string_lossy().to_string(),
                    line,
                    column,
                    text: line_at(&text, &starts, hit.start()),
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

    let glob = Glob::from_pattern(request.include.as_deref().unwrap_or(""));
    let files = collect_files(&request.folder, &glob, MAX_FILES);
    let replacement = request.replacement.as_deref().unwrap_or("");
    // Decode and replace in parallel, then write sequentially. Two threads can
    // never race to write the same file, and a failed write cannot leave a
    // half-written file behind.
    let prepared: Vec<(PathBuf, Vec<u8>, usize)> = files
        .par_iter()
        .filter_map(|path| {
            let Ok(metadata) = fs::metadata(path) else {
                return None;
            };
            // Only rewrite a file that the scan actually read in full. A file
            // that grew past the read limit, or is being written while we read
            // it, is skipped instead of being replaced with a partial copy.
            if metadata.len() > MAX_FILE_BYTES {
                return None;
            }
            let Ok(bytes) = fs::read(path) else {
                return None;
            };
            if bytes.len() as u64 != metadata.len() {
                return None;
            }
            let (text, encoding, binary) = decode_text(&bytes);
            if binary || !matcher.is_match(&text) {
                return None;
            }
            // The decoded text must round-trip to exactly the bytes on disk.
            // Files with invalid byte sequences or a BOM are skipped rather
            // than saved lossily by the replace command.
            let probe_encoding = if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
                "utf8-bom"
            } else {
                encoding.as_str()
            };
            if encode_text(&text, probe_encoding) != bytes {
                return None;
            }
            let count = matcher.find_iter(&text).count();
            let next = matcher.replace_all(&text, replacement).into_owned();
            Some((path.clone(), encode_text(&next, probe_encoding), count))
        })
        .collect();

    let mut changed = 0usize;
    let mut replaced = 0usize;
    for (path, bytes, count) in prepared {
        if write_atomic(&path.to_string_lossy(), &bytes).is_ok() {
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

#[cfg(test)]
mod tests {
    use super::{line_at, line_starts, position_of, Glob};

    #[test]
    fn glob_rules_are_case_insensitive() {
        assert!(Glob::from_pattern("").matches("README.md"));
        assert!(Glob::from_pattern(".TS").matches("notes.ts"));
        assert!(!Glob::from_pattern(".ts").matches("notes.js"));
        assert!(Glob::from_pattern("*.tsx").matches("App.tsx"));
        assert!(!Glob::from_pattern("*.tsx").matches("App.ts"));
    }

    #[test]
    fn line_offsets_are_binary_searched() {
        let text = "one\ntwo\nthree";
        let starts = line_starts(text);
        assert_eq!(starts, vec![0, 4, 8]);
        assert_eq!(position_of(text, &starts, 0), (1, 1));
        assert_eq!(position_of(text, &starts, 5), (2, 2));
        assert_eq!(position_of(text, &starts, 12), (3, 5));
        assert_eq!(line_at(text, &starts, 5), "two");
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
