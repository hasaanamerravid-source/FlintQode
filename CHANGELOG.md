# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2026-11-22

### Added
- Full editor typography and colour customisation: font family, size, weight, style, line height, letter spacing, ligatures and text, background, caret and selection colours. The changes are live and saved automatically.
- A real three-button Save / Discard / Cancel dialog for unsaved tabs.
- Crash-safe atomic writes for every file, including project-wide replace.
- A visible build number (the commit count) and commit hash in the About dialog and website.
- macOS installer in the CI matrix and on the download page.
- MIT licence throughout the project and website.

### Changed
- The project is now FlintQode (previously OpenNotes). Existing settings, sessions, macros and `.opennotes.json` project files are migrated automatically.
- Running a file now saves the buffer first, adopts the language of the saved name and reports backend errors in the Run panel.
- `F5` runs the current file; Insert Date/Time moved to `Ctrl+Alt+D`; `Shift+F5` stops the run.
- Settings are loaded defensively and saved with a single debounced write.
- Window maximize and restore now follow the native resize event instead of a 500 ms poll.
- The Rust watcher emits the path the renderer subscribed with, so external changes are detected reliably.

### Fixed
- `fs_read_file` returns an error instead of a silent empty payload.
- `fs_write_file` and `fs_write_text_file` use atomic temp-file-then-rename writes.
- `fs_rename` and `fs_copy_file` canonicalize their paths.
- Windows paths with spaces are quoted in `shell_open_terminal`.
- `shell_run` reports spawn failures.
- Project search uses `VecDeque` and guards against data loss when replacing.
- Markdown preview never falls back to unsanitised HTML.
- `window.open` uses `noopener,noreferrer`.
- Plugin activation logs at debug level.
- TypeScript pinned to 5.9 so unit tests run on a clean install.
- The 1.75 MB JavaScript bundle is split into domain chunks.

## [1.3.0] - 2026-11-22

### Added
- Git integration: status bar branch, diff gutter markers, blame, commit, stage, rename branch.
- Multi-root workspace: open extra folders as workspace roots.
- LSP: signature help, hover docs, rename symbol, code actions, workspace symbols.
- Export active file to standalone HTML.
- Terminal tabs (multiple PTY sessions per tab, close, rename).
- Rust PTY-backed terminal (real interactive programs, resize support).
- Overwrite mode and scroll-past-end toggles, column selection mode.
- Line transpose, UUID/timestamp generation, ROT13 and case conversion, etc.
- User-installable themes (dashboard) — editor colour palette.

## [1.2.0] - 2026-11-21

### Added
- Safer child-process termination (liveness-checked, no raw negative-PID signals).
- Strict Content Security Policy in the webview.
- External file-change dialog (Reload / Keep / Compare) instead of a toast.
- Version sync script (`scripts/sync-version.mjs`) with `VERSION` as single source of truth.
- macOS builds in the CI matrix.
- Platform-aware download button on the website.

### Changed
- LSP client now only advertises implemented capabilities.
- File watchers are cleaned up reliably (no leaks on tab close).
- Binary detection uses a density threshold instead of a single null byte.
- Truncated files can no longer be saved (data-loss guard).
- Tab IDs use `crypto.randomUUID()`.
- Path canonicalization avoids case-sensitivity bugs.
- Plugin evaluation no longer exposes `window` to plugins.

### Fixed
- Window control buttons (minimize / maximize / close) now use native Rust commands.
- Large-file banner notes that saving is disabled.

## [2.0.0] - 2026-11-20

### Added

- **Native shell with Tauri 2.** The Electron runtime is gone; the
  application is now a small Rust process plus the system webview. The
  interface, the commands, the editors and the tests are unchanged.
- `src-tauri/` — the Rust side: window creation, the typed command surface,
  the file system, project search, the language server host, the terminal
  shell, the runners, the settings/session/recent store and the plugins.
- `src/renderer/src/bridge.ts` — implements the old `window.api` contract on
  top of `invoke()` and `listen()`, so the React code does not know which
  shell it runs in.
- `src/shared/api.ts` — the typed `window.api` contract, shared by the
  bridge and the renderer.
- `docs/adr/0004-tauri-instead-of-electron.md` — the decision record.

### Changed

- The window is still undecorated and drawn by the application; the title
  bar drag regions use `data-tauri-drag-region`.
- The native menu bar was dropped. The in-app hamburger menu and the command
  palette own every action; `api.menu.*` stays successful but does nothing.
- The unit-test loader uses `module.register()` with TypeScript
  `transpileModule`, so it runs on Node 20.
- Modernised defaults: system theme, `intellij-light` syntax theme, flat
  light/dark palettes, underline tabs, no glass/gradient/shadows.

### Removed

- The Electron main process (`src/main/`), the preload (`src/preload/`),
  `launcher/`, `CMakeLists.txt`, `electron.vite.config.ts`,
  `electron-builder.local.json` and the Electron test harnesses.

## [1.1.0] - 2026-11-21

### Fixed
- **Window close button** now reliably closes the window; added a guard so the
  control never fails silently when the webview handle is unavailable.
