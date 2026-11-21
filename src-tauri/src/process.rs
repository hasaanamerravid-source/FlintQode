//! Small helpers for finding programs on the PATH and for stopping child processes safely.

use std::path::{Path, PathBuf};
#[cfg(unix)]
use std::time::Duration;

use std::process::Command;
use tokio::process::Child;

/// The extensions Windows appends to a program name.
#[cfg(windows)]
const WINDOWS_EXTENSIONS: [&str; 4] = [".exe", ".cmd", ".bat", ".com"];

/// Find a program on the PATH (or return an absolute path that exists).
pub fn find_executable(name: &str) -> Option<PathBuf> {
    if name.trim().is_empty() {
        return None;
    }
    let candidate = Path::new(name);
    if candidate.is_absolute() || name.contains('/') || name.contains('\\') {
        return candidate.is_file().then(|| candidate.to_path_buf());
    }

    let path = std::env::var_os("PATH")?;
    let dirs = std::env::split_paths(&path);

    #[cfg(windows)]
    {
        let has_extension = WINDOWS_EXTENSIONS
            .iter()
            .any(|extension| name.to_lowercase().ends_with(extension));
        let extensions: Vec<&str> = if has_extension {
            vec![""]
        } else {
            WINDOWS_EXTENSIONS.to_vec()
        };
        for dir in dirs {
            for extension in &extensions {
                let full = dir.join(format!("{name}{extension}"));
                if full.is_file() {
                    // The Microsoft Store installs empty alias files that open
                    // the store instead of the program.
                    if let Ok(metadata) = full.metadata() {
                        if metadata.len() == 0
                            && full
                                .to_string_lossy()
                                .to_lowercase()
                                .contains("windowsapps")
                        {
                            continue;
                        }
                    }
                    return Some(full);
                }
            }
        }
        None
    }

    #[cfg(not(windows))]
    {
        for dir in dirs {
            let full = dir.join(name);
            if full.is_file() {
                return Some(full);
            }
        }
        None
    }
}

/// Is the program available?
pub fn has_executable(name: &str) -> bool {
    find_executable(name).is_some()
}

/// The user home directory without an extra crate.
pub fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
}

/// Run a detached command and forget about it.
pub fn spawn_detached(command: &str, args: &[String], cwd: Option<&Path>) -> std::io::Result<()> {
    let mut cmd = Command::new(command);
    cmd.args(args);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd.spawn().map(|_| ())
}

/* ------------------------------------------------------------------ *
 * Child process termination
 * ------------------------------------------------------------------ */

/// Send a signal to a running child process group (POSIX only).
///
/// The signal is only delivered after the child has been confirmed to still be
/// running via `try_wait`, which avoids signalling a recycled PID. Returns
/// `true` when the child was alive and the signal was dispatched.
#[cfg(unix)]
async fn send_group_signal(child: &mut Child, signal: i32) -> bool {
    let alive = child.try_wait().ok().flatten().is_none();
    if alive {
        if let Some(pid) = child.id() {
            // SAFETY: `pid` belongs to a child process we spawned ourselves with
            // its own process group, and we only signal it after confirming via
            // `try_wait` that it is still running (which avoids PID reuse).
            let _ = unsafe { libc::kill(-(pid as i32), signal) };
        }
    }
    alive
}

/// Stop a child process and its process group (POSIX process-group aware).
///
/// Sends `terminate_signal` to the child's process group and escalates to
/// SIGKILL when the child is still alive after a short grace period. The final
/// fallback is tokio's own kill machinery, so a child we spawned is never
/// signalled through a PID we did not confirm to belong to it.
#[cfg(unix)]
pub async fn stop_process_tree(child: &mut Child, terminate_signal: i32) {
    if send_group_signal(child, terminate_signal).await {
        tokio::time::sleep(Duration::from_millis(150)).await;
        if child.try_wait().ok().flatten().is_none() {
            if let Some(pid) = child.id() {
                let _ = unsafe { libc::kill(-(pid as i32), libc::SIGKILL) };
            }
        }
    }
    let _ = child.kill().await;
}

/// Interrupt a running child process group (POSIX only).
#[cfg(unix)]
pub async fn interrupt_process_tree(child: &mut Child, signal: i32) -> bool {
    send_group_signal(child, signal).await
}

/// Stop a child process without a graceful phase (portable fallback).
#[cfg(not(unix))]
pub async fn stop_process_tree(child: &mut Child, _terminate_signal: i32) {
    let _ = child.kill().await;
}
