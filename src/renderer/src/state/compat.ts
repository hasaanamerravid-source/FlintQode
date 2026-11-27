/**
 * Small bridge that lets the framework-agnostic command/state modules keep their
 * `getState()/setState()/subscribe()` shape while the UI is built on Solid 2.
 *
 * New code should prefer Solid signals and stores directly. This adapter exists
 * so the large, already-tested command layer can be reused without dragging
 * React or Zustand into the new renderer.
 */
import { createSignal } from 'solid-js'

// Unique debug names keep Solid's dev diagnostics from confusing two stores:
// every compat store uses the same version-signal shape.
let storeSequence = 0

type Listener<T> = (state: T, previous: T) => void
type Setter<T> = (partial: T | Partial<T> | ((state: T) => T | Partial<T>), replace?: boolean) => void

export interface CompatStore<T> {
  (): T
  getState: () => T
  setState: Setter<T>
  subscribe: (listener: Listener<T>) => () => void
}

export function create<T>(initializer: (set: Setter<T>, get: () => T, api: CompatStore<T>) => T): CompatStore<T> {
  let state: T
  // The signal only carries a version. Reading it inside the callable store
  // makes every store read reactive without constraining the shape of T.
  const [version, bump] = createSignal(0, { name: `store.version.${++storeSequence}` })
  const listeners = new Set<Listener<T>>()

  const set: Setter<T> = (partial, replace) => {
    const previous = state
    const value = typeof partial === 'function' ? (partial as (current: T) => T | Partial<T>)(previous) : partial
    // Returning the current state is the supported way to say "nothing
    // changed". Skipping the version bump keeps no-op updates from waking
    // every store reader (diagnostics, LSP, minimap) on each keystroke.
    if (value === previous) return
    state = (replace === true ? value : { ...(previous as object), ...(value as object) }) as T
    bump((current) => current + 1)
    for (const listener of listeners) listener(state, previous)
  }

  const get = (): T => state

  const api = {
    getState: get,
    setState: set,
    subscribe: (listener: Listener<T>): (() => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  } as CompatStore<T>

  state = initializer(set, get, api)

  const useStore = (() => {
    version()
    return state
  }) as CompatStore<T>
  return Object.assign(useStore, api)
}

/* ------------------------------------------------------------------ *
 * Framework-agnostic editor helpers                                   *
 * ------------------------------------------------------------------ */

/** A timer that can be injected in tests instead of a real clock. */
export interface DebounceScheduler {
  schedule: (task: () => void, delayMs: number) => number
  cancel: (handle: number) => void
}

export interface DebouncedRenderer {
  /** Result of the last completed render; unchanged while an update is pending. */
  html: () => string
  /** Queue a source update. `immediate` is used for the first visible render. */
  update: (source: string, immediate?: boolean) => void
  /** Cancel a pending render. */
  dispose: () => void
}

/**
 * Debounce a pure renderer. Only the newest source of a typing burst is
 * rendered and the previous HTML stays visible until that render finishes.
 */
export function createDebouncedRenderer(
  render: (source: string) => string,
  scheduler: DebounceScheduler,
  delayMs: number,
  onRender?: (html: string) => void,
): DebouncedRenderer {
  let rendered = ''
  let pending: string | null = null
  let timer: number | undefined

  const flush = (): void => {
    timer = undefined
    if (pending === null) return
    const source = pending
    pending = null
    rendered = render(source)
    onRender?.(rendered)
  }

  return {
    html: () => rendered,
    update(source, immediate = false) {
      pending = source
      if (timer !== undefined) scheduler.cancel(timer)
      if (immediate) flush()
      else timer = scheduler.schedule(flush, delayMs)
    },
    dispose() {
      if (timer !== undefined) scheduler.cancel(timer)
      timer = undefined
      pending = null
    },
  }
}

/** One document edit, in the coordinates of the document before the change. */
export interface DocChange {
  from: number
  to: number
  insert: string
}

export interface SplitSyncSpec {
  changes: DocChange[]
}

/** The smallest thing a peer editor needs to catch up with a document edit. */
export function splitSyncSpec(changes: readonly DocChange[]): SplitSyncSpec | null {
  return changes.length ? { changes: [...changes] } : null
}

interface SplitPeer {
  dispatch: (spec: SplitSyncSpec) => void
}

/**
 * Dispatch one changes object to each peer. Selection-only updates produce no
 * changes, so they do no peer work at all.
 */
export function dispatchSplitChanges(changes: readonly DocChange[], peers: readonly SplitPeer[]): number {
  const spec = splitSyncSpec(changes)
  if (!spec) return 0
  for (const peer of peers) peer.dispatch(spec)
  return peers.length
}

/** The text and cursor last written back into the tab store. */
export interface EditorFlushState {
  text: string
  cursor: number
}

/** Only flush the editor on teardown when the tab would actually change. */
export function needsEditorFlush(last: EditorFlushState, next: EditorFlushState): boolean {
  return last.text !== next.text || last.cursor !== next.cursor
}
