import { createEffect, createSignal, type Accessor } from 'solid-js'
import { useAppStore } from '../store/app'

/** The per project configuration, stored as plain JSON in the project folder. */
export interface ProjectConfig {
  /** Interpreter / SDK paths, keyed by language. */
  toolchain?: Record<string, string>
  /** Language server commands, keyed by language. */
  lsp?: Record<string, { command: string; args?: string[] }>
  /** The shell used by the terminal. */
  terminal?: { shell?: string; cwd?: string }
  /** Extra arguments for the run command, keyed by language. */
  run?: Record<string, string[]>
  /** The shortcuts of the commands, keyed by the id of the command. */
  keybindings?: Record<string, string>
}

export const PROJECT_CONFIG_NAME = '.flintqode.json'

/** The configuration file name used before the rename. Still read for
 *  backwards compatibility, but new files are written under the new name. */
export const LEGACY_PROJECT_CONFIG_NAME = '.opennotes.json'

/** The folder of a file (the path without the file name). */
export function folderOfPath(filePath: string): string | null {
  if (!filePath) return null
  const separator = filePath.includes('\\') ? '\\' : '/'
  const parts = filePath.split(/[\\/]/)
  parts.pop()
  return parts.join(separator) || null
}

/** Join a folder and a file name with the separator the folder already uses. */
function joinPath(folder: string, name: string): string {
  return `${folder.replace(/[\\/]+$/, '')}/${name}`
}

type AppSnapshot = ReturnType<typeof useAppStore.getState>

function folderFromState(state: AppSnapshot): string | null {
  if (state.settings.projectFolder) return state.settings.projectFolder
  const tab = state.tabs.find((t) => t.id === state.activeTabId)
  return tab?.path ? folderOfPath(tab.path) : null
}

/** The folder a project configuration belongs to. */
export function projectFolder(): string | null {
  return folderFromState(useAppStore.getState())
}

/** Read the project configuration of a folder (null when there is none). */
export async function readProjectConfig(folder: string): Promise<ProjectConfig | null> {
  // The new name is preferred; the old one is kept for projects that have
  // not been migrated yet.
  for (const name of [PROJECT_CONFIG_NAME, LEGACY_PROJECT_CONFIG_NAME]) {
    try {
      const path = joinPath(folder, name)
      if (!(await window.api.fs.exists(path))) continue
      const text = await window.api.fs.readTextFile(path)
      return JSON.parse(text) as ProjectConfig
    } catch {
      /* try the next candidate */
    }
  }
  return null
}

/** Write the project configuration of a folder. */
export async function writeProjectConfig(folder: string, config: ProjectConfig): Promise<void> {
  const path = joinPath(folder, PROJECT_CONFIG_NAME)
  await window.api.fs.writeTextFile(path, `${JSON.stringify(config, null, 2)}\n`)
}

/** The toolchain of a language: the project file wins over the global settings. */
export function resolveTool(language: string, project: ProjectConfig | null, globals: Record<string, string>): string {
  const fromProject = project?.toolchain?.[language]
  if (fromProject) return fromProject
  return globals[language] ?? ''
}

/** The language server command of a language. */
export function resolveServer(
  language: string,
  project: ProjectConfig | null,
  globals: Record<string, { command: string; args?: string[] }>,
): { command: string; args?: string[] } | null {
  const fromProject = project?.lsp?.[language]
  if (fromProject?.command) return fromProject
  const global = globals[language]
  return global?.command ? global : null
}

/** The language servers of a project: the project file wins over the globals. */
export function resolveServers(
  project: ProjectConfig | null,
  globals: Record<string, { command: string; args?: string[] }>,
): Record<string, { command: string; args?: string[] }> {
  const out: Record<string, { command: string; args?: string[] }> = { ...globals }
  for (const [language, server] of Object.entries(project?.lsp ?? {})) {
    if (server?.command) out[language] = server
  }
  return out
}

/** The configuration that was loaded last (the run service uses it). */
let cache: { folder: string; config: ProjectConfig | null } | null = null

/** The project configuration that is known right now. */
export function cachedProjectConfig(): ProjectConfig | null {
  return cache?.config ?? null
}

/** Reactive accessor for the project configuration of the current folder. */
export function useProjectConfig(): Accessor<ProjectConfig | null> {
  const [config, setConfig] = createSignal<ProjectConfig | null>(cache?.config ?? null)

  createEffect(
    () => {
      const state = useAppStore()
      return {
        folder: folderFromState(state),
        activePath: state.tabs.find((t) => t.id === state.activeTabId)?.path ?? '',
      }
    },
    ({ folder }) => {
      let cancelled = false
      if (!folder) {
        setConfig(null)
        cache = null
        return
      }
      void readProjectConfig(folder).then((loaded) => {
        if (cancelled) return
        cache = { folder, config: loaded }
        setConfig(loaded)
      })
      return () => {
        cancelled = true
      }
    },
  )

  return config
}
