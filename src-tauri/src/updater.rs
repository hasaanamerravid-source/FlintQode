//! In-app update helpers (Linux .deb today).
//!
//! The renderer asks for the latest release, downloads the matching asset and
//! installs it through the system package manager. Privilege escalation goes
//! through `pkexec` so the user gets a normal polkit prompt instead of a
//! broken `sudo` in a GUI.

use serde::Serialize;
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

#[tauri::command]
pub fn app_check_update(current_version: String) -> Result<Option<UpdateInfo>, String> {
    // GitHub redirects /latest to the newest non-prerelease; the API is simpler.
    let body = run(
        "curl",
        &[
            "-fsSL",
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
    if tag.is_empty() || tag == current_version {
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

#[tauri::command]
pub fn app_download_update(url: String, dest: String) -> Result<String, String> {
    // Make sure the parent directory exists.
    if let Some(parent) = std::path::Path::new(&dest).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    run("curl", &["-fL", "-o", &dest, &url])?;
    Ok(dest)
}

#[tauri::command]
pub fn app_install_update(path: String) -> Result<String, String> {
    // Try pkexec first (polkit prompt), fall back to a direct dpkg call.
    let pkexec = run("pkexec", &["dpkg", "-i", &path]);
    if pkexec.is_ok() {
        return pkexec;
    }
    run("dpkg", &["-i", &path])
}