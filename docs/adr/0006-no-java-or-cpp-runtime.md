# 6. No bundled Java or C++ runtime

**Status:** accepted

## Context

FlintQode supports Java and C/C++ source files: CodeMirror provides syntax grammars, the run
panel can invoke `java`, `javac`, `g++`, `gcc` and `clang`, and the language-server client can
start `jdtls` or `clangd` when those tools are installed. None of those executables is shipped
inside the application.

The native side of the application is already written in Rust (see ADR 4). It owns the work
that crosses process or IO boundaries:

* project-wide search and replace run on Rayon in `src-tauri/src/search.rs`;
* terminal sessions are real PTYs managed in `src-tauri/src/terminal.rs`;
* LSP framing and dispatch are implemented in `src-tauri/src/lsp.rs`;
* Git commands are supervised in `src-tauri/src/git.rs`;
* file decoding, atomic writes and watchers live in `src-tauri/src/fs.rs`;
* settings, session and recent-file state are stored by `src-tauri/src/store.rs`;
* update downloads and SHA-256 verification are in `src-tauri/src/updater.rs`.

The remaining CPU work is owned by the webview: CodeMirror 6 maintains the document, decorations
and visible-range rebuilds, while SolidJS 2 owns reactive UI updates (see ADR 5). The M1 profile
showed that the expensive editor paths were repeated full-document scans and decoration rebuilds,
not a missing compiled runtime. Those paths were fixed in Rust/TypeScript without adding a new
process.

Bundling a JVM or a C++ runtime would add a second ABI, a much larger installer, a new signing
and notarization surface, and a new failure mode on every one of the seven release assets. It
would not remove the webview work, because parsing, rendering and UI updates still happen in
`src/renderer`.

## Decision

FlintQode does not embed Java, C++ or any other general-purpose language runtime.

* The shipped bundle contains only the Tauri/Rust shell and the webview assets.
* Java and C/C++ support means syntax grammars plus integration with tools the user installs.
  Executables are resolved at runtime by `src-tauri/src/process.rs`, invoked by
  `src-tauri/src/run.rs`, and language servers are started by `src-tauri/src/lsp.rs`.
* Missing tools produce actionable messages that name the executable to install; they are not a
  reason to ship another runtime.
* A proposal to add a native language must be recorded as a new ADR that supersedes this one and
  must include profiling data, installer-size and startup measurements, the signing/notarization
  impact for Linux, Windows and macOS, and the fallback behavior when the runtime is unavailable.

## Consequences

* Installers stay small and have one native ABI plus the platform webview.
* There is no JVM startup cost, no bundled `libclang`/LLVM, and no JNI or C++ bridge to maintain.
* Language features depend on the user's installed toolchain. FlintQode reports that dependency
  explicitly instead of hiding it.
* Future performance work starts with a profile of the existing Rust/CodeMirror/SolidJS paths.
  A new runtime is allowed only when measured data shows it removes a bottleneck that the current
  stack cannot remove and the packaging cost is accepted in the same decision.

## Alternatives considered

* **Embed a JVM through JNI.** Rejected: large installers, new crash surface and no benefit for
  editor rendering. Java projects already use the user's JDK and language server.
* **Bundle `libclang` or a C++ compiler.** Rejected: hundreds of megabytes, platform-specific
  ABI and signing work, while parsing remains a CodeMirror concern.
* **Ship a WebAssembly interpreter.** Rejected: it still runs inside the webview, adds download
  weight and does not accelerate IO, PTY or search.
* **Return to a bundled Node/Electron runtime.** Rejected by ADR 4; the Rust shell already owns
  the native work and the webview already owns rendering.
