/**
 * Terminal state: the interactive shells.
 *
 * The main process owns one PTY per tab. The renderer keeps one session per
 * terminal tab and can switch between them, exactly like VS Code's shell tabs.
 */

import { create } from 'zustand'
import type { TerminalEvent, TerminalLine, TerminalListItem, TerminalStartResult } from '@shared/api'

export type { TerminalLine, TerminalStartResult }

/** The events the main process sends for a session. */
export type TerminalEventLocal = Omit<TerminalEvent, 'sessionId'>

export interface TerminalSession {
  id: string
  label: string
  cwd: string
  shell: string
  running: boolean
  busy: boolean
  lines: TerminalLine[]
  history: string[]
  historyIndex: number
}

export interface TerminalState {
  sessions: TerminalSession[]
  activeId: string | null
  /** Start the first session (the tab bar shows it). */
  start: (cwd?: string) => Promise<TerminalStartResult | null>
  /** Create a new terminal tab. */
  create: (cwd?: string, label?: string) => Promise<TerminalStartResult | null>
  /** The active session. */
  getActive: () => TerminalSession | undefined
  /** Switch the active session. */
  switch: (id: string) => void
  /** Close a session. */
  close: (id: string) => void
  /** Run a command. */
  write: (sessionId: string, command: string) => void
  /** Stop the command that is running (Ctrl+C). */
  interrupt: (sessionId: string) => void
  /** Stop a session (the shell). */
  stop: (sessionId: string) => void
  /** Clear the output of a session. */
  clear: (sessionId: string) => void
  /** Walk back in the history of a session. */
  historyPrev: (sessionId: string) => string | null
  /** Walk forward in the history of a session. */
  historyNext: (sessionId: string) => string | null
  /** List the backend sessions. */
  list: () => void
}

/** The oldest lines are dropped when the log grows too long. */
export const MAX_TERMINAL_LINES = 2000
export const MAX_TERMINAL_HISTORY = 100

/** The bridge to the main process (it may be missing in an old build). */
interface TerminalBridge {
  start?: (cwd?: string) => Promise<TerminalStartResult | null> | unknown
  create?: (cwd?: string, label?: string) => Promise<TerminalStartResult | null> | unknown
  write?: (sessionId: string, text: string) => Promise<unknown> | unknown
  interrupt?: (sessionId: string) => Promise<unknown> | unknown
  stop?: (sessionId: string) => Promise<unknown> | unknown
  close?: (sessionId: string) => Promise<unknown> | unknown
  list?: () => Promise<TerminalListItem[] | null> | unknown
  active?: () => Promise<string | null> | unknown
  resize?: (sessionId: string, cols: number, rows: number) => Promise<unknown> | unknown
  onOutput?: (cb: (event: TerminalEvent) => void) => (() => void) | void
}

