//! In-app update helpers (Linux .deb today).
//!
//! The renderer asks for the latest release, downloads the matching asset and
//! installs it through the system package manager. Privilege escalation goes
//! through `pkexec` so the user gets a normal polkit prompt instead of a
//! broken `sudo` in a GUI.
//!
//! Every command is async: the actual work runs in `spawn_blocking` so a slow
//! network or a polkit prompt can never block the webview's event loop. GitHub
//! publishes a SHA-256 digest for every release asset; the updater uses it to
//! reject corrupt or substituted downloads before install.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::process::Command;
use std::thread::sleep;
use std::time::Duration;

const NETWORK_ATTEMPTS: u32 = 3;
const RETRY_BASE_MS: u64 = 250;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub url: String,
    pub asset_name: String,
    pub sha256: String,
}

#[derive(Debug)]
struct CommandFailure {
    code: Option<i32>,
    message: String,
}

/// A curl exit code that usually means a temporary network problem.
fn is_transient(failure: &CommandFailure) -> bool {
    matches!(failure.code, Some(6 | 7 | 28 | 35 | 52 | 56))
        || failure.message.contains("timed out")
        || failure.message.contains("Could not resolve host")
        || failure.message.contains("Connection timed out")
}

/// Retry only transient network failures, with bounded exponential backoff.
fn retry_transient<T>(
    label: &str,
    attempts: u32,
    mut operation: impl FnMut() -> Result<T, CommandFailure>,
    pause: impl Fn(Duration),
) -> Result<T, String> {
    let mut last = String::new();
    for attempt in 1..=attempts {
        match operation() {
            Ok(value) => return Ok(value),
            Err(failure) => {
                last = failure.message;
                if !is_transient(&CommandFailure {
                    code: failure.code,
                    message: last.clone(),
                }) || attempt == attempts
                {
                    break;
                }
                pause(Duration::from_millis(
                    RETRY_BASE_MS * (1u64 << (attempt - 1)),
                ));
            }
        }
    }
    Err(format!("{label} failed after {attempts} attempts: {last}"))
}

