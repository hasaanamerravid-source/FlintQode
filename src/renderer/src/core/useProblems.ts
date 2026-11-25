import type { DiagnosticSettings } from '@shared/types'
import { createEffect, createMemo, createSignal, onSettled, type Accessor } from 'solid-js'
import { useAppStore } from '../store/app'
import { getView } from './views'
import { applyProblems, collectProblems, diagnosticsKey, type Problem } from './diagnostics'
import { asProblems, lspProblemsForPath } from './lspIntegration'
import { useLspStore } from './lspState'
import { useReferenceStore } from './lspCommands'
import { readProjectConfig, resolveServers, projectFolder } from './projectConfig'

/** The problems of the last check, so other parts (and the tests) can read them. */
let latestProblems: Problem[] = []

/**
 * The key of the last check. The problems are shown in three places (the
 * bottom panel, the sidebar and the status bar) and all of them ask for the
 * same check - it must only run once.
 */
let lastKey = ''

/** Everyone who wants to know the problems of the active file. */
const listeners = new Set<(problems: Problem[]) => void>()

/** Hand the problems to everyone who shows them. */
function publish(problems: Problem[]): void {
  latestProblems = problems
  for (const listener of listeners) {
    try {
      listener(problems)
    } catch {
      /* a listener must never break the check */
    }
  }
}

/** The problems that were detected last. */
export function currentProblems(): Problem[] {
  return latestProblems
}

interface CheckSource {
  activeTabId: string | null
  content: string
  language: string
  large: boolean
  path: string
  diagnostics: DiagnosticSettings | undefined
}

/**
 * Collects the problems of the active file and marks them in the editor.
 * The check runs a moment after the last change so typing stays smooth.
 *
 * The problems of the language servers are merged in: they are the ones that
 * know the types, the unused imports and the wrong calls.
 */
export function useProblems(): Accessor<Problem[]> {
  const [problems, setProblems] = createSignal<Problem[]>(latestProblems)

  onSettled(() => {
    const listener = (found: Problem[]): void => {
      setProblems(found)
    }
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  })

  createEffect(
    () => {
      const state = useAppStore()
      const tab = state.tabs.find((t) => t.id === state.activeTabId)
      return {
        activeTabId: state.activeTabId,
        content: tab?.content ?? '',
        language: tab?.language ?? 'text',
        large: tab?.largeFile ?? false,
        path: tab?.path ?? '',
        diagnostics: state.settings.diagnostics,
      } satisfies CheckSource
    },
    (source) => {
      let timer: number | undefined
      let generation = 0
      if (source.large) {
        publish([])
        return
      }
      const delay = useAppStore.getState().settings.powerSave ? 1200 : 350
      timer = window.setTimeout(() => {
        const run = ++generation
        // Content, not just length: two edits of the same size must both run.
        // The rule signature is part of the key so toggling a setting without
        // touching the document still produces a fresh check immediately.
        const key = `${source.activeTabId}:${source.language}:${diagnosticsKey(source.diagnostics, source.language)}:${source.content}`
        // Another place already checked the same document.
        if (key === lastKey) return
        lastKey = key
        const view = getView(source.activeTabId)
        if (!view) {
          if (run === generation) publish([])
          return
        }
        const found = collectProblems(view, source.language, source.diagnostics)
        // A newer debounce (or the tab changing) owns the result now.
        if (run !== generation) return
        publish(found)
        applyProblems(view, found)
      }, delay)
      return () => {
        generation++
        if (timer !== undefined) window.clearTimeout(timer)
      }
    },
  )

  // The problems of the language servers are shown next to the syntax errors.
  const lspProblems = createMemo(() => {
    const lsp = useLspStore()
    void lsp.problems
    const path = useAppStore().tabs.find((t) => t.id === useAppStore().activeTabId)?.path ?? ''
    return asProblems(lspProblemsForPath(path))
  })
  const referenceProblems = createMemo(() => useReferenceStore().problems)

  return createMemo(() => {
    const all = [...problems(), ...lspProblems()]
    const references = referenceProblems()
    return references.length ? [...all, ...references] : all
  })
}

/**
 * The language servers of the project: the plain text file of the project
 * wins over the global settings. The backend is told about them, so that it
 * starts the right program.
 *
 * The folder of the project is the one from the settings; when it is empty
 * the folder of the open file is used, so that a project with a
 * `.flintqode.json` works without any configuration.
 */
export function useLspConfiguration(): void {
  createEffect(
    () => {
      const state = useAppStore()
      return {
        configured: state.settings.projectFolder,
        globals: state.settings.lspServers,
        activePath: state.tabs.find((t) => t.id === state.activeTabId)?.path ?? '',
      }
    },
    ({ configured, globals, activePath }) => {
      let cancelled = false
      void (async () => {
        const folder = configured ?? projectFolder()
        const project = folder ? await readProjectConfig(folder) : null
        if (cancelled) return
        const servers = resolveServers(project, globals ?? {})
        try {
          await window.api.lsp?.configure?.({ servers, rootPath: folder ?? null })
        } catch {
          /* the language servers are optional */
        }
      })()
      return () => {
        cancelled = true
      }
    },
  )
}