function terminalBridge(): TerminalBridge | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const api = window.api as unknown as { terminal?: TerminalBridge } | undefined
    return api?.terminal
  } catch {
    return undefined
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function toLines(text: string): TerminalLine[] {
  const parts = text.split('\n')
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop()
  return parts.map((part) => ({ type: 'stdout' as const, text: part.endsWith('\r') ? part.slice(0, -1) : part }))
}

function append(lines: TerminalLine[], fresh: TerminalLine[]): TerminalLine[] {
  if (fresh.length === 0) return lines
  const next = lines.concat(fresh)
  return next.length > MAX_TERMINAL_LINES ? next.slice(next.length - MAX_TERMINAL_LINES) : next
}

function appendSystem(lines: TerminalLine[], text: string): TerminalLine[] {
  return append(lines, [{ type: 'system', text }])
}

function upsertSession(state: TerminalState, id: string, patch: Partial<TerminalSession>): void {
  const session = state.sessions.find((entry) => entry.id === id)
  if (session) {
    Object.assign(session, patch)
    return
  }
  const next: TerminalSession = {
    id,
    label: patch.label ?? id,
    cwd: patch.cwd ?? '',
    shell: patch.shell ?? '',
    running: patch.running ?? false,
    busy: patch.busy ?? false,
    lines: patch.lines ?? [],
    history: patch.history ?? [],
    historyIndex: patch.historyIndex ?? -1,
  }
  state.sessions.push(next)
}

let dispose: (() => void) | null = null
let listingTimer: number | null = null

/** Listen to the output events of the main process (only once). */
function subscribe(): void {
  if (dispose) return
  const onOutput = terminalBridge()?.onOutput
  if (typeof onOutput !== 'function') return
  try {
    const stop = onOutput((event) => {
      useTerminalStore.setState((state) => {
        const session = state.sessions.find((entry) => entry.id === event.sessionId)
        if (session) {
          if (event.type === 'stdout') {
            session.lines = append(
              session.lines,
              event.text ? toLines(event.text).map((line) => ({ ...line, type: line.type as 'stdout' })) : [],
            )
            if (!event.text) session.busy = false
          } else if (event.type === 'stderr') {
            session.lines = append(
              session.lines,
              toLines(event.text ?? '').map((line) => ({ ...line, type: 'stderr' as const })),
            )
          } else if (event.type === 'exit') {
            session.running = false
            session.busy = false
            session.lines = appendSystem(session.lines, 'The shell stopped.')
          } else if (event.type === 'error') {
            session.running = false
            session.busy = false
            session.lines = appendSystem(session.lines, event.text ?? 'The shell failed.')
          }
          if (state.activeId === event.sessionId && event.type === 'stdout' && !event.text) {
            return { sessions: state.sessions }
          }
          return { sessions: state.sessions.map((s) => (s.id === event.sessionId ? session : s)) }
        }
        return state
      })
    })
    dispose = typeof stop === 'function' ? stop : () => undefined
  } catch {
    dispose = null
  }
}

/** Ask the main process which sessions exist and pick a new active one. */
function resyncFromMain(state: TerminalState): void {
  const bridge = terminalBridge()
  if (typeof bridge?.list !== 'function') return
  void Promise.resolve(bridge.list())
    .then((list) => {
      if (!Array.isArray(list)) return
      useTerminalStore.setState((s) => {
        const sessions = s.sessions.map((session) => {
          const item = list.find((entry) => entry.id === session.id)
          return item ? { ...session, cwd: item.cwd, shell: item.shell, label: item.label } : session
        })
        return { sessions }
      })
    })
    .catch(() => undefined)
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  sessions: [],
  activeId: null,

  getActive: () => get().sessions.find((s) => s.id === get().activeId),

  create: async (cwd, label) => {
    const bridge = terminalBridge()
    if (typeof bridge?.create !== 'function') return null
    const result = await Promise.resolve(bridge.create?.(cwd, label) ?? null).catch(() => null)
    const info = result as TerminalStartResult | null
    if (info) {
      set((s) => {
        const session: TerminalSession = {
          id: info.id,
          label: info.label,
          cwd: info.cwd,
          shell: info.shell,
          running: true,
          busy: false,
          lines: appendSystem([], info.cwd ? `Shell started in ${info.cwd}` : 'Shell started'),
          history: [],
          historyIndex: -1,
        }
        return { sessions: [...s.sessions, session], activeId: info.id }
      })
    }
    return info
  },

  start: async (cwd) => {
    const bridge = terminalBridge()
    if (typeof bridge?.start !== 'function') return null
    // Prefer the multiple-tab API when available; fall back to `terminal_start`.
    const useNew = typeof bridge.create === 'function'
    const call = useNew ? () => bridge.create?.(cwd, undefined) : () => bridge.start?.(cwd)
    const result = await Promise.resolve(call()).catch(() => null)
    const info = (result ?? null) as TerminalStartResult | null
    if (!info) return null
    const id = info.id
    set((s) => {
      const sessions = s.sessions.map((session) =>
        session.id === id
          ? {
              ...session,
              label: info.label,
              cwd: info.cwd,
              shell: info.shell,
              running: true,
              lines: appendSystem(session.lines, info.cwd ? `Shell started in ${info.cwd}` : 'Shell started'),
            }
          : session,
      )
      const seen = sessions.some((session) => session.id === id)
      return {
        sessions: seen
          ? sessions
          : [
              ...sessions,
              {
                id,
                label: info.label,
                cwd: info.cwd,
                shell: info.shell,
                running: true,
                busy: false,
                lines: appendSystem([], info.cwd ? `Shell started in ${info.cwd}` : 'Shell started'),
                history: [],
                historyIndex: -1,
              },
            ],
        activeId: id,
      }
    })
    return info
  },

  switch: (id) => {
    set((s) => (s.sessions.some((session) => session.id === id) ? { activeId: id } : s))
    const bridge = terminalBridge()
    if (typeof bridge?.active === 'function') void Promise.resolve(bridge.active()).catch(() => undefined)
  },

  close: (id) => {
    const bridge = terminalBridge()
    if (typeof bridge?.close === 'function') void Promise.resolve(bridge.close(id)).catch(() => undefined)
    set((s) => {
      const sessions = s.sessions.filter((session) => session.id !== id)
      const activeId = s.activeId === id ? (sessions[0]?.id ?? null) : s.activeId
      return { sessions, activeId }
    })
  },

  write: (sessionId, command) => {
    if (!command.trim()) return
    const session = get().sessions.find((entry) => entry.id === sessionId)
    set((s) => {
      const session = s.sessions.find((entry) => entry.id === sessionId)
      if (!session) return s
      const lines = append(session.lines, [{ type: 'input', text: command }])
      const history = session.history.concat(command).slice(-MAX_TERMINAL_HISTORY)
      return {
        sessions: s.sessions.map((entry) =>
          entry.id === sessionId ? { ...entry, lines, history, historyIndex: -1, busy: true } : entry,
        ),
      }
    })
    const bridge = terminalBridge()
    if (typeof bridge?.write !== 'function') return
    try {
      void Promise.resolve(bridge.write(sessionId, command)).catch((error: unknown) => {
        set((s) => ({
          sessions: s.sessions.map((entry) =>
            entry.id === sessionId
              ? { ...entry, lines: appendSystem(entry.lines, `Could not run the command: ${errorMessage(error)}`) }
              : entry,
          ),
        }))
      })
    } catch {
      /* ignore */
    }
  },

  interrupt: (sessionId) => {
    const bridge = terminalBridge()
    if (typeof bridge?.interrupt !== 'function') return
    try {
      void Promise.resolve(bridge.interrupt(sessionId)).catch(() => undefined)
    } catch {
      /* the command is killed anyway */
    }
  },

  stop: (sessionId) => {
    const bridge = terminalBridge()
    if (typeof bridge?.stop === 'function') {
      try {
        void Promise.resolve(bridge.stop(sessionId)).catch(() => undefined)
      } catch {
        /* the shell is stopped anyway */
      }
    }
    set((s) => ({
      sessions: s.sessions.map((session) =>
        session.id === sessionId ? { ...session, running: false, busy: false } : session,
      ),
    }))
  },

  clear: (sessionId) => {
    set((s) => ({
      sessions: s.sessions.map((session) => (session.id === sessionId ? { ...session, lines: [] } : session)),
    }))
  },

  historyPrev: (sessionId) => {
    const state = get()
    const session = state.sessions.find((entry) => entry.id === sessionId)
    if (!session || session.history.length === 0) return null
    const index = session.historyIndex < 0 ? session.history.length - 1 : Math.max(0, session.historyIndex - 1)
    set((s) => ({
      sessions: s.sessions.map((entry) => (entry.id === sessionId ? { ...entry, historyIndex: index } : entry)),
    }))
    return session.history[index]
  },

  historyNext: (sessionId) => {
    const state = get()
    const session = state.sessions.find((entry) => entry.id === sessionId)
    if (!session || session.historyIndex < 0) return null
    const index = session.historyIndex + 1
    if (index >= session.history.length) {
      set((s) => ({
        sessions: s.sessions.map((entry) => (entry.id === sessionId ? { ...entry, historyIndex: -1 } : entry)),
      }))
      return null
    }
    set((s) => ({
      sessions: s.sessions.map((entry) => (entry.id === sessionId ? { ...entry, historyIndex: index } : entry)),
    }))
    return session.history[index]
  },

  list: () => {
    if (listingTimer) clearInterval(listingTimer)
    listingTimer = window.setInterval(() => resyncFromMain(get()), 5000)
  },
}))

