import type { DiagnosticSettings } from '@shared/types'
import type { EditorView } from '@codemirror/view'
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
export interface CheckMemo {
  /** True the first time a document (or rule set) is checked. */
  shouldRun: (source: CheckSource) => boolean
}

/** A fresh dedupe memo. The match uses document identity, not its text. */
export function createCheckMemo(): CheckMemo {
  let lastKey = ''
  let lastContent: string | null = null
  return {
    shouldRun(source) {
      const key = problemsCheckKey(source)
      if (key === lastKey && source.content === lastContent) return false
      lastKey = key
      lastContent = source.content
      return true
    },
  }
}

const checkMemo = createCheckMemo()

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
  /** Increments when the editor view of the tab is recreated. */
  viewGeneration?: number
}

const viewGenerations = new WeakMap<object, number>()
let nextViewGeneration = 1

/** A stable token per editor view, so a recreated view is always checked again. */
export function generationOfView(view: EditorView | undefined): number {
  if (!view) return 0
  let generation = viewGenerations.get(view)
  if (generation === undefined) {
    generation = nextViewGeneration++
    viewGenerations.set(view, generation)
  }
  return generation
}

/**
 * The stable part of the dedupe key. The document text is deliberately not
 * included (copying a megabyte of HTML into a string on every debounce was
 * measurable); it is compared by identity next to the key. The view generation
 * makes A -> B -> A with a recreated A view a fresh check.
 */
export function problemsCheckKey(
  source: Pick<CheckSource, 'activeTabId' | 'language' | 'diagnostics' | 'viewGeneration'>,
): string {
  return `${source.activeTabId}:${source.language}:${source.viewGeneration ?? 0}:${diagnosticsKey(
    source.diagnostics,
    source.language,
  )}`
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
        // Keep the document out of the key: copying a megabyte of HTML into a
        // string on every debounce was measurable. The rule signature is still
        // part of the key so toggling a setting checks the file again, and the
        // content string is compared by identity so two edits of the same size
        // both run.
        const view = getView(source.activeTabId)
        if (!view) {
          if (run === generation) publish([])
          return
        }
        if (!checkMemo.shouldRun({ ...source, viewGeneration: generationOfView(view) })) return
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
