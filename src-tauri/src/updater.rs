//! In-app update helpers (Linux .deb today).
//!
//! The renderer asks for the latest release, downloads the matching asset and
//! installs it through the system package manager. Privilege escalation goes
//! through `pkexec` so the user gets a normal polkit prompt instead of a
//! broken `sudo` in a GUI.
//!
//! Every command is async: the actual work runs in `spawn_blocking` so a slow
//! network or a polkit prompt can never block the webview's event loop.

use serde::Serialize;
use std::path::Path;
use std::process::Command;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub url: String,
    pub asset_name: String,
}

/// Run a command and return its stdout, or an error string.
fn run(program: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new(program)
        .args(args)
        .output()
        .map_err(|error| format!("could not start {program}: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(if stderr.trim().is_empty() {
            format!("{program} exited with {}", output.status)
        } else {
            stderr.trim().to_string()
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Compare two dotted versions without pulling in a semver dependency.
/// Missing components count as zero; a prefix like `v` is ignored.
fn is_newer(latest: &str, current: &str) -> bool {
    let numbers = |version: &str| -> Vec<u64> {
        version
            .trim_start_matches('v')
            .split('.')
            .map(|part| part.parse().unwrap_or(0))
            .collect()
    };
    let latest = numbers(latest);
    let current = numbers(current);
    for index in 0..latest.len().max(current.len()) {
        let left = *latest.get(index).unwrap_or(&0);
        let right = *current.get(index).unwrap_or(&0);
        if left != right {
            return left > right;
        }
    }
    false
}

fn check_update_blocking(current_version: &str) -> Result<Option<UpdateInfo>, String> {
    // GitHub redirects /latest to the newest non-prerelease; the API is simpler.
    // The timeouts keep a stalled connection from holding a blocking thread.
    let body = run(
        "curl",
        &[
            "-fsSL",
            "--connect-timeout",
            "10",
            "--max-time",
            "60",
            "https://api.github.com/repos/hasaanamerravid-source/FlintQode/releases/latest",
        ],
    )?;
    let json: serde_json::Value =
        serde_json::from_str(&body).map_err(|error| format!("bad release JSON: {error}"))?;
    let tag = json
        .get("tag_name")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .trim_start_matches('v')
        .to_string();
    if tag.is_empty() || !is_newer(&tag, current_version) {
        return Ok(None);
    }
    // Prefer a .deb asset for the current platform.
    let assets = json
        .get("assets")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    let asset = assets
        .iter()
        .find(|entry| {
            entry
                .get("name")
                .and_then(|value| value.as_str())
                .map(|name| name.ends_with(".deb"))
                .unwrap_or(false)
        })
        .or_else(|| assets.first());
    let Some(asset) = asset else {
        return Ok(None);
    };
    let name = asset
        .get("name")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string();
    let url = asset
        .get("browser_download_url")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string();
    if url.is_empty() {
        return Ok(None);
    }
    Ok(Some(UpdateInfo {
        version: tag,
        url,
        asset_name: name,
    }))
}

fn download_update_blocking(url: &str, dest: &str) -> Result<String, String> {
    if let Some(parent) = Path::new(dest).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("could not create {}: {error}", parent.display()))?;
    }
    // Bound both the connection and the whole transfer; a hung download must
    // not leave the app waiting forever.
    run(
        "curl",
        &[
            "-fL",
            "--connect-timeout",
            "10",
            "--max-time",
            "600",
            "-o",
            dest,
            url,
        ],
    )?;
    Ok(dest.to_string())
}

fn install_update_blocking(path: &str) -> Result<String, String> {
    // Try pkexec first (polkit prompt), fall back to a direct dpkg call.
    let pkexec = run("pkexec", &["dpkg", "-i", path]);
    if pkexec.is_ok() {
        return pkexec;
    }
    match run("dpkg", &["-i", path]) {
        Ok(output) => Ok(output),
        Err(dpkg) => Err(format!("{pkexec:?}\n{dpkg}")),
    }
}

#[tauri::command]
pub async fn app_check_update(current_version: String) -> Result<Option<UpdateInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || check_update_blocking(&current_version))
        .await
        .map_err(|error| format!("update check failed: {error}"))?
}

#[tauri::command]
pub async fn app_download_update(url: String, dest: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || download_update_blocking(&url, &dest))
        .await
        .map_err(|error| format!("update download failed: {error}"))?
}

#[tauri::command]
pub async fn app_install_update(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || install_update_blocking(&path))
        .await
        .map_err(|error| format!("update install failed: {error}"))?
}
