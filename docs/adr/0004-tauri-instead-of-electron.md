# 4. Tauri 2 instead of Electron

**Status:** accepted

## Context

The first FlintQode releases were an Electron application: a Node.js main process, a preload
script that exposed `window.api` through `contextBridge`, and a React + CodeMirror renderer.
That worked, but it shipped a whole Chromium and Node.js runtime with every copy of the editor.
The application folder was several hundred megabytes, the idle memory use was counted in
hundreds of megabytes, and the installer had to carry the Electron runtime plus an extracted
copy of it.

The application is a text editor. It needs a webview for CodeMirror and the UI, and it needs a
small native layer for files, processes and language servers. Shipping a browser engine of our
own is not what the product is.

## Decision

FlintQode 2 uses **Tauri 2**:

* the native layer is Rust (`src-tauri/src/*.rs`);
* the interface stays React + CodeMirror and is built by Vite;
* the system webview is used (WebView2 on Windows, WebKitGTK on Linux, WKWebView on macOS);
* the dialogs and the clipboard come from the official Tauri plugins;
* the window is still undecorated and drawn by the application (see ADR 1).

The existing renderer was written against a promise-based `window.api` contract. Instead of
rewriting every component, `src/renderer/src/bridge.ts` implements that contract on top of
`invoke()` and `listen()` and installs it as `window.api` in `main.tsx`. The typed contract
lives in `src/shared/api.ts`. The renderer therefore kept its commands, stores, editors and
tests, and the migration stayed reviewable.

The native menu bar was dropped in the same step. The in-app hamburger menu and the command
palette already covered every action, and a native menu would have been a second, per-platform
translation of the same structure.

## Consequences

* The installed application is a few megabytes instead of a few hundred, and it uses the
  webview the operating system already maintains.
* The build now needs the Tauri prerequisites: a Rust toolchain and, on Linux, the WebKitGTK 4.1
  and GTK 3 development packages. `README.md` lists the packages for the common distributions.
* The renderer no longer has Node.js at all. Every file system, process and window operation
  goes through a command in `src-tauri/src/lib.rs`; the capability file grants only the dialog,
  clipboard and core window permissions.
* The native side is Rust, so the file system, search, language server, terminal and run code
  had to be ported from the TypeScript handlers. Their behaviour (encodings, binary detection,
  large-file limits, search filters, marker lines, runner table) was kept.
* The WebView differs between platforms. The UI sticks to standard CSS and CodeMirror
  APIs; no Chromium-only feature is required.
* The old Electron test harnesses drove the app through environment variables. They are gone;
  the pure logic is covered by `npm run test:unit`, and the native build is checked with
  `cargo check` / `tauri build` on each platform.

## Alternatives considered

* **Keep Electron and trim it.** The runtime and memory cost stay, and the vulnerability surface
  of a bundled Chromium stays with it.
* **GTK4 / Slint / egui.** A native toolkit would mean rewriting the whole interface and losing
  CodeMirror, the Markdown preview and the existing component work. Rejected by the product
  owner.
* **Neutralinojs.** Smaller than Electron, but the API surface, the plugin ecosystem and the
  window handling were a poorer fit than Tauri.
* **A local web server in a system browser.** No native window, no file dialogs and no
  reasonable way to run language servers.
