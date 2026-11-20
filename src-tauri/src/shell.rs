//! Opening a system terminal and running a file with its interpreter.

use std::path::{Path, PathBuf};

use crate::process::{find_executable, home_dir, spawn_detached};

fn open_terminal_at(directory: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let line = format!("cd /d {}", directory.display());
        std::process::Command::new("cmd")
            .args(["/C", "start", "", "cmd", "/K", &line])
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string())
    }
    #[cfg(target_os = "macos")]
    {
        spawn_detached("open", &["-a".to_string(), "Terminal".to_string(), directory.display().to_string()], None)
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
pub fn shell_open_terminal(cwd: Option<String>) -> Result<bool, String> {
    let directory = cwd
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
        .unwrap_or_else(home_dir);
    open_terminal_at(&directory)?;
    Ok(true)
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
pub fn shell_run(file_path: String) -> Option<String> {
    let (command, args) = command_for(&file_path)?;
    let folder = Path::new(&file_path).parent().map(Path::to_path_buf);
    let _ = spawn_detached(&command, &args, folder.as_deref());
    Some(format!("{command} {}", args.join(" ")))
}