- **Theme switching** applies immediately to the whole window (frame, title
  bar and editor) when you change it in Settings.
- Window controls show the right glyph and state after maximise/restore.

### Added
- GitHub Pages website with download links, glass effects and animations.

## [Unreleased]

### Removed

- **Obsidian-style vault features** (vault index, wikilinks, backlinks, tags,
  graph, frontmatter, heading extraction, daily notes).
- **LibreOffice Writer / Word features** (WYSIWYG `Tiptap`, `.docx`/`.rtf`/`.odt`
  conversion via `mammoth`/`docx`/`jszip`, print / PDF export).
- **Locale trim**: `fr`, `ja`, `pt-BR`, `ar` removed; kept `en`, `de`, `es`, `ru`,
  `zh-CN`. All translations, settings, native menu and tests updated.
- **Unused modules / deps**: `core/vault.ts`, `core/wikilinks.ts`,
  `core/richText.ts`, `core/frontmatter.ts`, `RichTextEditor`/`RichToolbar`,
  `BacklinksPanel`/`TagPanel`/`GraphView`/`SearchPanel`, `main/docs/`,
  16 `@tiptap/*`, `docx`, `jszip`, `mammoth`, `tests/frontmatter.test.mts`.
- **Build packaging** (`build.files`) reduced to `out/**/*`, `package.json`,
  `node_modules/iconv-lite/**/*`, `node_modules/safer-buffer/**/*`; `npm install`
  dropped 81 packages.

### Added

- **Five-language interface** (`en`, `de`, `es`, `ru`, `zh-CN`) — `npm run i18n:check` green (537/537 × 4).
- Leaner `EditorPane` (`MarkdownPreview` plain `marked` + DOMPurify,
  `OutlinePanel` local `extractHeadings`, `FileTree` no `vaultRoot`),
  real working buttons (`file.open`, `commandPalette`, `quickSwitcher`).
  - The English catalogue (`src/shared/i18n/en.ts`) is the source of truth.
  - The other languages are plain JSON files in `src/shared/i18n/locales/`.
  - A key that is not translated yet falls back to English, so a half finished
    translation never breaks the application.
  - `npm run i18n:check` proves that every language file matches the English
    catalogue; `npm run i18n:coverage` shows how much is translated.
- Every dialog of the application keeps the keyboard focus inside it, closes
  with the escape key and gives the focus back to the control that opened it.
- The keyboard focus is visible everywhere, and the animations are switched
  off when the system asks for less movement.
- A unit test suite that runs the pure logic of the application without a
  window: `npm run test:unit`.
- A formatter with the settings of the project: `npm run format`.

### Changed

- The native menu is written in the language of the interface and is rebuilt
  when the language changes.
- Every window of the application is created by the same factory, so a second
  window looks exactly like the first one.
- The language servers of a project are now also found when the project
  folder is not named in the settings, but can be derived from the open file.
- The list of the tabs scrolls when there are more tabs than the window can
  show; the button that opens a new file always stays visible.
- The tabs can be walked through with the arrow keys (`Alt` with the arrow
  keys switches the tab from anywhere in the window).
- A jump to a line puts the line into the middle of the window.
- The shortcut of a command is a real shortcut now: the keys that only the
  commands declare (`F12`, `Shift+F12`, `Ctrl+`` `, `Ctrl+Shift+T`) work.
- The shortcut of the user wins over the accelerator of the native menu: the
  menu gives up its accelerator for a command that the user has bound.
- A key is never handled twice: the editor, the native menu and the window
  take turns, and only the first one that handles a key acts.

### Fixed

- A `[[wikilink]]` inside a code block is an example and no longer counted
  as a link of the vault.
- The message of a plugin (`ctx.toast(...)`) is shown again.
- A plugin that cannot be activated no longer leaves its commands behind.
- A plugin may use `export default { … }`, the syntax of the documentation.
- `Ctrl++` can be used as a shortcut (the plus key).
- `Alt` with the arrow keys switches the tab, even without `Ctrl`.
- `Ctrl+Shift+F` belongs to the search in files; the distraction free mode
  moved to `Ctrl+Alt+F`.
- The colour of the window follows the theme again; the call to the removed
  native overlay is gone.
- The launcher starts the packaged application (the process is called
  *FlintQode* in the task manager) and opens no console window.

## [1.0.0] - 2026-10-19

The first public release.

### Added

- A text editor for code, plain text and Markdown with 129 languages,
  50 colour themes, code folding, a minimap and a find panel.
- Rich text editing for Word (`.docx`), OpenDocument (`.odt`), RTF, HTML and
  CSV, with printing and PDF export.
- Vaults: folders of notes with `[[wikilinks]]`, backlinks, tags, a heading
  outline, a graph and daily notes.
- An integrated terminal, a run panel and 35+ file icon themes.
- Language servers: go to definition, find references, the diagnostics of the
  server in the problems panel.
- A project wide search with regular expressions and a replace in every file.
- A command palette, a quick switcher and a main menu that is drawn by the
  application.
- 18 sound themes that are synthesised in the browser — no audio files are
  shipped.
- A native launcher, so the application can be started with a double click.
