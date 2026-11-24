# FlintQode documentation

The technical documentation of FlintQode. Every statement in these files is backed by the
source; the file is named where it matters.

| File | What it answers |
| --- | --- |
| [architecture.md](architecture.md) | How the application is put together: the native layer and the webview, the bridge and the trust boundary, the command system, the editor abstraction, the state, the file system layer, the language servers, the search, the terminal and the run panel, the plugins, the internationalisation, the performance rules and the build. It ends with a table that maps a kind of change to the file it belongs in. |
| [adr/0001-a-window-frame-drawn-by-the-application.md](adr/0001-a-window-frame-drawn-by-the-application.md) | Why the window frame is drawn by the application instead of the native one, and what that costs. |
| [adr/0002-a-language-server-client-without-a-library.md](adr/0002-a-language-server-client-without-a-library.md) | Why the LSP client is written by hand instead of using a library, and what the protocol surface therefore is. |
| [adr/0003-plain-text-files-for-everything.md](adr/0003-plain-text-files-for-everything.md) | Why the keybindings, the project configuration and the settings are plain JSON files in the application-data folder, and what that buys. |
| [adr/0004-tauri-instead-of-electron.md](adr/0004-tauri-instead-of-electron.md) | Why the Electron shell was replaced by Tauri 2, how the existing renderer was kept, and what the migration costs. |
| [adr/0005-solidjs-2-renderer.md](adr/0005-solidjs-2-renderer.md) | Why 1.4.5 moved the interface to SolidJS 2, how the native bridge was preserved, and what the Aurora Slate design layer changes. |
| [extension-api.md](extension-api.md) | The plugin API: what a plugin is, the context it receives during activation, the commands it can register and the bridge it can use. |
| [solid-port-guide.md](solid-port-guide.md) | The completed renderer port: Solid 2 API differences, store conventions and the invariants that must not change. |
| [keyboard-shortcuts.md](keyboard-shortcuts.md) | The complete list of the keyboard shortcuts, and which of the binding mechanisms is responsible for each of them. |
| [testing.md](testing.md) | The checks, the commands that run them and the rules for writing a test. |
| [i18n.md](i18n.md) | The languages of the interface: how the catalogue works and how to add a language or a new string. |

## Related material in the repository

| File | What it is |
| --- | --- |
| `README.md` | The user-facing description of the application: features, requirements, scripts and user-data locations. |
| `src/shared/contracts.md` | The interfaces between the layers: the bridge surface, the command system, the editor registry and the documents. |
| `src/shared/api.ts` | The typed `window.api` contract that the Tauri bridge implements. |
| `src/shared/types.ts` | The types the renderer and the native side share. |

## Reading order

For a first pass, read `architecture.md` from the top: the native layer and the bridge, the
command system and the editor abstraction explain why the rest of the code looks the way it does.
The decision records then explain the choices that are not obvious from the code alone.
