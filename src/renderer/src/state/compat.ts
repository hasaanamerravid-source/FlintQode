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
