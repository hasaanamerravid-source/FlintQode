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
    let directory = app.path().app_data_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory)
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
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, text).map_err(|error| error.to_string())?;
    fs::rename(&temporary, path).map_err(|error| error.to_string())
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
    let value = Value::Array(list.iter().map(|entry| Value::String(entry.clone())).collect());
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
        let text = |key: &str| manifest.get(key).and_then(Value::as_str).map(str::to_string);
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
        .open(log_directory.join("opennotes.log"))
        .and_then(|mut file| {
            use std::io::Write;
            writeln!(file, "[{stamp}] {message}")
        });
}
