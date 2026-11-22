//! Minimal Git integration: branch display and diff gutter markers.
//!
//! Everything shells out to `git`; there is no third-party Rust crate to add.

use std::path::Path;
use std::process::Stdio;

use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::process::home_dir;

fn repo_root(path: &str) -> String {
    let dir = if Path::new(path).is_dir() {
        Path::new(path)
    } else {
        Path::new(path).parent().unwrap_or_else(|| Path::new(""))
    };
    dir.to_string_lossy().to_string()
}

fn git_run(cwd: &str, args: &[&str]) -> Option<String> {
    let output = std::process::Command::new("git")
        .args(args)
        .current_dir(cwd)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusFile {
    pub path: String,
    pub status: String,
    pub additions: u32,
    pub deletions: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepoStatus {
    pub branch: String,
    pub dirty: bool,
    pub files: Vec<GitStatusFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub repoRoot: String,
    pub status: Option<GitRepoStatus>,
}

#[tauri::command]
pub fn git_status(window: WebviewWindow, path: String) -> Result<GitStatus, String> {
    let root = repo_root(&path);
    let mut status = GitRepoStatus {
        branch: String::new(),
        dirty: false,
        files: Vec::new(),
    };
    let branch = git_run(&root, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_default();
    status.branch = branch;

    // Show unstaged + staged changes.
    let status_text = git_run(&root, &["status", "--porcelain=v2", "--untracked-files=all"]).unwrap_or_default();
    for line in status_text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.len() < 2 {
            continue;
        }
        let header = parts[0].to_string();
        let status_char = if header.len() >= 2 {
            let mut chars = header.chars();
            let _ = chars.next();
            chars.next().unwrap_or('?').to_string()
        } else {
            header[0..1].to_string()
        };
        let rest = trimmed.split_once("\\t").map(|(_, rest)| rest).unwrap_or("");
        let rel_path = rest
            .split_once(" ")
            .map(|(_, path)| path.trim())
            .or_else(|| parts.last().map(|s| *s))
            .unwrap_or("")
            .trim_matches('"')
            .trim_matches('\'')
            .to_string();
        if rel_path.is_empty() {
            continue;
        }
        status.dirty = true;
        status.files.push(GitStatusFile {
            path: rel_path,
            status: status_char.trim().to_uppercase(),
            additions: 0,
            deletions: 0,
        });
    }

    // Get line-level additions/deletions for the diff of the whole repo
    // (cheap enough on small projects; surfaces in the editor as gutter marks).
    if let Some(diff) = git_run(&root, &["diff", "--numstat", "--unified=0"]) {
        for line in diff.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let mut iter = trimmed.split_whitespace();
            let (add, del, path) = match (iter.next(), iter.next(), iter.next()) {
                (Some(a), Some(d), Some(path)) => (a, d, path),
                _ => continue,
            };
            if let Some(entry) = status.files.iter_mut().find(|f| f.path.contains(path)) {
                entry.additions = add.parse().unwrap_or(0);
                entry.deletions = del.parse().unwrap_or(0);
            }
        }
    }

    let repo_root = root;
    let _ = window;
    Ok(GitStatus {
        repoRoot: repo_root,
        status: if status.branch.is_empty() {
            None
        } else {
            Some(status)
        },
    })
}

#[tauri::command]
pub fn git_diff(app: AppHandle, path: String) -> Result<String, String> {
    let root = repo_root(&path);
    let _ = home_dir;
    let _ = app.clone();
    git_run(&root, &["diff", "HEAD", "--", &path])
        .or_else(|| git_run(&root, &["diff", "--", &path]))
        .ok_or_else(|| "No diff available".to_string())
}

#[tauri::command]
pub fn git_log(path: String, limit: u32) -> Result<Vec<String>, String> {
    let root = repo_root(&path);
    let limit = limit.max(1).min(100);
    let log = git_run(
        &root,
        &["log", "--pretty=format:%h %an %s", "-n", &limit.to_string()],
    )
    .ok_or_else(|| "No git history".to_string())?;
    Ok(log.lines().map(|l| l.to_string()).collect())
}

#[tauri::command]
pub fn git_blame(path: String) -> Result<Vec<String>, String> {
    let root = repo_root(&path);
    let blame = git_run(&root, &["blame", "--line-porcelain", &path])
        .or_else(|| git_run(&root, &["blame", "-f", &path]))
        .ok_or_else(|| "Could not blame file".to_string())?;
    // Extract the summary line of each blame chunk for the status bar preview.
    let mut out: Vec<String> = Vec::new();
    for line in blame.lines() {
        if line.starts_with("author ")
            || line.starts_with("author-mail")
            || line.starts_with("author-time")
            || line.starts_with("author-tz")
            || line.starts_with("summary ")
        {
            out.push(line.trim().to_string());
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn git_commit(cwd: String, message: String) -> Result<String, String> {
    let root = repo_root(&cwd);
    let output = std::process::Command::new("git")
        .args(["commit", "-m", &message])
        .current_dir(&root)
        .stdin(Stdio::null())
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
pub fn git_stage(cwd: String) -> Result<String, String> {
    let root = repo_root(&cwd);
    let output = std::process::Command::new("git")
        .args(["add", "."])
        .current_dir(&root)
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
pub fn git_branch_rename(cwd: String, name: String) -> Result<String, String> {
    let root = repo_root(&cwd);
    let output = std::process::Command::new("git")
        .args(["branch", "-m", &name])
        .current_dir(&root)
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Manager so the store can invalidate diff caches when the tab changes.
pub struct GitStore;
