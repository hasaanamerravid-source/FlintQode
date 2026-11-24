# FlintQode

A fast, native desktop editor for code, Markdown and plain text. FlintQode is built
with **Tauri 2**, a small **Rust** backend and a **SolidJS 2 + CodeMirror 6** interface.

| Inspiration | What FlintQode brings |
| --- | --- |
| **Windows Notepad** | Instant start, no clutter, word wrap, zoom, status bar, go-to-line, encodings, session restore |
| **Notepad++** | Tabs, syntax highlighting for 100+ languages, code folding, minimap, Markdown preview, find & replace with regex, bookmarks, line tools, sort/trim/join transforms, character map, compare documents |
| **Modern editors** | Project search, language servers (LSP), an integrated shell, run-file support, a command palette and a quiet, native-looking shell |

The interface speaks **five languages** — English, German, Spanish, Russian and
Simplified Chinese. See [docs/i18n.md](docs/i18n.md).

## Requirements

| Platform | What is needed |
| --- | --- |
| **All** | Node.js 22.12 or newer, Rust stable (`rustup`) |
| **Linux** | WebKitGTK 4.1 and GTK 3 development packages |
| **Windows** | WebView2 (installed by Windows 10/11) and the MSVC build tools |
| **macOS** | Xcode command line tools |

Linux packages (Debian/Ubuntu):

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
  librsvg2-dev patchelf build-essential curl wget file
```

Fedora:

```bash
sudo dnf install webkit2gtk4.1-devel gtk3-devel librsvg2-devel patchelf
```

Arch:

```bash
sudo pacman -S webkit2gtk-4.1 gtk3 librsvg patchelf
```

## Running it

```bash
npm install
npm run dev:app     # native window with hot reload
npm run build:app   # release build + bundled installers
```

While working only on the interface, the renderer can run in a plain browser:

```bash
npm run dev         # http://127.0.0.1:1420
```

The browser preview keeps the settings in `localStorage`; file system, language
server, terminal and run commands need the native shell.

### Scripts

```bash
npm run dev:app        # tauri dev
npm run build:app      # tauri build
npm run dev            # vite (renderer only)
npm run build          # vite build (renderer bundle in dist/)
npm run typecheck      # TypeScript, renderer and build config
npm run test:unit      # pure logic: translations, transforms, shortcuts, messages
npm run i18n:check     # every language file matches the catalogue
npm run i18n:coverage  # how much of every language is translated
npm run format         # prettier
npm run check          # format check + typecheck + i18n + unit tests + build
npm run icons          # regenerate the application icons
```

## Layout

```
src-tauri         Native shell (Rust)
  src/lib.rs      Window creation, command registration, application setup
  src/fs.rs       Files, encodings, directory listings, file watchers
  src/search.rs   Project-wide search and replace (Rayon)
  src/lsp.rs      Language server host (JSON-RPC, diagnostics, status)
  src/terminal.rs Piped shell with command markers
  src/run.rs      Language runners with streamed output
  src/store.rs    Settings, session, recent files, plugins
src/renderer      SolidJS 2 application
  src/bridge.ts   The window.api bridge on top of Tauri invoke/events
  core/           Commands, editor registry, languages, plugins, transforms
  components/     Shell, tabs, editors, dialogs and reusable controls
  workbench/      Activity bar, sidebar views, panels and split editor host
  state/          Solid signal-backed stores with the command-layer shim
  styles/         Design system and component styling
