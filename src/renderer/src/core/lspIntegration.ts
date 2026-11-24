/**
 * The glue between the editor and the language servers.
 *
 * The native backend runs the servers (`src-tauri/src/lsp.rs`); the renderer keeps
 * their state (`core/lspState.ts`). This module keeps both in sync with the
 * open files and turns the answers of a server into jumps inside the editor.
 */

import { createEffect, onSettled } from 'solid-js'
import type { EditorView } from '@codemirror/view'
import { useAppStore } from '../store/app'
import { getView } from './views'
import { useLspStore, type LspProblem } from './lspState'
import type { Problem } from './diagnostics'

/** Turn a path into a `file:` uri (the same shape the backend uses). */
export function fileUri(filePath: string): string {
  if (!filePath) return ''
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(filePath)) return filePath
  try {
    // A `#` or a `?` in a name would be read as a fragment or a query, so
    // they are encoded.
    const normalized = filePath.replace(/\\/g, '/').replace(/#/g, '%23').replace(/\?/g, '%3F')
    const rooted = normalized.startsWith('/') ? normalized : `/${normalized}`
    return new URL(`file://${rooted}`).href
  } catch {
    return filePath
  }
}

/** Turn a `file:` uri into a path. */
export function pathFromUri(uri: string): string {
  if (!uri) return ''
  if (!/^file:\/\//i.test(uri)) return uri
  try {
    const path = decodeURIComponent(new URL(uri).pathname).replace(/^\/([a-zA-Z]:)/, '$1')
    // Windows paths use backslashes, the uri always uses slashes. A drive
    // letter in the decoded path is the reliable signal (the renderer has no
    // access to a platform API in the Tauri webview).
    return /^\/[a-zA-Z]:/.test(path) ? path.replace(/\//g, '\\').replace(/^\\/, '') : path
  } catch {
    return uri
  }
}

/** The problems a language server published for a file. */
export function lspProblemsForPath(filePath: string): LspProblem[] {
  if (!filePath) return []
  const wanted = filePath.toLowerCase().replace(/\//g, '\\')
  const all = useLspStore.getState().problems
  const found: LspProblem[] = []
  for (const [uri, problems] of Object.entries(all)) {
    if (pathFromUri(uri).toLowerCase().replace(/\//g, '\\') === wanted) found.push(...problems)
  }
  return found
}

/** The problems of a language server as the problems of the editor. */
export function asProblems(list: LspProblem[]): Problem[] {
  return list.map((problem) => ({
    line: problem.line,
    column: problem.column,
    from: problem.from,
    to: problem.to,
    severity: problem.severity,
    message: problem.message,
    source: problem.source || 'lsp',
  }))
}

/**
 * Files bigger than this are not sent to a language server: the copy would
 * take seconds on every change.
 */
export const MAX_LSP_BYTES = 1_000_000

interface SyncSource {
  activeTabId: string | null
  path: string
  language: string
  content: string
  large: boolean
}

/**
 * Keeps the language servers in sync with the open files: a file that is
 * opened is sent to its server, a change is sent as a change and a file that is
 * closed is taken away from the server.
 */
export function useLspSync(): void {
  let previous: { uri: string; language: string } | null = null

  createEffect(
    () => {
      const state = useAppStore()
      const tab = state.tabs.find((t) => t.id === state.activeTabId)
      return {
        activeTabId: state.activeTabId,
        path: tab?.path ?? '',
        language: tab?.language ?? 'text',
        content: tab?.content ?? '',
        large: tab?.largeFile ?? false,
      } satisfies SyncSource
    },
    (source) => {
      let timer: number | undefined
      if (!source.path) return

      const uri = fileUri(source.path)
      // The file that was open before is taken away from its server.
      if (previous && previous.uri !== uri) {
        void useLspStore.getState().close(previous.language, previous.uri)
      }
      // A huge file is not sent to a server: the copy would freeze the editor.
      if (source.large || source.content.length > MAX_LSP_BYTES) {
        previous = { uri, language: source.language }
        return
      }

      void useLspStore.getState().open(source.language, uri, source.content)
      previous = { uri, language: source.language }
      // The change is sent a moment after the last keystroke: the servers are
      // much slower than the user types. Power save waits longer so a burst of
      // edits causes fewer server round trips.
      const delay = useAppStore.getState().settings.powerSave ? 2000 : 600
      timer = window.setTimeout(() => {
        void useLspStore.getState().change(source.language, uri, source.content)
      }, delay)

      return () => {
        if (timer !== undefined) window.clearTimeout(timer)
      }
    },
  )

  onSettled(() => () => {
    if (previous) void useLspStore.getState().close(previous.language, previous.uri)
    previous = null
  })
}

/** The position of the cursor in the active editor (LSP uses 0 based lines). */
export function cursorPosition(view: EditorView | undefined): { line: number; character: number } | null {
  if (!view) return null
  const head = view.state.selection.main.head
  const line = view.state.doc.lineAt(head)
  return { line: line.number - 1, character: head - line.from }
}

/** The editor of the active tab. */
export function activeView(): EditorView | undefined {
  const state = useAppStore.getState()
  return getView(state.activeTabId)
}

/** The language of the active tab. */
export function activeLanguage(): string {
  const state = useAppStore.getState()
  const tab = state.tabs.find((t) => t.id === state.activeTabId)
  return tab?.language || 'text'
}

/** The path of the active tab. */
export function activePath(): string {
  const state = useAppStore.getState()
  const tab = state.tabs.find((t) => t.id === state.activeTabId)
  return tab?.path ?? ''
}
