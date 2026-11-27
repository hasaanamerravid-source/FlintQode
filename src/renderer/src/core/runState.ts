/**
 * Run state.
 *
 * The native shell starts and stops the child process; this store listens for
 * `run:output` and keeps the output log. It also implements the high-level
 * "run the active file" command, including the Gradle projects that are run
 * through the terminal instead of a plain interpreter.
 */

import type { RunEvent } from '@shared/api'
import { create } from '@/state/compat'
import { useAppStore } from '../store/app'
import { cachedProjectConfig, resolveTool } from './projectConfig'
import { useTerminalStore } from './terminalState'
import { shouldSaveAllBeforeRun } from './saveBehavior'

export interface RunLine {
  type: 'stdout' | 'stderr' | 'system'
  text: string
}

interface RunStore {
  running: boolean
  filePath: string | null
  language: string | null
  lines: RunLine[]
  exitCode: number | null
  startedAt: number | null
  start: (filePath: string, language: string) => Promise<void>
  stop: () => Promise<void>
  clear: () => void
}

const MAX_LINES = 1200
const buffers: Record<'stdout' | 'stderr', string> = { stdout: '', stderr: '' }

/** Toolchain overrides: the project file wins over the global settings. */
export function currentToolchain(): Record<string, string> {
  const settings = useAppStore.getState().settings
  const project = cachedProjectConfig()
  const tools: Record<string, string> = {}
  for (const key of Object.keys(settings.toolchain ?? {})) {
    const value = resolveTool(key, project, settings.toolchain ?? {})
    if (value) tools[key] = value
  }
  for (const [key, value] of Object.entries(project?.toolchain ?? {})) {
    if (value && !tools[key]) tools[key] = value
  }
  return tools
}

function appendLines(current: RunLine[], type: 'stdout' | 'stderr', chunk: string): RunLine[] {
  const parts = (buffers[type] + chunk).split('\n')
  buffers[type] = parts.pop() ?? ''
  const fresh = parts.map((text) => ({ type, text: text.replace(/\r$/, '') }))
  if (!fresh.length) return current
  const next = current.concat(fresh)
  return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next
}

function appendSystem(current: RunLine[], text: string): RunLine[] {
  const next = current.concat([{ type: 'system' as const, text }])
  return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next
}

function handleEvent(event: RunEvent): void {
  switch (event.type) {
    case 'start':
      useRunStore.setState((state) => ({
        running: true,
        startedAt: Date.now(),
        lines: appendSystem(state.lines, `$ ${event.text ?? 'process'}`),
      }))
      break
    case 'stdout':
      useRunStore.setState((state) => ({ lines: appendLines(state.lines, 'stdout', event.text ?? '') }))
      break
    case 'stderr':
      useRunStore.setState((state) => ({ lines: appendLines(state.lines, 'stderr', event.text ?? '') }))
      break
    case 'error':
      useRunStore.setState((state) => ({
        running: false,
        lines: appendSystem(state.lines, event.text ?? 'The run failed.'),
      }))
      break
    case 'exit': {
      const code = event.code
      useRunStore.setState((state) => ({
        running: false,
        exitCode: code ?? null,
        lines: appendSystem(state.lines, code === undefined ? 'Process stopped.' : `Exited with code ${code}`),
      }))
      break
    }
  }
}

let unsubscribe: (() => void) | undefined
function ensureSubscribed(): void {
  if (unsubscribe || typeof window === 'undefined' || !window.api?.run?.onOutput) return
  unsubscribe = window.api.run.onOutput(handleEvent)
}

export const useRunStore = create<RunStore>((set) => ({
  running: false,
  filePath: null,
  language: null,
  lines: [],
  exitCode: null,
  startedAt: null,

  start: async (filePath, language) => {
    ensureSubscribed()
    buffers.stdout = ''
    buffers.stderr = ''
    set({ running: true, filePath, language, lines: [], exitCode: null, startedAt: Date.now() })
    try {
      const started = await window.api.run.start(filePath, language, currentToolchain())
      if (!started) set((state) => (state.running ? { running: false } : state))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set((state) => ({ running: false, lines: appendSystem(state.lines, `Could not start: ${message}`) }))
    }
  },

  stop: async () => {
    try {
      await window.api.run.stop()
    } catch {
      /* the process is gone already */
    }
    set({ running: false })
  },

  clear: () => {
    buffers.stdout = ''
    buffers.stderr = ''
    set({ lines: [], exitCode: null })
  },
}))

export function startRun(filePath: string, language: string): void {
  void useRunStore.getState().start(filePath, language)
}

export function stopRun(): void {
  void useRunStore.getState().stop()
}

const GRADLE_FILES = new Set([
  'gradlew',
  'gradlew.bat',
  'gradlew.cmd',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
  'gradle.properties',
])

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`
}

/** Find the root of the Gradle build that contains `file`. */
async function gradleRoot(file: string): Promise<string | null> {
  let dir = file.replace(/[\\/][^\\/]*$/, '')
  while (dir && dir !== '.' && dir !== '/') {
    for (const marker of ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', 'gradlew']) {
      if (await window.api.fs.exists(`${dir}/${marker}`)) return dir
    }
    const parent = dir.replace(/[\\/][^\\/]*$/, '')
    if (parent === dir) break
    dir = parent
  }
  return null
}

/** Save the active buffer and run it. */
export async function runActiveFile(): Promise<boolean> {
  const state = useAppStore.getState()
  let tab = state.tabs.find((entry) => entry.id === state.activeTabId)
  if (!tab) {
    state.toast('There is no file to run.', 'error')
    return false
  }
  if (shouldSaveAllBeforeRun(state.settings)) {
    await state.saveAll()
    tab = useAppStore.getState().tabs.find((entry) => entry.id === state.activeTabId)
    if (!tab) {
      state.toast('There is no file to run.', 'error')
      return false
    }
  }

  const file = tab.path ?? ''
  const name = file.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  if (file && (GRADLE_FILES.has(name) || tab.language.startsWith('gradle'))) {
    const root = await gradleRoot(file)
    if (root) {
      let fabric = false
      try {
        fabric =
          (await window.api.fs.exists(`${root}/fabric.mod.json`)) ||
          (await window.api.fs.exists(`${root}/src/main/resources/fabric.mod.json`))
      } catch {
        /* a plain Gradle build */
      }
      const task = fabric ? 'runClient' : 'build'
      const windows = /Windows/i.test(navigator.userAgent)
      const command = windows
        ? `cd /d "${root.replace(/"/g, '""')}" && gradlew.bat ${task}`
        : `cd ${shellQuote(root)} && (chmod +x gradlew 2>/dev/null || true) && ./gradlew ${task}`

      state.setBottomTab('terminal')
      state.setBottomPanelVisible(true)
      const terminal = useTerminalStore.getState()
      const session = terminal.getActive() ?? (await terminal.create(root))
      if (!session) {
        state.toast('Could not start the terminal.', 'error')
        return false
      }
      await terminal.write(session.id, command)
      return true
    }
  }

  if (!tab.path || tab.dirty) {
    const saved = await state.saveTab(tab.id)
    if (!saved) return false
  }
  const fresh = useAppStore.getState().tabs.find((entry) => entry.id === tab.id)
  if (!fresh?.path) {
    state.toast('Save the file before running it', 'error')
    return false
  }
  useAppStore.getState().setBottomTab('run')
  useAppStore.getState().setBottomPanelVisible(true)
  startRun(fresh.path, fresh.language)
  return true
}
