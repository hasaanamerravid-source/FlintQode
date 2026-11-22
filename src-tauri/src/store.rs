//! Settings, session, recent files and plugin discovery.
//!
//! All of it lives below the native app-data folder, next to the user's
//! plugins. The file formats are the same JSON documents the Electron build
//! used, so an existing profile keeps working after the migration.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::process::home_dir;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    /// Monotonic build number (the commit count at build time).
    pub build: String,
    /// Short commit hash the build was made from.
    pub commit: String,
    pub tauri: String,
    pub webview: String,
    pub runtime: String,
    pub platform: String,
    pub home: String,
    pub temp: String,
    pub user_data: String,
}

#[derive(Debug, Serialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub path: String,
    pub source: String,
}

pub fn app_data(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    // The application was renamed. Migrate the settings, session and recent
    // files of the old data folder once, so existing users do not lose their
    // profile on the first start under the new name.
    migrate_legacy_data(&directory);
    Ok(directory)
}

fn migrate_legacy_data(directory: &Path) {
    // Only migrate when the new folder is still empty: a file that already
    // exists must win over the old copy.
    if directory.join("settings.json").exists()
        || directory.join("session.json").exists()
        || directory.join("recent.json").exists()
    {
        return;
    }
    let Some(parent) = directory.parent() else {
        return;
    };
    let legacy = parent.join("dev.opennotes.app");
    if !legacy.is_dir() || legacy == directory {
        return;
    }
    let _ = copy_tree(&legacy, directory);
}

fn copy_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    if !to.exists() {
        fs::create_dir_all(to)?;
    }
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else if !target.exists() {
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

fn store_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    Ok(app_data(app)?.join(name))
}

fn read_value(path: &Path) -> Option<Value> {
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

fn write_value(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let text = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    // Write a sibling file and rename it over the target: a crash can never
    // leave a half-written settings or session file behind.
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "store.json".to_string());
    let temporary = path.with_file_name(format!(".{name}.tmp"));
    {
        use std::io::Write;
        let mut file = fs::File::create(&temporary).map_err(|error| error.to_string())?;
        file.write_all(text.as_bytes())
            .map_err(|error| error.to_string())?;
        // Flush to the disk before the rename, so the rename cannot expose an
        // empty file after a power cut.
        file.sync_all().map_err(|error| error.to_string())?;
    }
    match fs::rename(&temporary, path) {
        Ok(()) => Ok(()),
        Err(first) => {
            // Some Windows and network filesystems refuse to replace an
            // existing file. Removing the old copy and retrying keeps the
            // "save" button working there.
            let _ = fs::remove_file(path);
            fs::rename(&temporary, path).map_err(|second| {
                let _ = fs::remove_file(&temporary);
                format!("{first}; {second}")
            })
        }
    }
}

#[tauri::command]
pub fn app_info(app: AppHandle) -> Result<AppInfo, String> {
    let user_data = app_data(&app)?;
    #[cfg(target_os = "linux")]
    let webview = "WebKitGTK";
    #[cfg(target_os = "windows")]
    let webview = "WebView2";
    #[cfg(target_os = "macos")]
    let webview = "WKWebView";
    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    let webview = "WebView";

    Ok(AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        build: env!("FLINTQODE_BUILD").to_string(),
        commit: env!("FLINTQODE_COMMIT").to_string(),
        tauri: tauri::VERSION.to_string(),
        webview: webview.to_string(),
        runtime: "Rust".to_string(),
        platform: std::env::consts::OS.to_string(),
        home: home_dir().to_string_lossy().to_string(),
        temp: std::env::temp_dir().to_string_lossy().to_string(),
        user_data: user_data.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn settings_load(app: AppHandle) -> Result<Option<Value>, String> {
    Ok(read_value(&store_path(&app, "settings.json")?))
}

#[tauri::command]
pub fn settings_save(app: AppHandle, settings: Value) -> Result<(), String> {
    write_value(&store_path(&app, "settings.json")?, &settings)
}

#[tauri::command]
pub fn session_load(app: AppHandle) -> Result<Option<Value>, String> {
    Ok(read_value(&store_path(&app, "session.json")?))
}

#[tauri::command]
pub fn session_save(app: AppHandle, state: Value) -> Result<(), String> {
    write_value(&store_path(&app, "session.json")?, &state)
}

fn recent_read(app: &AppHandle) -> Vec<String> {
    let Ok(path) = store_path(app, "recent.json") else {
        return Vec::new();
    };
    let Some(value) = read_value(&path) else {
        return Vec::new();
    };
    value
        .as_array()
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| entry.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

fn recent_write(app: &AppHandle, list: &[String]) -> Result<(), String> {
    let value = Value::Array(
        list.iter()
            .map(|entry| Value::String(entry.clone()))
            .collect(),
    );
    write_value(&store_path(app, "recent.json")?, &value)
}

#[tauri::command]
pub fn recent_list(app: AppHandle) -> Vec<String> {
    recent_read(&app)
}

#[tauri::command]
pub fn recent_add(app: AppHandle, path: String) -> Result<Vec<String>, String> {
    let lower = path.to_lowercase();
    let mut list = recent_read(&app);
    list.retain(|entry| entry.to_lowercase() != lower);
    list.insert(0, path);
    list.truncate(30);
    recent_write(&app, &list)?;
    Ok(list)
}

#[tauri::command]
pub fn recent_clear(app: AppHandle) -> Result<(), String> {
    recent_write(&app, &[])
}

#[tauri::command]
pub fn plugins_list(app: AppHandle) -> Result<Vec<PluginManifest>, String> {
    let root = app_data(&app)?.join("plugins");
    let Ok(entries) = fs::read_dir(&root) else {
        return Ok(Vec::new());
    };
    let mut dirs: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect();
    dirs.sort();

    let mut plugins = Vec::new();
    for directory in dirs {
        let entry = directory.join("plugin.js");
        let Ok(source) = fs::read_to_string(&entry) else {
            continue;
        };
        let manifest = read_value(&directory.join("plugin.json")).unwrap_or(Value::Null);
        let text = |key: &str| {
            manifest
                .get(key)
                .and_then(Value::as_str)
                .map(str::to_string)
        };
        let folder_name = directory
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default();
        plugins.push(PluginManifest {
            id: text("id").unwrap_or_else(|| folder_name.clone()),
            name: text("name").unwrap_or_else(|| folder_name.clone()),
            version: text("version").unwrap_or_else(|| "0.0.0".to_string()),
            description: text("description").unwrap_or_default(),
            path: directory.to_string_lossy().to_string(),
            source,
        });
    }
    Ok(plugins)
}

/// Write a renderer failure into the native log.
#[tauri::command]
pub fn report_error(app: AppHandle, message: String) {
    let Ok(directory) = app_data(&app) else {
        return;
    };
    let log_directory = directory.join("logs");
    let _ = fs::create_dir_all(&log_directory);
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0);
    let _ = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_directory.join("flintqode.log"))
        .and_then(|mut file| {
            use std::io::Write;
            writeln!(file, "[{stamp}] {message}")
        });
}
