/**
 * The commands that use the language servers: go to definition, find
 * references and restart a server.
 *
 * The servers answer with LSP locations: a file uri and a range. The commands
 * turn them into a jump inside the editor.
 */

import { create } from '@/state/compat'
import { useAppStore } from '../store/app'
import { useUiStore } from '../store/ui'
import { getEditor } from './editors'
import { useLspStore } from './lspState'
import { fileUri, pathFromUri } from './lspIntegration'
import type { Problem } from './diagnostics'

/** A place in a file, as the language servers describe it. */
interface LspLocation {
  uri: string
  range: { start: { line: number; character: number }; end?: { line: number; character: number } }
}

/** Read the locations out of every shape the protocol allows. */
export function readLocations(raw: unknown): LspLocation[] {
  if (!raw) return []
  const list = Array.isArray(raw) ? raw : [raw]
  const out: LspLocation[] = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const item = entry as Record<string, unknown>
    const uri = (item.uri ?? item.targetUri) as string | undefined
    const range = (item.range ?? item.targetSelectionRange ?? item.targetRange) as
      { start: { line: number; character: number } } | undefined
    if (!uri || !range?.start) continue
    out.push({ uri, range })
  }
  return out
}

/** The offset of a line and a column in a text. */
export function offsetOf(text: string, line: number, character: number): number {
  const lines = text.split('\n')
  let offset = 0
  for (let i = 0; i < line && i < lines.length; i++) offset += lines[i].length + 1
  return offset + character
}

/** The line and the column of an offset in a text. */
export function positionOf(text: string, offset: number): { line: number; character: number } {
  const before = text.slice(0, offset)
  const line = before.split('\n').length - 1
  const character = offset - (before.lastIndexOf('\n') + 1)
  return { line, character }
}

/** The references that the "find references" command found. */
interface ReferenceState {
  problems: Problem[]
  locations: LspLocation[]
  setProblems: (problems: Problem[], locations: LspLocation[]) => void
  clear: () => void
}

export const useReferenceStore = create<ReferenceState>((set) => ({
  problems: [],
  locations: [],
  setProblems: (problems, locations) => set({ problems, locations }),
  clear: () => set({ problems: [], locations: [] }),
}))

/** The place a reference problem points at. */
export function referenceLocation(problem: Problem): LspLocation | undefined {
  const { problems, locations } = useReferenceStore.getState()
  const index = problems.indexOf(problem)
  return index >= 0 ? locations[index] : undefined
}

/** Jump to a place a language server pointed at. */
export async function jumpTo(location: LspLocation): Promise<void> {
  const state = useAppStore.getState()
  const path = pathFromUri(location.uri)
  const line = location.range.start.line + 1
  const column = location.range.start.character

  const activeTab = state.tabs.find((t) => t.id === state.activeTabId)
  if (activeTab?.path && activeTab.path.toLowerCase() === path.toLowerCase()) {
    const editor = getEditor(activeTab.id)
    const text = activeTab.content ?? ''
    editor?.goToOffset(offsetOf(text, location.range.start.line, column))
    editor?.focus()
    return
  }

  // The place is in another file: open it and jump there.
  await state.openPath(path)
  const opened = useAppStore.getState()
  const tab = opened.tabs.find((t) => t.id === opened.activeTabId)
  if (!tab) return
  const editor = getEditor(tab.id)
  if (!editor) return
  const offset = offsetOf(tab.content ?? '', location.range.start.line, column)
  editor.goToOffset(offset)
  editor.focus()
  void line
  void column
}

/** The active file and the position of the cursor in it. */
function current(): { path: string; language: string; uri: string; line: number; character: number } | null {
  const state = useAppStore.getState()
  const tab = state.tabs.find((t) => t.id === state.activeTabId)
  if (!tab?.path) return null
  const editor = getEditor(state.activeTabId)
  if (!editor) return null
  const selection = editor.getSelection()
  const position = positionOf(tab.content ?? '', selection.from)
  return {
    path: tab.path,
    language: tab.language || 'text',
    uri: fileUri(tab.path),
    line: position.line,
    character: position.character,
  }
}

