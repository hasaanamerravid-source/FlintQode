# 5. SolidJS 2 renderer and Aurora Slate design

**Status:** accepted

## Context

The 1.4.3 renderer used React and Zustand. It worked, but the interface had grown on top of
several competing visual layers, and React's render model made fine-grained editor updates more
expensive than necessary. SolidJS 2 offers signal-based reactivity, compiled JSX and a smaller
runtime while keeping the component mental model.

The Rust/Tauri backend, the editor engine and the `window.api` bridge were already stable. They
were not part of this decision.

## Decision

FlintQode 1.4.5 ships a SolidJS 2 renderer:

* `solid-js@2.0.3`, `@solidjs/web@2.0.3`, `@solidjs/vite-plugin@3.0.1` and Vite 8;
* Node.js 22.12 or newer, recorded in `.nvmrc` and `package.json`;
* signals are the reactivity primitive; `src/renderer/src/state/compat.ts` keeps a
  `getState` / `setState` / `subscribe` facade so the tested command layer did not need a rewrite;
* `src/renderer/src/styles/design-system.css` is the single visual identity layer, with stable
  component class names and user appearance settings still taking precedence;
* the default theme is Aurora Slate: deep slate surfaces, aurora accents, compact spacing and
  soft elevation.

## Consequences

* The renderer has no React or Zustand dependency.
* Components read reactive values as functions and use Solid 2 lifecycle conventions
  (`onSettled`, `Loading`, `flush`, two-phase effects).
* The command ids, native API surface, keybindings, translations and plugin contract are
  unchanged, so installers and settings remain compatible with earlier 1.x builds.
* The fresh screenshots on the website are captured from this renderer so the site and the
  application match.
* CI now builds with Node 22.12 to match the local toolchain.