/// Run a command and return its stdout, or a structured failure.
fn run(program: &str, args: &[&str]) -> Result<String, CommandFailure> {
    let output = Command::new(program)
        .args(args)
        .output()
        .map_err(|error| CommandFailure {
            code: None,
            message: format!("could not start {program}: {error}"),
        })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(CommandFailure {
            code: output.status.code(),
            message: if stderr.trim().is_empty() {
                format!("{program} exited with {}", output.status)
            } else {
                stderr.trim().to_string()
            },
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

fn sha256_from_digest(value: &str) -> String {
    value
        .strip_prefix("sha256:")
        .unwrap_or(value)
        .trim()
        .to_ascii_lowercase()
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn sha256_file(path: &str) -> Result<String, String> {
    let mut file = File::open(path).map_err(|error| format!("could not read {path}: {error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("could not read {path}: {error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

/// Refuse to install anything whose bytes do not match the release manifest.
fn verify_checksum(path: &str, expected: &str) -> Result<(), String> {
    if !is_sha256(expected) {
        return Err(format!(
            "the release has no valid SHA-256 checksum for {path}"
        ));
    }
    let actual = sha256_file(path)?;
    if actual == expected {
        Ok(())
    } else {
        Err(format!(
            "checksum mismatch: expected {expected}, got {actual}"
        ))
    }
}

fn check_update_blocking(current_version: &str) -> Result<Option<UpdateInfo>, String> {
    // GitHub redirects /latest to the newest non-prerelease; the API is simpler.
    // The timeouts keep a stalled connection from holding a blocking thread.
    let body = retry_transient(
        "update check",
        NETWORK_ATTEMPTS,
        || {
            run(
                "curl",
                &[
                    "-fsSL",
                    "--connect-timeout",
                    "10",
                    "--max-time",
                    "60",
                    "https://api.github.com/repos/hasaanamerravid-source/FlintQode/releases/latest",
                ],
            )
        },
        sleep,
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
    let sha256 = asset
        .get("digest")
        .and_then(|value| value.as_str())
        .map(sha256_from_digest)
        .unwrap_or_default();
    if url.is_empty() {
        return Ok(None);
    }
    if !is_sha256(&sha256) {
        return Err(format!("the release asset {name} has no usable checksum"));
    }
    Ok(Some(UpdateInfo {
        version: tag,
        url,
        asset_name: name,
        sha256,
    }))
}

fn download_update_blocking(url: &str, dest: &str, expected: &str) -> Result<String, String> {
    if !is_sha256(expected) {
        return Err("the release has no usable checksum; the download was cancelled".to_string());
    }
    let partial = format!("{dest}.part");
    if let Some(parent) = Path::new(&partial).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("could not create {}: {error}", parent.display()))?;
    }

    let result = (|| -> Result<String, String> {
        let _ = std::fs::remove_file(&partial);
        // Bound both the connection and the whole transfer; a hung download must
        // not leave the app waiting forever.
        retry_transient(
            "update download",
            NETWORK_ATTEMPTS,
            || {
                run(
                    "curl",
                    &[
                        "-fL",
                        "--connect-timeout",
                        "10",
                        "--max-time",
                        "600",
                        "-o",
                        partial.as_str(),
                        url,
                    ],
                )
            },
            sleep,
        )?;
        verify_checksum(&partial, expected)?;
        let _ = std::fs::remove_file(dest);
        std::fs::rename(&partial, dest)
            .map_err(|error| format!("could not save the update to {dest}: {error}"))?;
        Ok(dest.to_string())
    })();

    // A failed or interrupted transfer must not be offered to the installer.
    if result.is_err() {
        let _ = std::fs::remove_file(&partial);
    }
    result
}

fn install_update_blocking(path: &str, expected: &str) -> Result<String, String> {
    let result = (|| -> Result<String, String> {
        verify_checksum(path, expected)?;
        // Try pkexec first (polkit prompt), fall back to a direct dpkg call.
        let pkexec = run("pkexec", &["dpkg", "-i", path]);
        if pkexec.is_ok() {
            return pkexec.map_err(|error| error.message);
        }
        match run("dpkg", &["-i", path]) {
            Ok(output) => Ok(output),
            Err(dpkg) => Err(format!(
                "pkexec: {}; dpkg: {}",
                pkexec.unwrap_err().message,
                dpkg.message
            )),
        }
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(path);
    }
    result
}

#[tauri::command]
pub async fn app_check_update(current_version: String) -> Result<Option<UpdateInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || check_update_blocking(&current_version))
        .await
        .map_err(|error| format!("update check failed: {error}"))?
}

#[tauri::command]
pub async fn app_download_update(
    url: String,
    dest: String,
    sha256: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || download_update_blocking(&url, &dest, &sha256))
        .await
        .map_err(|error| format!("update download failed: {error}"))?
}

#[tauri::command]
pub async fn app_install_update(path: String, sha256: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || install_update_blocking(&path, &sha256))
        .await
        .map_err(|error| format!("update install failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::{
        download_update_blocking, install_update_blocking, is_newer, is_sha256, is_transient,
        retry_transient, sha256_file, verify_checksum, CommandFailure,
    };
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::Duration;
    use url::Url;

    static NEXT_FILE: AtomicU64 = AtomicU64::new(0);

    fn temp_file() -> PathBuf {
        let id = NEXT_FILE.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "flintqode-updater-test-{}-{id}.bin",
            std::process::id()
        ))
    }

    #[test]
    fn a_higher_patch_is_newer() {
        assert!(is_newer("1.4.8", "1.4.7"));
        assert!(!is_newer("1.4.7", "1.4.7"));
    }

    #[test]
    fn a_higher_minor_or_major_is_newer() {
        assert!(is_newer("1.5.0", "1.4.9"));
        assert!(is_newer("2.0.0", "1.9.9"));
    }

    #[test]
    fn a_prefix_and_missing_components_are_handled() {
        assert!(is_newer("v1.5", "1.4.7"));
        assert!(!is_newer("1.4.7.0", "1.4.7"));
        assert!(is_newer("1.4.8", ""));
    }

    #[test]
    fn a_bad_tag_is_not_newer() {
        assert!(!is_newer("nightly", "1.4.7"));
        assert!(!is_newer("", "1.4.7"));
    }

    #[test]
    fn only_bounded_network_failures_are_retried() {
        assert!(is_transient(&CommandFailure {
            code: Some(28),
            message: String::new()
        }));
        assert!(is_transient(&CommandFailure {
            code: None,
            message: "curl: (6) Could not resolve host".to_string(),
        }));
        assert!(!is_transient(&CommandFailure {
            code: Some(22),
            message: "404".to_string()
        }));
    }

    #[test]
    fn retry_exhaustion_reports_the_attempt_count() {
        let mut attempts = 0;
        let result: Result<(), String> = retry_transient(
            "download",
            3,
            || {
                attempts += 1;
                Err(CommandFailure {
                    code: Some(7),
                    message: "connection refused".to_string(),
                })
            },
            |_| (),
        );
        assert_eq!(attempts, 3);
        assert_eq!(
            result.unwrap_err(),
            "download failed after 3 attempts: connection refused"
        );
    }

    #[test]
    fn a_transient_failure_stops_after_it_succeeds() {
        let mut attempts = 0;
        let result: Result<(), String> = retry_transient(
            "check",
            3,
            || {
                attempts += 1;
                if attempts == 1 {
                    Err(CommandFailure {
                        code: Some(28),
                        message: "timed out".to_string(),
                    })
                } else {
                    Ok(())
                }
            },
            |duration| assert_eq!(duration, Duration::from_millis(250)),
        );
        assert_eq!(attempts, 2);
        assert!(result.is_ok());
    }

    #[test]
    fn a_corrupt_download_is_rejected_and_removed() {
        let path = temp_file();
        let destination = path.with_extension("deb");
        let url = Url::from_file_path(&path).unwrap().to_string();
        std::fs::write(&path, b"valid update bytes").unwrap();
        let expected = sha256_file(path.to_str().unwrap()).unwrap();
        assert!(is_sha256(&expected));

        assert_eq!(
            download_update_blocking(&url, destination.to_str().unwrap(), &expected).unwrap(),
            destination.to_str().unwrap()
        );
        assert!(verify_checksum(destination.to_str().unwrap(), &expected).is_ok());
        assert!(install_update_blocking(destination.to_str().unwrap(), &"0".repeat(64)).is_err());
        assert!(!destination.exists());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_checksum_mismatch_never_renames_the_partial_file() {
        let path = temp_file();
        let destination = path.with_extension("deb");
        let url = Url::from_file_path(&path).unwrap().to_string();
        std::fs::write(&path, b"downloaded bytes").unwrap();

        let result = download_update_blocking(&url, destination.to_str().unwrap(), &"1".repeat(64));
        assert!(result.unwrap_err().contains("checksum mismatch"));
        assert!(!destination.exists());
        assert!(!destination.with_extension("part").exists());
        let _ = std::fs::remove_file(&path);
    }
}