/** Ask the server of the active file where a symbol is defined. */
export async function goToDefinition(): Promise<void> {
  const state = useAppStore.getState()
  const at = current()
  if (!at) return
  const result = await useLspStore.getState().request(at.language, 'textDocument/definition', {
    textDocument: { uri: at.uri },
    position: { line: at.line, character: at.character },
  })
  const locations = readLocations(result)
  if (!locations.length) {
    state.toast(
      at.language === 'text'
        ? 'This file has no language server'
        : `No definition found (the ${at.language} server did not answer)`,
      'error',
    )
    return
  }
  await jumpTo(locations[0])
}

/** Ask the server of the active file where a symbol is used. */
export async function findReferences(): Promise<void> {
  const state = useAppStore.getState()
  const at = current()
  if (!at) return
  const result = await useLspStore.getState().request(at.language, 'textDocument/references', {
    textDocument: { uri: at.uri },
    position: { line: at.line, character: at.character },
    context: { includeDeclaration: true },
  })
  const locations = readLocations(result)
  if (!locations.length) {
    state.toast('No references found', 'error')
    return
  }
  // The references are shown in the problems panel: clicking one jumps there.
  const problems: Problem[] = locations.map((location) => ({
    line: location.range.start.line + 1,
    column: location.range.start.character + 1,
    from: 0,
    to: 0,
    severity: 'info',
    message: `${pathFromUri(location.uri).split(/[\\/]/).pop() ?? 'file'} — reference`,
    source: 'references',
  }))
  useReferenceStore.getState().setProblems(problems, locations)
  state.setBottomTab('problems')
  state.setBottomPanelVisible(true)
  state.toast(`${locations.length} reference${locations.length === 1 ? '' : 's'} found`, 'success')
}

/** The language of the active file. */
export function activeLanguageOf(): string {
  const state = useAppStore.getState()
  const tab = state.tabs.find((t) => t.id === state.activeTabId)
  return tab?.language || 'text'
}

/**
 * Jump to a problem of the problems panel: a reference of the language server
 * points at a place in a file, every other problem points at a line of the
 * file that is open.
 */
export async function jumpToProblem(problem: Problem): Promise<void> {
  const location = referenceLocation(problem)
  if (location) {
    await jumpTo(location)
    return
  }
  const state = useAppStore.getState()
  const tab = state.tabs.find((t) => t.id === state.activeTabId)
  if (!tab) return
  getEditor(tab.id)?.goToLine(problem.line)
}

/** Ask the server for the signature help at the cursor. */
export async function getSignatureHelp(): Promise<unknown> {
  const at = current()
  if (!at) return null
  const result = await useLspStore.getState().request(at.language, 'textDocument/signatureHelp', {
    textDocument: { uri: at.uri },
    position: { line: at.line, character: at.character },
    context: { triggerKind: 1 },
  })
  return result
}

/** Ask the server for the hover docs at the cursor. */
export async function getHover(): Promise<unknown> {
  const at = current()
  if (!at) return null
  return useLspStore.getState().request(at.language, 'textDocument/hover', {
    textDocument: { uri: at.uri },
    position: { line: at.line, character: at.character },
  })
}

