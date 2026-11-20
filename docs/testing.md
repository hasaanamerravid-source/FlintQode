# Testing

OpenNotes keeps its test surface small and honest: the pure logic is covered by unit tests, the
build is checked by TypeScript and Vite, and the native layer is checked with Cargo. There is no
scripted UI harness any more — the previous Electron harnesses depended on the Electron runtime
and on environment variables that the Tauri shell does not have.

| Check | Command | What it covers |
| --- | --- | --- |
| Formatting | `npm run format:check` | Prettier over the TypeScript, CSS and scripts |
| Types | `npm run typecheck` | The renderer, the shared code and `vite.config.ts` |
| Translations | `npm run i18n:check` | Every locale matches the English catalogue |
| Unit tests | `npm run test:unit` | The pure logic: translations, transforms, shortcuts, messages |
| Renderer build | `npm run build` | The Vite production bundle in `dist/` |
| Native build | `cd src-tauri && cargo check` | The Rust commands, services and window setup |
| Full gate | `npm run check` | Format check + typecheck + i18n + unit tests + renderer build |

`npm run check` is the gate for a change that does not touch Rust. A change in `src-tauri/` also
needs `cargo check` (and ideally `npm run build:app`, which needs the Tauri system dependencies).

## The unit tests

`tests/*.test.mts` run on the test runner of Node (`node --test`) with
`node:assert/strict`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sortLines } from '@/core/transforms'

test('sorting keeps the trailing newline', () => {
  assert.equal(sortLines('b\na\n'), 'a\nb\n')
})
```

The sources of the project are imported directly, without a build step.
`scripts/register-ts.mjs` registers the loader in `scripts/ts-hook.mjs` with
`module.register()`. The loader

* resolves the path aliases of the project (`@shared/*` → `src/shared`, `@/*` →
  `src/renderer/src`) and the imports without a file extension,
* transpiles TypeScript with the installed `typescript` package (Node 20 cannot strip types
  itself; `module.register()` works on Node 20.6 and later, unlike `registerHooks()`),
* turns a JSON file into an ES module, so that the catalogues of the translation can be
  imported the way the bundler imports them.

| File | What it checks |
| --- | --- |
| `tests/i18n.test.mts` | `src/shared/i18n/index.ts`: the list of the locales, the fallback to English for a missing key or an unknown language, the placeholders, the direction of a right-to-left language, the progress of a language, the format of a date and a number. |
| `tests/keybindings.test.mts` | `src/renderer/src/core/keybindings.ts`: reading a shortcut, the names of the modifiers, a shortcut that ends with a plus (`Ctrl++`), a shortcut without a key, and the import of the shortcuts of another editor. |
| `tests/transforms.test.mts` | `src/renderer/src/core/transforms.ts`: sorting (the line ending and the trailing newline are kept), removing the duplicated and the empty lines, trimming the trailing whitespace, joining the lines, changing the case, the line numbers, and the counting of the occurrences (case, whole word, overlapping, special characters). |

A good unit test names the behaviour, not the function:

```ts
test('a missing translation falls back to English', () => {
  const english = translate('en', 'app.tagline')
  assert.equal(typeof english, 'string')
  assert.ok(english.length > 0)
})
```

The assertions should be exact (`assert.equal` with the expected value) so that a wrong result is
named in the report. A test that only proves that nothing threw is weak.

## The renderer build

`npm run build` runs Vite and fails on an unresolved import, a syntax error or a transform error.
It writes `dist/`, which is exactly what `tauri build` embeds. `npm run dev` is the fast loop for
interface work; a browser shows the UI with the settings in `localStorage`, and every native
call explains that it needs `npm run dev:app`.

## The native build

```bash
cd src-tauri
cargo fmt -- --check
cargo clippy --all-targets -- -D warnings   # optional, slower
cargo check
```

`cargo check` compiles every command and every service. On Linux it needs the WebKitGTK 4.1 and
GTK 3 development packages listed in `README.md`; on Windows and macOS the normal Tauri
prerequisites are enough.

The release build is `npm run build:app` (`tauri build`). It runs the Vite build first and then
compiles the Rust side with the release profile from `src-tauri/Cargo.toml`.

## Manual smoke test

Before a release, do this by hand on each platform:

| Step | What should happen |
| --- | --- |
| Start the app | An undecorated window with the flat dark/light shell; the title bar can be dragged |
| Open a text file, edit it, save it | The dirty dot appears and disappears; the file on disk changes |
| Open a UTF-16 file and a binary file | The encoding is shown in the status bar; the binary file is refused with a message |
| Search a project | Hits appear, the file filter works, replace changes the files |
| Open a `.md` file | Source, split and preview views agree; links resolve relative to the file |
| Start the terminal and run a command | Output appears; the prompt comes back; interrupt kills a long command |
| Run a `.py`, `.js` and `.go` file | The run panel streams the output; starting a second run stops the first |
| Install a language server | The status shows `ready`, diagnostics appear in the problems panel |
| Open Settings, switch the language and the theme | The whole UI follows; a restart keeps both |
| Close and reopen the app | The session, the recent files and the settings are restored |
| Drop a file onto the window | The file opens in a tab |
| Open a second window (`Ctrl+Shift+N`) | A second, identical window appears |

## Rules for a new test

* A test lives in `tests/` and ends with `.test.mts`.
* It tests behaviour, not implementation details. If a test has to import a private helper, the
  behaviour belongs in a small exported function in `src/renderer/src/core/`.
* It does not need a window, the network or a specific operating system. Anything that needs
  those is a manual smoke test, not a unit test.
* It must be deterministic: no timers, no random data unless the seed is fixed, no dependency on
  the user's home folder.
