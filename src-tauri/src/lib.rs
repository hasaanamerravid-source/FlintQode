//! OpenNotes - the native shell.
//!
//! The React application talks to this process through the commands below.
//! Every command is registered here, the state of the services (watchers,
//! terminal, runner and language servers) lives next to it.

mod fs;
mod lsp;
mod process;
mod run;
mod search;
mod shell;
mod store;
mod terminal;

use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// Files that were passed on the command line before the webview was ready.
/// The renderer picks them up with `open_files_pending` after it mounted.
#[derive(Default)]
pub struct OpenFiles(pub Mutex<Vec<String>>);

static WINDOW_COUNTER: AtomicUsize = AtomicUsize::new(1);

#[tauri::command]
fn open_files_pending(state: tauri::State<'_, OpenFiles>) -> Vec<String> {
    state
        .0
        .lock()
        .map(|mut files| std::mem::take(&mut *files))
        .unwrap_or_default()
}

#[tauri::command]
fn win_new_window(app: tauri::AppHandle) -> Result<bool, String> {
    let index = WINDOW_COUNTER.fetch_add(1, Ordering::SeqCst) + 1;
    let label = format!("main-{index}");
    let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title("OpenNotes")
        .inner_size(1240.0, 820.0)
        .min_inner_size(720.0, 480.0)
        .decorations(false)
        .drag_drop_enabled(true)
        .center()
        .build()
        .map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    Ok(true)
}

fn command_line_files() -> Vec<String> {
    std::env::args()
        .skip(1)
        .filter(|argument| !argument.starts_with('-'))
        .filter(|argument| Path::new(argument).is_file())
        .filter_map(|argument| {
            std::fs::canonicalize(&argument)
                .ok()
                .map(|path| path.to_string_lossy().to_string())
                .or(Some(argument))
        })
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(OpenFiles::default())
        .manage(fs::Watchers::default())
        .manage(terminal::TerminalState::default())
        .manage(run::RunState::default())
        .manage(lsp::LspState::default())
        .invoke_handler(tauri::generate_handler![
            store::app_info,
            store::settings_load,
            store::settings_save,
            store::session_load,
            store::session_save,
            store::recent_list,
            store::recent_add,
            store::recent_clear,
            store::plugins_list,
            store::report_error,
            fs::fs_read_file,
            fs::fs_write_file,
            fs::fs_read_dir,
            fs::fs_list_recursive,
            fs::fs_stat,
            fs::fs_exists,
            fs::fs_make_dir,
            fs::fs_remove,
            fs::fs_rename,
            fs::fs_copy_file,
            fs::fs_show_in_folder,
            fs::fs_read_text_file,
            fs::fs_write_text_file,
            fs::fs_search,
            fs::fs_replace_in_files,
            fs::fs_watch,
            fs::fs_unwatch,
            shell::shell_open_terminal,
            shell::shell_run,
            run::run_start,
            run::run_stop,
            terminal::terminal_start,
            terminal::terminal_write,
            terminal::terminal_interrupt,
            terminal::terminal_stop,
            terminal::terminal_resize,
            lsp::lsp_start,
            lsp::lsp_did_open,
            lsp::lsp_did_change,
            lsp::lsp_did_close,
            lsp::lsp_request,
            lsp::lsp_stop,
            lsp::lsp_configure,
            win_new_window,
            open_files_pending,
        ])
        .setup(|app| {
            let files = command_line_files();
            if !files.is_empty() {
                let state = app.state::<OpenFiles>();
                if let Ok(mut queue) = state.0.lock() {
                    queue.extend(files);
                }
            }
            Ok(())
        });

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building the OpenNotes window");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            let state = app_handle.state::<lsp::LspState>();
            tauri::async_runtime::block_on(lsp::stop_all(&state));
        }
    });
}