if (typeof window !== 'undefined') subscribe()

// Legacy exports used by older callers.
/** The primary session's lines (used by compact panels). */
export function terminalLines(): TerminalLine[] {
  return useTerminalStore.getState().getActive()?.lines ?? []
}

/** The primary session's cwd. */
export function terminalCwd(): string {
  return useTerminalStore.getState().getActive()?.cwd ?? ''
}

/** The primary session's running flag. */
export function terminalRunning(): boolean {
  return useTerminalStore.getState().getActive()?.running ?? false
}

/** A snapshot of the primary session, for the command layer. */
export interface TerminalSnapshot {
  running: boolean
  cwd: string
  lines: TerminalLine[]
  history: string[]
  historyIndex: number
  busy: boolean
  id: string
  label: string
  shell: string
}

export function terminalState(): TerminalSnapshot {
  const state = useTerminalStore.getState()
  const active = state.getActive()
  return {
    running: active?.running ?? false,
    cwd: active?.cwd ?? '',
    lines: active?.lines ?? [],
    history: active?.history ?? [],
    historyIndex: active?.historyIndex ?? -1,
    busy: active?.busy ?? false,
    id: active?.id ?? '',
    label: active?.label ?? '',
    shell: active?.shell ?? '',
  }
}

/** Start the primary shell (used by the command layer). */
export function startTerminal(cwd?: string): Promise<TerminalStartResult | null> {
  return useTerminalStore.getState().start(cwd)
}

/** Stop the primary shell (used by the command layer). */
export function stopTerminal(): void {
  const state = useTerminalStore.getState()
  const id = state.activeId
  if (id) state.stop(id)
}