src/shared        Types shared by the webview and the native side, translations
tests/            Unit tests of the pure logic
docs/             Architecture, decisions, i18n and testing guides
```

## How the pieces fit together

The renderer was originally written against an Electron preload that exposed
`window.api`. The Tauri build keeps that contract: `src/renderer/src/bridge.ts`
implements the same promise-based surface with `invoke()` and `listen()` and
installs it as `window.api` before the first component renders. The SolidJS 2 UI
therefore does not need to know which shell it runs in.

The renderer uses Solid signals for reactivity and `src/renderer/src/styles/design-system.css`
as the single visual layer. Its Aurora Slate palette, spacing and elevation are shared by every
screen; user appearance settings are applied as inline custom properties and take precedence.
See [docs/solid-port-guide.md](docs/solid-port-guide.md) and
[docs/adr/0005-solidjs-2-renderer.md](docs/adr/0005-solidjs-2-renderer.md).

Every user-visible action is a **command** with a stable id (`file.save`,
`format.sortAsc`, `view.toggleTerminal`, …). Commands are registered once in
`src/renderer/src/core/builtinCommands.ts` and are reachable from:

* the in-app main menu,
* the command palette (`Ctrl+Shift+P`),
* keyboard shortcuts.

The native menu bar is gone by design: the window is undecorated, the title bar
is drawn by the app, and the main menu opens from the hamburger button(new). That
keeps the shell identical on Windows, macOS and Linux and removes a whole layer
of platform-specific menu code.

Editors register a live handle (`src/renderer/src/core/editors.ts`) so commands
can act on the focused document without knowing whether it is a CodeMirror text
editor or a Markdown editor.

## The native side

The Fast Rust backend owns everything that touches the operating system:

| Area | Commands |
| --- | --- |
| Files | `fs_read_file`, `fs_write_file`, `fs_read_dir`, `fs_list_recursive`, `fs_stat`, `fs_exists`, `fs_make_dir`, `fs_remove`, `fs_rename`, `fs_copy_file`, `fs_show_in_folder`, `fs_read_text_file`, `fs_write_text_file` |
| Search | `fs_search`, `fs_replace_in_files` |
| Watchers | `fs_watch`, `fs_unwatch` |
| Persistence | `settings_load/save`, `session_load/save`, `recent_list/add/clear`, `plugins_list` |
| Language servers | `lsp_start`, `lsp_did_open/change/close`, `lsp_request`, `lsp_stop`, `lsp_configure` |
| Terminal | `terminal_start/write/interrupt/stop/resize` |
| Run | `run_start`, `run_stop` |
| Window | `win_new_window`, `open_files_pending` |

The webview has no Node.js access: the capability file
(`src-tauri/capabilities/default.json`) grants only the core window commands and
the dialog and clipboard plugins. Everything else goes through the typed bridge.

Files are decoded with byte-order-mark detection, UTF-8/UTF-16 support and the
common legacy encodings, binary files are detected instead of opened, and files
above 24 MB are truncated (read-only) instead of freezing the editor. Project
search skips dependency and build folders and files above 4 MB.

## The languages of the interface

Every string of the interface comes from a catalogue. The English catalogue
(`src/shared/i18n/en.ts`) is the source of truth; the other languages are plain
JSON files in `src/shared/i18n/locales/`.

| | |
| --- | --- |
| **Five languages** | English, German, Spanish, Russian, Simplified Chinese |
| **Never broken** | A key that is not translated yet falls back to English |
| **Checked** | `npm run i18n:check` proves that every language file matches the catalogue, that no value is empty and that no placeholder was lost |

The language is chosen in **Settings → General**, and the settings show how much
of it is translated.

## Accessibility

* every dialog is a real modal dialog: the keyboard focus stays inside it, the escape key
  closes it and the focus goes back to the control that opened it;
* the focus is always visible (`:focus-visible`), and the tool windows, the status bar and the
  command palette are named for the screen reader;
* animations are switched off when the system asks for less movement
  (`prefers-reduced-motion`), or when the setting **Animations** is off.

## Settings and user data

The native app stores its data in the platform application-data folder:

| Platform | Folder |
| --- | --- |
| Windows | `%APPDATA%\dev.flintqode.app` |
| macOS | `~/Library/Application Support/dev.flintqode.app` |
| Linux | `~/.local/share/dev.flintqode.app` |

`settings.json`, `session.json`, `recent.json`, `plugins/` and `logs/flintqode.log`
live there. The formats are the same JSON documents the earlier builds used, so
an existing profile keeps working.

## Known limitations

- The integrated terminal is a PTY with resize support and multiple sessions;
  macOS builds are unsigned and may need the usual Gatekeeper step.
- Opening the same editor in several windows shares a single Rust state
  (terminals, language servers, run state and settings). Treat multi-window
  use as experimental.
- Files larger than 24 MB are truncated on load; saving is disabled for those
  buffers to avoid destroying the rest of the file.

## License

MIT — see [LICENSE](LICENSE).
