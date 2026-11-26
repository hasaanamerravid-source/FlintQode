//! Opening a system terminal and running a file with its interpreter.

use std::path::{Path, PathBuf};

use crate::process::{find_executable, home_dir, spawn_detached};

fn open_terminal_at(directory: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // cmd.exe splits the command at unquoted whitespace, so a path such as
        // "C:\My Documents" must be quoted. Keep a drive root intact and drop
        // other trailing separators so the closing quote is never ambiguous.
        let mut directory_text = directory.display().to_string();
        if directory_text.ends_with('\\') && !directory_text.ends_with(":\\") {
            directory_text.pop();
        }
        let line = format!("cd /d \"{directory_text}\"");

        // Windows Terminal is the nicer fallback when it is installed, but a
        // missing or failing `wt` must still leave us with a working cmd shell.
        let mut first_error = None;
        if let Some(program) = find_executable("wt") {
            let args = [
                "-d".to_string(),
                directory_text.clone(),
                "cmd".to_string(),
                "/K".to_string(),
            ];
            match spawn_detached(&program.to_string_lossy(), &args, None) {
                Ok(()) => return Ok(()),
                Err(error) => first_error = Some(error.to_string()),
            }
        }
        std::process::Command::new("cmd")
            .args(["/C", "start", "", "cmd", "/K", &line])
            .spawn()
            .map(|_| ())
            .map_err(|error| match first_error {
                Some(wt_error) => format!("Windows Terminal: {wt_error}; cmd: {error}"),
                None => error.to_string(),
            })
    }
    #[cfg(target_os = "macos")]
    {
        spawn_detached(
            "open",
            &[
                "-a".to_string(),
                "Terminal".to_string(),
                directory.display().to_string(),
            ],
            None,
        )
        .map_err(|error| error.to_string())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let candidates = [
            "x-terminal-emulator",
            "gnome-terminal",
            "konsole",
            "xfce4-terminal",
            "kitty",
            "alacritty",
            "xterm",
        ];
        for name in candidates {
            if let Some(program) = find_executable(name) {
                return spawn_detached(&program.to_string_lossy(), &[], Some(directory))
                    .map_err(|error| error.to_string());
            }
        }
        Err("No terminal emulator was found on this system.".to_string())
    }
}

#[tauri::command]
pub async fn shell_open_terminal(cwd: Option<String>) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let directory = cwd
            .map(|value| PathBuf::from(value.trim().trim_matches('"')))
            .filter(|path| path.is_dir())
            .or_else(|| std::env::current_dir().ok().filter(|path| path.is_dir()))
            .unwrap_or_else(home_dir);
        open_terminal_at(&directory)?;
        Ok(true)
    })
    .await
    .map_err(|error| error.to_string())?
}

/** The program that runs a file, picked by the extension. */
fn command_for(file_path: &str) -> Option<(String, Vec<String>)> {
    let extension = Path::new(file_path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase();
    let (name, args) = match extension.as_str() {
        "py" => ("python", vec![file_path.to_string()]),
        "js" | "mjs" | "cjs" => ("node", vec![file_path.to_string()]),
        "ts" => ("npx", vec!["tsx".to_string(), file_path.to_string()]),
        "rb" => ("ruby", vec![file_path.to_string()]),
        "pl" => ("perl", vec![file_path.to_string()]),
        "lua" => ("lua", vec![file_path.to_string()]),
        "ps1" => (
            "powershell",
            vec![
                "-ExecutionPolicy".to_string(),
                "Bypass".to_string(),
                "-File".to_string(),
                file_path.to_string(),
            ],
        ),
        "bat" | "cmd" => ("cmd", vec!["/c".to_string(), file_path.to_string()]),
        "sh" | "bash" => ("bash", vec![file_path.to_string()]),
        _ => return None,
    };
    Some((name.to_string(), args))
}

#[tauri::command]
pub async fn shell_run(file_path: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some((command, args)) = command_for(&file_path) else {
            return Ok(None);
        };
        let folder = Path::new(&file_path).parent().map(Path::to_path_buf);
        // A failed spawn must be reported: the caller used to show the command
        // string as if the program had started, which hid a missing interpreter.
        spawn_detached(&command, &args, folder.as_deref())
            .map_err(|error| format!("Could not start {command}: {error}"))?;
        Ok(Some(format!("{command} {}", args.join(" "))))
    })
    .await
    .map_err(|error| error.to_string())?
}
