# Solid 2 renderer port guide

The 1.4.5 renderer is the completed SolidJS 2.0 port. The Rust/Tauri backend and
`src/renderer/src/bridge.ts` were deliberately left unchanged: the native API is the contract
the UI builds on.

## Toolchain

- `solid-js@2.0.3`, `@solidjs/web@2.0.3`, `@solidjs/vite-plugin@3.0.1`
- Node 22.12+ is required. Use `PATH="$PWD/.tools/node22/bin:$PATH"`.
- TypeScript config uses `jsx: "preserve"` and `jsxImportSource: "@solidjs/web"`.
- Vite plugin compiles JSX. TypeScript only type-checks it.

## Imports

```ts
import {
  createSignal,
  createMemo,
  createEffect,
  onSettled,
  onCleanup,
  For,
  Show,
  Switch,
  Match,
  lazy,
  type Accessor,
  type Component,
} from 'solid-js'
import { render, type JSX } from '@solidjs/web'
```

- `JSX.Element` types come from `@solidjs/web`.
- `render` comes from `@solidjs/web`.
- There is no `onMount` in Solid 2. Use `onSettled`.
- There is no `Suspense`. Use `Loading` from `solid-js`.
- There is no `batch`. Use `flush` from `solid-js` if synchronous visibility is required.
- `batch`, `onMount`, `Suspense`, `createSelector`, `unwrap`, `mergeProps`, `splitProps`,
  `produce`, and `use:` are gone in Solid 2.

## Renderer conventions

- Use Solid primitives and `@solidjs/web`; no legacy framework hooks remain.
- `className` → `class`; `htmlFor` → `for`; `tabIndex` → `tabindex`.
- `class` accepts strings, arrays, and objects: `class={['tab', { active: isActive() }]}`.
- `style` accepts an object with kebab-case keys or a CSS string.
- Do **not** destructure props. Read `props.foo` inside JSX or computations.
- Pass values, not accessors, at call sites: `<Child value={count()} />`.
- No `key` prop. Use `<For each={items()}>{item => ...}</For>`.
- Replace `.map(...)` in JSX with `<For>`. Replace `cond && <X/>` with `<Show when={cond}>`.
- Replace ternaries in JSX with `<Show>`/`<Switch>`/`<Match>` when they switch components.
- Event handlers are camelCase: `onClick`, `onMouseDown`, `onInput`, `onKeyDown`.
- Refs are functions only: `let host!: HTMLDivElement; <div ref={el => (host = el)} />`.
- Ref callbacks are unowned. Do layout/imperative setup in `onSettled`, not in `ref`.
- `createEffect` has two phases in Solid 2:
  ```ts
  createEffect(
    () => source(),          // tracking phase
    value => { /* side effect */ },
  )
  ```
  The apply callback is untracked. Return a cleanup function from apply if needed.
- One-time setup uses `onSettled(() => { ...; return () => cleanup() })`.
- Writes owned by computations are forbidden. Write in event handlers, actions,
  `onSettled`, or the apply phase of an effect.
- Signal writes are batched until a microtask. Use `flush()` if a value must be visible
  immediately after a write.
- `<For>` callback parameters are raw values and an index accessor by default:
  `<For each={items()}>{(item, index) => <span>{item.name} {index()}</span>}</For>`.
- `<Show when={x()}>` callback children receive an accessor:
  `<Show when={tab()}>{tab => <div>{tab().name}</div>}</Show>`.

## Stores

The command layer keeps a small, store-shaped API through `src/renderer/src/state/compat.ts`;
the implementation is a version signal plus plain state.

- Callable store reads are reactive: `useAppStore().tabs` inside JSX or a memo.
- Non-reactive snapshots use `useAppStore.getState()`.
- Actions use `useAppStore.getState().openTab(...)` (or the helpers in `state/solid.ts`).
- Do **not** call `useAppStore((state) => state.foo)`. The old selector form is gone.

Shared helpers in `src/renderer/src/state/solid.ts`:

- `appActions()`, `statusActions()`
- `useSettings()`, `useTabs()`, `useActiveTabId()`, `useActiveTab()`,
  `useActivePath()`, `useActiveLanguage()`

## Changed core module APIs

- `useT()` and `useTWith()` return the same functions as `t()` / `tWith()`; call them as
  `t('key')` inside JSX.
- `useLocale()` returns the reactive locale value when called in JSX/memo.
- `useKeybindings()` returns `Accessor<Keybindings>`; call `keybindings()`.
- `loadKeybindings()` loads bindings once during bootstrap.
- `useProblems()` returns `Accessor<Problem[]>`; call `problems()` in JSX.
- `useLspSync()` and `useLspConfiguration()` are Solid setup functions; call them once in
  `App`'s component body.
- `useProjectConfig()` returns `Accessor<ProjectConfig | null>`.

## UI parity and design

- The port preserves all commands, dialogs, keyboard shortcuts, native API calls, event
  subscriptions and drag/drop handling.
- Component class names are stable; `src/renderer/src/styles/design-system.css` is the single
  visual layer for the Aurora Slate identity.
- Business logic stays in `core/`; components own rendering, lifecycle and user interaction.
- The native bridge and Rust backend are not part of the UI design layer.

## Load-bearing invariants

- `installApi()` must run before the first render.
- `registerBuiltinCommands()` must run at module load, before the global keyboard handler exists.
- Command IDs are a stable contract for menus, keybindings, plugins, and i18n `cmd.*` keys.
- Keep the global shortcut precedence: palette Escape → custom bindings → menu-handled suppression →
  `defaultPrevented` → command defaults → tab navigation.
- File watcher debounce is 250 ms; large files are `> 4 MiB` in the store and skip editor sync above
  two million characters.
- Split panes share the exact CodeMirror `EditorState` through `syncGroup` with a forwarding guard.
- Editor unmount flushes content and cursor/scroll state.
- Run detection keeps Gradle/Fabric heuristics and integrated-terminal routing.
- Terminal output is raw PTY data; input goes through `terminal.onData` → `window.api.terminal.write`.
- `onOpenFiles` drains a one-shot `open_files_pending` queue.
- Problems merge local diagnostics + LSP diagnostics + reference problems with the exact debounce key.
- Prompt/confirm cancellation resolves with `null` / `false`.

## Solid 2 dev diagnostics

- Do **not** call the `<For>` index accessor inside the map callback. Pass the accessor to a child
  component and read it in JSX/effect compute, or capture it once with `untrack` when the list is
  static. Reading it in the callback produces `STRICT_READ_UNTRACKED`.
- Ref callbacks are unowned and strict-read labelled. Never call a signal/accessor inside one;
  capture the value with `untrack` or keep the ref itself plain (`ref={el => (host = el)}`).
- Avoid mirroring derived tab/store fields into another compat store: every store write bumps its
  own version signal, so a reader can paint once with the new source and the stale mirror
  (`EFFECT_RELAY_TEAR`). Read the source where it is displayed instead.
- Layout measurements are the exception to "write only in apply": write the measured style straight
  to the DOM rather than feeding it back into a signal that the measuring effect also reads.

## Verification

After all ports land, run:

```bash
PATH="$PWD/.tools/node22/bin:$PATH" npm run check
```
