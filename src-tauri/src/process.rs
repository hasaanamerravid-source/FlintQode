//! Small helpers for finding programs on the PATH.

use std::path::{Path, PathBuf};

use std::process::Command;

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
