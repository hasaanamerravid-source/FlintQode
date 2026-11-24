/**
 * State for the integrated terminal.
 *
 * The native side owns the PTYs and emits raw `terminal:output` chunks. This
 * module keeps the list of sessions and routes each chunk to the xterm
 * instance that belongs to the session. It intentionally knows nothing about
 * ANSI codes or command markers.
 */

import type { TerminalStartResult } from '@shared/api'
import { create } from '@/state/compat'
import { projectFolder } from './projectConfig'
import { useAppStore } from '../store/app'

export interface TerminalSession {
  id: string
  label: string
  cwd: string
  shell: string
  running: boolean
}

type Listener<T> = (value: T) => void

interface TerminalStore {
  sessions: TerminalSession[]
  activeId: string
  getActive: () => TerminalSession | undefined
  start: (cwd?: string, label?: string) => Promise<TerminalSession | undefined>
  create: (cwd?: string, label?: string) => Promise<TerminalSession | undefined>
  switchTo: (id: string) => void
  close: (id: string) => Promise<void>
  write: (id: string, text: string) => Promise<void>
  interrupt: (id: string) => Promise<void>
  stop: (id: string) => Promise<void>
  clear: (id: string) => void
  rename: (id: string, label: string) => void
  onData: (id: string, listener: Listener<string>) => () => void
  onExit: (id: string, listener: Listener<number | undefined>) => () => void
  onClear: (id: string, listener: Listener<void>) => () => void
}

const dataListeners = new Map<string, Set<Listener<string>>>()
const exitListeners = new Map<string, Set<Listener<number | undefined>>>()
const clearListeners = new Map<string, Set<Listener<void>>>()

function addListener<T>(map: Map<string, Set<Listener<T>>>, id: string, listener: Listener<T>): () => void {
  let set = map.get(id)
  if (!set) {
    set = new Set()
    map.set(id, set)
  }
  set.add(listener)
  return () => {
    set?.delete(listener)
    if (set?.size === 0) map.delete(id)
  }
}

function notify<T>(map: Map<string, Set<Listener<T>>>, id: string, value: T): void {
  for (const listener of map.get(id) ?? []) listener(value)
}

let unsubscribeEvents: (() => void) | undefined
// Two UI paths can ask for the first terminal in the same tick. Share the
// in-flight promise so only one PTY is created, and resolve its directory from
// live state instead of a stale store snapshot.
let pendingStart: Promise<TerminalSession | undefined> | undefined

/** The listener is installed lazily: `window.api` exists only after bootstrap. */
function ensureSubscribed(): void {
  if (unsubscribeEvents || typeof window === 'undefined' || !window.api?.terminal?.onOutput) return
  unsubscribeEvents = window.api.terminal.onOutput((event) => {
    if (event.type === 'data') {
      if (event.text) notify(dataListeners, event.sessionId, event.text)
      return
    }
    if (event.type === 'exit') {
      useTerminalStore.setState((state) => ({
        sessions: state.sessions.map((session) =>
          session.id === event.sessionId ? { ...session, running: false } : session,
        ),
      }))
      notify(exitListeners, event.sessionId, event.code)
    }
  })
}

function resultToSession(result: TerminalStartResult): TerminalSession {
  return {
    id: result.id,
    label: result.label || 'shell',
    cwd: result.cwd,
    shell: result.shell,
    running: result.ok,
  }
}

function fail(message: string): void {
  useAppStore.getState().toast(message, 'error')
}

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  sessions: [],
  activeId: '',

  getActive: () => {
    const { sessions, activeId } = get()
    return sessions.find((session) => session.id === activeId) ?? sessions[0]
  },

  start: (cwd, label) => {
    if (pendingStart) return pendingStart
    const directory = cwd ?? useAppStore.getState().workspaceRoot ?? projectFolder() ?? undefined
    pendingStart = get()
      .create(directory, label)
      .finally(() => {
        pendingStart = undefined
      })
    return pendingStart
  },

  create: async (cwd, label) => {
    ensureSubscribed()
    try {
      const result = await window.api.terminal.create(cwd, label)
      if (!result.ok || result.error) {
        fail(result.error ?? 'Could not start the shell.')
        return undefined
      }
      const session = resultToSession(result)
      set((state) => ({ sessions: [...state.sessions, session], activeId: session.id }))
      void window.api.terminal.active(session.id).catch(() => undefined)
      return session
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error))
      return undefined
    }
  },

  switchTo: (id) => {
    set({ activeId: id })
    void window.api.terminal.active(id).catch(() => undefined)
  },

  close: async (id) => {
    try {
      await window.api.terminal.close(id)
    } catch {
      /* the process may already be gone */
    }
    dataListeners.delete(id)
    exitListeners.delete(id)
    clearListeners.delete(id)
    set((state) => {
      const sessions = state.sessions.filter((session) => session.id !== id)
      return {
        sessions,
        activeId: state.activeId === id ? (sessions[sessions.length - 1]?.id ?? '') : state.activeId,
      }
    })
  },

  write: async (id, text) => {
    try {
      await window.api.terminal.write(id, text)
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error))
    }
  },

  interrupt: async (id) => {
    try {
      await window.api.terminal.interrupt(id)
    } catch {
      /* nothing to interrupt */
    }
  },

  stop: async (id) => {
    try {
      await window.api.terminal.stop(id)
    } catch {
      /* nothing to stop */
    }
    set((state) => ({
      sessions: state.sessions.map((session) => (session.id === id ? { ...session, running: false } : session)),
    }))
  },

  clear: (id) => notify(clearListeners, id, undefined),

  rename: (id, label) => {
    set((state) => ({
      sessions: state.sessions.map((session) => (session.id === id ? { ...session, label } : session)),
    }))
  },

  onData: (id, listener) => {
    ensureSubscribed()
    return addListener(dataListeners, id, listener)
  },
  onExit: (id, listener) => addListener(exitListeners, id, listener),
  onClear: (id, listener) => addListener(clearListeners, id, listener),
}))