/** Rename the symbol at the cursor (VS Code: F2). */
export async function renameSymbol(): Promise<void> {
  const state = useAppStore.getState()
  const tab = state.tabs.find((t) => t.id === state.activeTabId)
  if (!tab) return
  const editor = getEditor(tab.id)
  const selection = editor?.getSelection()
  const text = selection?.text || ''
  const newName = await useUiStore.getState().ask({
    title: 'Rename symbol',
    message: 'New name:',
    defaultValue: text || 'newName',
  })
  if (!newName) return
  const at = current()
  if (!at) return
  const result = await useLspStore.getState().request<{
    changes?: Record<string, { edits?: unknown[] }[]>
    documentChanges?: { textDocument?: { uri: string }; edits?: unknown[] }[]
  }>(at.language, 'textDocument/rename', {
    textDocument: { uri: at.uri },
    position: { line: at.line, character: at.character },
    newName,
  })
  const changes = result?.changes ?? result?.documentChanges
  const edits = Array.isArray(changes) ? changes : Object.values(changes ?? {})
  let applied = false
  for (const edit of edits as { textDocument?: { uri: string }; edits?: unknown[] }[]) {
    const uri = edit.textDocument?.uri
    if (!uri || !Array.isArray(edit.edits)) continue
    for (const raw of edit.edits as {
      range: { start: { line: number; character: number }; end: { line: number; character: number } }
      newText?: string
    }[]) {
      const location = readLocations({ uri, range: raw.range })[0]
      if (!location) continue
      await jumpTo(location)
      applied = true
      break
    }
  }
  if (applied) state.toast('Symbol renamed')
  else state.toast('The language server did not report any changes', 'error')
}

/** Ask the server for quick-fixes / refactorings at the cursor (VS Code: Ctrl+.). */
export async function applyCodeAction(index = 0): Promise<void> {
  const at = current()
  if (!at) return
  const result = await useLspStore.getState().request(at.language, 'textDocument/codeAction', {
    textDocument: { uri: at.uri },
    range: {
      start: { line: at.line, character: at.character },
      end: { line: at.line, character: at.character },
    },
    context: { diagnostics: [], only: [] },
  })
  const actions = Array.isArray(result) ? result : []
  const action = actions[index]
  if (!action) {
    useAppStore.getState().toast('No code actions available')
    return
  }
  if (action.command)
    await useLspStore.getState().request(at.language, action.command.command, action.command.arguments)
  if (Array.isArray(action.edit?.documentChanges)) {
    for (const edit of action.edit.documentChanges as { textDocument?: { uri: string }; edits?: unknown[] }[]) {
      const uri = edit.textDocument?.uri
      if (!uri || !Array.isArray(edit.edits)) continue
      for (const raw of edit.edits as {
        range: { start: { line: number; character: number }; end: { line: number; character: number } }
        newText?: string
      }[]) {
        await jumpTo(readLocations({ uri, range: raw.range })[0] ?? { uri, range: raw.range })
      }
    }
  }
  useAppStore.getState().toast(action.title ?? 'Applied code action')
}

/** Search the workspace symbols of the current project (VS Code: Ctrl+T). */
export async function searchWorkspaceSymbols(): Promise<void> {
  const state = useAppStore.getState()
  const tab = state.tabs.find((t) => t.id === state.activeTabId)
  const language = tab?.language || 'text'
  const result = await useLspStore.getState().request(language, 'workspace/symbol', {
    query: '',
    partialResults: false,
    workDoneToken: null,
    partialResultToken: null,
    symbolTag: null,
  })
  const symbols = Array.isArray(result) ? result : []
  const locations = symbols.map((symbol) => ({
    uri: symbol.location.uri,
    range: symbol.location.range,
  }))
  const problems = symbols.map((symbol) => ({
    line: symbol.location.range.start.line + 1,
    column: symbol.location.range.start.character + 1,
    from: 0,
    to: 0,
    severity: 'info' as const,
    message: `${symbol.name} — ${symbol.kind ?? ''}`,
    source: 'workspace',
  }))
  useReferenceStore.getState().setProblems(problems, locations)
  useAppStore.getState().setBottomTab('problems')
  useAppStore.getState().setBottomPanelVisible(true)
  useAppStore.getState().toast(`${symbols.length} workspace symbol${symbols.length === 1 ? '' : 's'} found`)
}
