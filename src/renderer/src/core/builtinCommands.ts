import type { Command } from '@shared/types'
import { useAppStore } from '../store/app'
import { useUiStore } from '../store/ui'
import { getEditor } from './editors'
import { getView } from './views'
import { registerCommands, runCommand } from './commands'
import { setHighlightAll } from './highlightAll'
import { jumpToBookmark, toggleBookmarkAt } from './bookmarks'
import {
  base64Decode,
  base64Encode,
  changeCase,
  convertCase,
  escapeHtml,
  formatJson,
  formatXml,
  joinLines,
  makeUuid,
  minifyJson,
  removeDuplicateLines,
  reverseLines,
  shuffleLines,
  sortLines,
  sortLinesByLength,
  sortLinesCaseInsensitive,
  transposeChars,
  trimLeadingWhitespace,
  trimTrailingWhitespace,
  unescapeHtml,
  urlDecode,
  urlEncode,
} from './transforms'
import { loadMacros, playMacro, saveMacros, startRecording, type MacroEvent } from './macros'
import { languageLabel } from './languages'
import {
  applyCodeAction,
  findReferences,
  getHover,
  getSignatureHelp,
  goToDefinition,
  renameSymbol,
  searchWorkspaceSymbols,
} from './lspCommands'
import { FILE_FILTERS } from './defaults'
import { cursorMatchingBracket } from '@codemirror/commands'
import { EditorSelection } from '@codemirror/state'

const store = (): ReturnType<typeof useAppStore.getState> => useAppStore.getState()

function activeTab(): ReturnType<typeof store>['tabs'][number] | undefined {
  const s = store()
  return s.tabs.find((t) => t.id === s.activeTabId)
}

function activeView(): ReturnType<typeof getView> {
  return getView(store().activeTabId)
}

/** Apply a text transform to the selection, or to the whole document. */
function applyTransform(fn: (text: string) => string): void {
  const view = activeView()
  if (view) {
    const range = view.state.selection.main
    const selected = view.state.sliceDoc(range.from, range.to)
    const hasSelection = selected.length > 0
    const target = hasSelection ? selected : view.state.doc.toString()
    const result = fn(target)
    if (result === target) return
    view.dispatch({
      changes: hasSelection
        ? { from: range.from, to: range.to, insert: result }
        : { from: 0, to: view.state.doc.length, insert: result },
    })
    return
  }
  const editor = getEditor(store().activeTabId)
  if (!editor) return
  const selection = editor.getSelection()
  const hasSelection = selection.text.length > 0
  const target = hasSelection ? selection.text : editor.getContent()
  const result = fn(target)
  if (result === target) return
  if (hasSelection) editor.replaceSelection(result)
  else editor.setContent(result)
}

const closedTabs: { path: string | null; name: string; content: string; language: string }[] = []

/** The active file's path, or null. */
function activeFilePath(): string | null {
  return activeTab()?.path ?? null
}

/** Show the git status of the current file (branch + changed files). */
async function showGitStatus(): Promise<void> {
  const state = store()
  const path = activeFilePath()
  if (!path) {
    state.toast('There is no git repository for the current file', 'error')
    return
  }
  try {
    const result = await window.api.git.status(path)
    if (!result.status) {
      state.toast('Not a git repository (or git is not installed)', 'error')
      return
    }
    state.setBottomTab('problems')
    state.setBottomPanelVisible(true)
    const lines: string[] = [`Branch: ${result.status.branch || '(detached)'}`]
    lines.push(`Changed files: ${result.status.files.length}`)
    for (const file of result.status.files.slice(0, 50)) {
      const arrow = ` +${file.additions} -${file.deletions}`
      lines.push(`${file.status} ${file.path}${arrow}`)
    }
    state.toast(lines.join('\n'), 'info')
  } catch (error) {
    state.toast(`Could not run git: ${String(error)}`, 'error')
  }
}

/** Show the git diff of the current file in the problems panel. */
async function showGitDiff(): Promise<void> {
  const state = store()
  const path = activeFilePath()
  if (!path) {
    state.toast('There is no git repository for the current file', 'error')
    return
  }
  try {
    const diff = await window.api.git.diff(path)
    if (!diff || !diff.trim()) {
      state.toast('No changes relative to git', 'info')
      return
    }
    state.toast(diff, 'info')
  } catch (error) {
    state.toast(`Could not run git: ${String(error)}`, 'error')
  }
}

/** Stage the current file with `git add`. */
async function stageGitFile(): Promise<void> {
  const state = store()
  const path = activeFilePath()
  if (!path) {
    state.toast('There is no git repository for the current file', 'error')
    return
  }
  try {
    await window.api.git.stage(path)
    state.toast('File staged')
  } catch (error) {
    state.toast(`Could not stage: ${String(error)}`, 'error')
  }
}

/** Commit changes with a message (VS Code style). */
async function commitGitChanges(): Promise<void> {
  const state = store()
  const path = activeFilePath()
  if (!path) {
    state.toast('There is no git repository for the current file', 'error')
    return
  }
  const message = await useUiStore.getState().ask({
    title: 'Commit changes',
    message: 'Commit message',
    defaultValue: 'Save changes',
  })
  if (!message) return
  try {
    await window.api.git.commit(path, message)
    state.toast(`Committed: ${message}`)
  } catch (error) {
    state.toast(`Commit failed: ${String(error)}`, 'error')
  }
}

/** Export the active file as a standalone HTML document. */
async function exportActiveAsHtml(): Promise<void> {
  const state = store()
  const tab = state.tabs.find((t) => t.id === state.activeTabId)
  const editor = getEditor(state.activeTabId)
  const content = editor?.getContent() ?? tab?.content ?? ''
  if (!content.trim()) return
  // Convert Markdown to HTML for markdown files; leave code as-is.
  let body = content
  if (tab?.mode === 'markdown') {
    const { marked } = await import('marked')
    body = marked.parse(content, { gfm: true, breaks: false }) as string
  }
  const safe = body.replace(/<script[\s\S]*?<\/script>/g, '')
  const name = tab?.name ?? 'Untitled'
  const doc = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${name}</title><style>body{font-family:var(--font-mono);margin:2rem;max-width:48rem}pre{background:#0f172a;color:#e2e8f0;padding:1rem;border-radius:8px;overflow:auto}</style></head><body>${safe}</body></html>`
  try {
    const file = await window.api.fs.saveDialog({
      title: 'Export as HTML',
      defaultPath: `${name.replace(/\.[a-z0-9]+$/i, '')}.html`,
      filters: [{ name: 'HTML', extensions: ['html'] }],
    })
    if (file.canceled || !file.filePath) return
    await window.api.fs.writeTextFile(file.filePath, doc)
    state.toast(`Exported ${name} as HTML`)
  } catch (error) {
    state.toast(`Export failed: ${String(error)}`, 'error')
  }
}

let recorder: { stop: () => MacroEvent[]; record: (e: MacroEvent) => void; isRecording: () => boolean } | null = null

/** Toggle a boolean setting and remember it for the next session. */
function toggleSetting(
  key:
    | 'showStatusBar'
    | 'lineWrapping'
    | 'showLineNumbers'
    | 'showMinimap'
    | 'showIndentGuides'
    | 'showInvisibles'
    | 'showSidebar',
): void {
  const settings = store().settings
  const next = !settings[key]
  store().setSettings({ [key]: next } as Partial<typeof settings>)
  void store().saveSettings()
}

/** Apply a setting and remember it for the next session. */
function setSetting(key: keyof ReturnType<typeof store>['settings'], value: unknown): void {
  store().setSettings({ [key]: value } as never)
  void store().saveSettings()
}

export const builtinCommands: Command[] = [
  /* ------------------------------- File ------------------------------ */
  {
    id: 'file.new',
    title: 'New file',
    category: 'File',
    shortcut: 'Ctrl+N',
    run: () => {
      store().newTab()
    },
  },
  {
    id: 'file.newWindow',
    title: 'New window',
    category: 'File',
    run: () => {
      void window.api.win.newWindow()
    },
  },
  {
    id: 'file.open',
    title: 'Open file…',
    category: 'File',
    shortcut: 'Ctrl+O',
    run: async () => {
      const result = await window.api.fs.openDialog({ title: 'Open file', filters: FILE_FILTERS })
      if (result.canceled) return
      await store().openPaths(result.filePaths)
    },
  },
  {
    id: 'file.openFromClipboard',
    title: 'Open path from clipboard',
    category: 'File',
    run: async () => {
      const text = await window.api.clipboard.readText()
      const path = text.trim().replace(/^"|"$/g, '')
      if (path) await store().openPath(path)
    },
  },
  {
    id: 'file.openPath',
    title: 'Open path',
    category: 'File',
    hidden: true,
    run: async (payload?: unknown) => {
      const path = String(payload ?? '')
      if (path) await store().openPath(path)
    },
  },
  {
    id: 'file.openRecent',
    title: 'Open recent file',
    category: 'File',
    hidden: true,
    run: async (payload?: unknown) => {
      const path = String(payload ?? '')
      if (path) await store().openPath(path)
    },
  },
  {
    id: 'file.save',
    title: 'Save',
    category: 'File',
    shortcut: 'Ctrl+S',
    run: async () => {
      const id = store().activeTabId
      if (id) await store().saveTab(id)
    },
  },
  {
    id: 'file.saveAs',
    title: 'Save as…',
    category: 'File',
    shortcut: 'Ctrl+Shift+S',
    run: async () => {
      const id = store().activeTabId
      if (id) await store().saveTab(id, true)
    },
  },
  {
    id: 'file.saveAll',
    title: 'Save all',
    category: 'File',
    run: async () => {
      await store().saveAll()
    },
  },
  {
    id: 'file.close',
    title: 'Close tab',
    category: 'File',
    shortcut: 'Ctrl+W',
    run: async () => {
      const tab = activeTab()
      const id = store().activeTabId
      if (!id) return
      if (tab) {
        const editor = getEditor(id)
        closedTabs.push({
          path: tab.path,
          name: tab.name,
          content: editor ? editor.getContent() : tab.content,
          language: tab.language,
        })
      }
      await store().closeTab(id)
    },
  },
  {
    id: 'file.closeAll',
    title: 'Close all tabs',
    category: 'File',
    run: async () => {
      await store().closeAll()
    },
  },
  {
    id: 'file.reopenClosed',
    title: 'Reopen closed tab',
    category: 'File',
    shortcut: 'Ctrl+Shift+T',
    run: () => {
      const last = closedTabs.pop()
      if (!last) return
      const id = store().newTab({ path: last.path, name: last.name, content: last.content, language: last.language })
      void id
    },
  },

  /* ------------------------------- Edit ------------------------------ */
  {
    id: 'edit.undo',
    title: 'Undo',
    category: 'Edit',
    shortcut: 'Ctrl+Z',
    run: () => {
      const editor = getEditor(store().activeTabId)
      editor?.undo()
    },
  },
  {
    id: 'edit.redo',
    title: 'Redo',
    category: 'Edit',
    shortcut: 'Ctrl+Y',
    run: () => {
      const editor = getEditor(store().activeTabId)
      editor?.redo()
    },
  },
  {
    id: 'edit.delete',
    title: 'Delete selection',
    category: 'Edit',
    run: () => {
      const editor = getEditor(store().activeTabId)
      editor?.replaceSelection('')
    },
  },
  {
    id: 'edit.selectAll',
    title: 'Select all',
    category: 'Edit',
    shortcut: 'Ctrl+A',
    run: () => {
      const view = activeView()
      if (view) {
        view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } })
        view.focus()
        return
      }
      const editor = getEditor(store().activeTabId)
      if (!editor) return
      if (editor.selectAll) {
        editor.selectAll()
        return
      }
      // Rich text: fall back to the native selection of the editable area.
      document.execCommand('selectAll')
    },
  },
  {
    id: 'edit.gotoLine',
    title: 'Go to line / column',
    category: 'Edit',
    shortcut: 'Ctrl+G',
    run: async () => {
      const answer = await useUiStore.getState().ask({
        title: 'Go to line',
        message: 'Line number (optionally line:column):',
        defaultValue: '',
      })
      if (answer === null || !answer) return
      const view = activeView()
      if (!view) return
      const match = answer.match(/^(\d+)(?::(\d+))?$/)
      if (!match) return
      const line = Number(match[1])
      const column = match[2] ? Number(match[2]) : 1
      if (line < 1 || line > view.state.doc.lines) return
      const docLine = view.state.doc.lineAt(line)
      const target = Math.min(Math.max(column - 1, 0), docLine.text.length)
      const offset = docLine.from + target
      view.dispatch({ selection: { anchor: offset, head: offset } })
      view.focus()
    },
  },
  {
    id: 'editor.goToDefinition',
    title: 'Go to definition',
    category: 'Editor',
    shortcut: 'F12',
    run: async () => {
      await goToDefinition()
    },
  },
  {
    id: 'editor.findReferences',
    title: 'Find references',
    category: 'Editor',
    shortcut: 'Shift+F12',
    run: async () => {
      await findReferences()
    },
  },
  {
    id: 'editor.renameSymbol',
    title: 'Rename symbol',
    category: 'Editor',
    shortcut: 'F2',
    run: async () => {
      await renameSymbol()
    },
  },
  {
    id: 'editor.signatureHelp',
    title: 'Show signature help',
    category: 'Editor',
    run: () => {
      void import('./signatureHelp').then(({ showSignatureHelp }) => showSignatureHelp())
    },
  },
  {
    id: 'editor.hoverDocs',
    title: 'Show hover documentation',
    category: 'Editor',
    run: () => {
      void import('./hoverDocs').then(({ showHoverDocs }) => showHoverDocs())
    },
  },
  {
    id: 'editor.codeAction',
    title: 'Apply code action (quick fix / refactor)',
    category: 'Editor',
    run: async () => {
      await applyCodeAction(0)
    },
  },
  {
    id: 'editor.workspaceSymbols',
    title: 'Search workspace symbols',
    category: 'Editor',
    shortcut: 'Ctrl+T',
    run: async () => {
      const result = await import('./lspCommands')
      await result.searchWorkspaceSymbols()
    },
  },
  {
    id: 'file.exportHtml',
    title: 'Export to HTML',
    category: 'File',
    run: () => {
      void exportActiveAsHtml()
    },
  },
  {
    id: 'edit.duplicateLine',
    title: 'Duplicate line',
    category: 'Edit',
    shortcut: 'Ctrl+D',
    run: () => {
      const view = activeView()
      if (!view) return
      const range = view.state.selection.main
      const start = view.state.doc.lineAt(range.from)
      const end = view.state.doc.lineAt(range.to)
      const text = view.state.doc.sliceString(start.from, end.to)
      view.dispatch({ changes: { from: end.to, insert: `\n${text}` } })
    },
  },
  {
    id: 'edit.deleteLine',
    title: 'Delete line',
    category: 'Edit',
    shortcut: 'Ctrl+Shift+K',
    run: () => {
      const view = activeView()
      if (!view) return
      const range = view.state.selection.main
      const start = view.state.doc.lineAt(range.from)
      const end = view.state.doc.lineAt(range.to)
      const to = end.to < view.state.doc.length ? end.to + 1 : end.to
      view.dispatch({ changes: { from: start.from, to } })
    },
  },
  {
    id: 'edit.moveLineUp',
    title: 'Move line up',
    category: 'Edit',
    shortcut: 'Alt+Shift+Up',
    run: () => {
      const view = activeView()
      if (!view) return
      const range = view.state.selection.main
      const line = view.state.doc.lineAt(range.from)
      if (line.number === 1) return
      const above = view.state.doc.lineAt(line.from - 1)
      const text = view.state.doc.sliceString(line.from, line.to)
      view.dispatch({
        changes: { from: above.from, to: line.to, insert: `${text}\n${above.text}` },
        selection: { anchor: range.from + 1 },
      })
    },
  },
  {
    id: 'edit.moveLineDown',
    title: 'Move line down',
    category: 'Edit',
    shortcut: 'Alt+Shift+Down',
    run: () => {
      const view = activeView()
      if (!view) return
      const range = view.state.selection.main
      const line = view.state.doc.lineAt(range.from)
      if (line.number === view.state.doc.lines) return
      const below = view.state.doc.lineAt(line.to + 1)
      const text = view.state.doc.sliceString(line.from, line.to)
      view.dispatch({
        changes: { from: line.from, to: below.to, insert: `${below.text}\n${text}` },
        selection: { anchor: range.from + 1 },
      })
    },
  },
  {
    id: 'editor.toggleColumnSelection',
    title: 'Toggle column / block selection mode',
    category: 'Edit',
    shortcut: 'Alt+Shift+Insert',
    run: () => {
      const view = activeView()
      if (!view) return
      const ranges = view.state.selection.ranges
      // If there is already more than one cursor, convert them into a column
      // block spanning their shared span; otherwise split the current line(s).
      const main = ranges[0]
      let top = view.state.doc.lineAt(main.from)
      let bottom = view.state.doc.lineAt(main.to)
      if (main.from === main.to) {
        const row = view.state.doc.lineAt(main.from).number
        const last = view.state.doc.lines
        top = view.state.doc.lineAt(row)
        bottom = view.state.doc.lineAt(Math.min(row, last))
      }
      const fromLine = Math.min(top.number, bottom.number)
      const toLine = Math.max(top.number, bottom.number)
      const columnCount = view.state.selection.ranges.length || 1
      const selections: { from: number; to: number }[] = []
      for (let row = fromLine; row <= toLine; row += 1) {
        const line = view.state.doc.lineAt(row)
        for (let col = 0; col < columnCount; col += 1) {
          const pos = Math.min(line.from + col, line.to)
          selections.push({ from: pos, to: pos })
        }
      }
      view.dispatch({
        selection: EditorSelection.create(
          selections.map((r) => EditorSelection.range(r.from, r.to)),
          selections.length - 1,
        ),
      })
      view.focus()
    },
  },
  {
    id: 'edit.transposeChars',
    title: 'Transpose characters',
    category: 'Edit',
    shortcut: 'Ctrl+T',
    run: () => {
      const view = activeView()
      if (!view) return
      const range = view.state.selection.main
      const lineText = view.state.doc.lineAt(range.from).text
      const column = Math.max(0, range.from - view.state.doc.lineAt(range.from).from)
      const result = transposeChars(lineText, column)
      view.dispatch({
        changes: {
          from: view.state.doc.lineAt(range.from).from,
          to: view.state.doc.lineAt(range.from).to,
          insert: result.text,
        },
        selection: { anchor: result.column, head: result.column },
      })
      view.focus()
    },
  },
  {
    id: 'edit.copyLine',
    title: 'Copy line',
    category: 'Edit',
    shortcut: 'Ctrl+Shift+C',
    run: () => {
      const view = activeView()
      if (!view) return
      const range = view.state.selection.main
      const start = view.state.doc.lineAt(range.from)
      const end = view.state.doc.lineAt(range.to)
      const text = view.state.doc.sliceString(start.from, end.to)
      void window.api.clipboard.writeText(text)
    },
  },
  {
    id: 'edit.insertText',
    title: 'Insert text',
    category: 'Edit',
    hidden: true,
    run: (payload?: unknown) => {
      const text = String(payload ?? '')
      if (!text) return
      getEditor(store().activeTabId)?.insertText(text)
    },
  },
  {
    id: 'edit.insertDateTime',
    title: 'Insert date/time',
    category: 'Edit',
    shortcut: 'Ctrl+Alt+D',
    run: () => {
      const now = new Date()
      const stamp = now.toLocaleString()
      const editor = getEditor(store().activeTabId)
      editor?.insertText(stamp)
    },
  },
  {
    id: 'edit.selectAllOccurrences',
    title: 'Select all occurrences',
    category: 'Edit',
    shortcut: 'Ctrl+Shift+L',
    run: () => {
      const view = activeView()
      if (!view) return
      const { state } = view
      const main = state.selection.main
      const text = state.sliceDoc(main.from, main.to)
      if (!text.length) return
      // Find every occurrence of the selected text and put a cursor on each.
      const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(escaped, 'g')
      const doc = state.doc.toString()
      const ranges: number[] = []
      let match: RegExpExecArray | null
      while ((match = re.exec(doc))) ranges.push(match.index)
      if (ranges.length <= 1) return
      const selection = EditorSelection.create(
        ranges.map((from) => EditorSelection.cursor(from, from + text.length)),
        0,
      )
      view.dispatch({ selection })
      view.focus()
    },
  },

  /* ------------------------------ Search ----------------------------- */
  {
    id: 'search.find',
    title: 'Find…',
    category: 'Search',
    shortcut: 'Ctrl+F',
    run: () => {
      getEditor(store().activeTabId)?.focusSearch()
    },
  },
  {
    id: 'search.replace',
    title: 'Replace…',
    category: 'Search',
    shortcut: 'Ctrl+H',
    run: () => {
      getEditor(store().activeTabId)?.openSearchPanel(true)
    },
  },
  {
    id: 'search.findNext',
    title: 'Find next',
    category: 'Search',
    shortcut: 'F3',
    run: () => {
      getEditor(store().activeTabId)?.findNext()
    },
  },
  {
    id: 'search.findPrevious',
    title: 'Find previous',
    category: 'Search',
    shortcut: 'Shift+F3',
    run: () => {
      getEditor(store().activeTabId)?.findPrevious()
    },
  },
  {
    id: 'search.findInFiles',
    title: 'Find in files',
    category: 'Search',
    shortcut: 'Ctrl+Shift+F',
    run: () => {
      store().setSidePanel('search')
    },
  },
  {
    id: 'search.matchBracket',
    title: 'Go to matching bracket',
    category: 'Search',
    shortcut: 'Ctrl+B',
    run: () => {
      const view = activeView()
      if (!view) return
      cursorMatchingBracket(view)
    },
  },
  {
    id: 'search.markAll',
    title: 'Mark all occurrences',
    category: 'Search',
    run: async () => {
      const view = activeView()
      if (!view) return
      const selection = view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)
      const term =
        selection || (await useUiStore.getState().ask({ title: 'Mark all occurrences', message: 'Search for' })) || ''
      if (!term) return
      view.dispatch({ effects: setHighlightAll.of(term) })
    },
  },

  /* ----------------------------- Bookmarks --------------------------- */
  {
    id: 'edit.toggleBookmark',
    title: 'Toggle bookmark',
    category: 'Edit',
    shortcut: 'Ctrl+F2',
    run: () => {
      const view = activeView()
      if (!view) return
      toggleBookmarkAt(view)
    },
  },
  {
    id: 'edit.nextBookmark',
    title: 'Next bookmark',
    category: 'Edit',
    shortcut: 'F2',
    run: () => {
      const view = activeView()
      if (!view) return
      jumpToBookmark(view, 1)
    },
  },
  {
    id: 'edit.prevBookmark',
    title: 'Previous bookmark',
    category: 'Edit',
    shortcut: 'Shift+F2',
    run: () => {
      const view = activeView()
      if (!view) return
      jumpToBookmark(view, -1)
    },
  },

  /* ------------------------------- View ------------------------------ */
  {
    id: 'view.toggleSidebar',
    title: 'Toggle sidebar',
    category: 'View',
    shortcut: 'Ctrl+Shift+E',
    run: () => {
      store().toggleSidebar()
    },
  },
  {
    id: 'view.toggleStatusBar',
    title: 'Toggle status bar',
    category: 'View',
    run: () => {
      const visible = !store().statusBarVisible
      store().setSettings({ showStatusBar: visible })
      void store().saveSettings()
      useAppStore.setState({ statusBarVisible: visible })
    },
  },
  {
    id: 'view.fullscreen',
    title: 'Toggle full screen',
    category: 'View',
    shortcut: 'F11',
    run: () => {
      if (document.fullscreenElement) void document.exitFullscreen()
      else void document.documentElement.requestFullscreen()
    },
  },
  {
    id: 'view.zoomIn',
    title: 'Zoom in',
    category: 'View',
    shortcut: 'Ctrl++',
    run: () => {
      window.api.win.zoom(0.1)
    },
  },
  {
    id: 'view.zoomOut',
    title: 'Zoom out',
    category: 'View',
    shortcut: 'Ctrl+-',
    run: () => {
      window.api.win.zoom(-0.1)
    },
  },
  {
    id: 'view.zoomReset',
    title: 'Reset zoom',
    category: 'View',
    shortcut: 'Ctrl+0',
    run: () => {
      void window.api.win.setZoom(1)
    },
  },
  {
    id: 'view.toggleOverwrite',
    title: 'Toggle overwrite mode',
    category: 'View',
    run: () => {
      const overwrite = store().settings.overwriteMode
      store().setSettings({ overwriteMode: !overwrite })
      store().toast(overwrite ? 'Insert mode on (new text inserts)' : 'Overwrite mode on (new text replaces)', 'info')
    },
  },
  {
    id: 'view.toggleScrollPastEnd',
    title: 'Toggle scroll past end of file',
    category: 'View',
    run: () => store().setSettings({ scrollPastEnd: !store().settings.scrollPastEnd }),
  },
  {
    id: 'view.toggleDirection',
    title: 'Toggle right-to-left text direction',
    category: 'View',
    run: () => {
      const direction = store().settings.direction
      const next = direction === 'ltr' ? 'rtl' : 'ltr'
      store().setSettings({ direction: next })
      store().toast(next === 'rtl' ? 'Right-to-left mode on' : 'Left-to-right mode on', 'info')
    },
  },
  {
    id: 'file.openFolder',
    title: 'Open folder as workspace',
    category: 'File',
    run: async () => {
      const result = await window.api.fs.openDialog({ title: 'Open a folder as the workspace', directory: true })
      const folder = result.filePaths[0]
      if (folder) {
        const roots = useAppStore.getState().workspaceRoots.filter((r) => r !== folder)
        useAppStore.getState().setWorkspaceRoots([...roots, folder])
        useAppStore.getState().toast(`Opened ${folder.split(/[\\/]/).pop()} as a workspace`, 'success')
      }
    },
  },
  {
    id: 'file.closeFolder',
    title: 'Close workspace folder',
    category: 'File',
    run: () => {
      const roots = useAppStore.getState().workspaceRoots
      const root = useAppStore.getState().workspaceRoot
      if (roots.length > 1 && root) useAppStore.getState().setWorkspaceRoots(roots.filter((r) => r !== root))
    },
  },
  {
    id: 'view.toggleGitGutter',
    title: 'Toggle git diff markers in the gutter',
    category: 'View',
    run: () => {
      store().setSettings({ gitGutter: !store().settings.gitGutter })
      store().toast(store().settings.gitGutter ? 'Git gutter on' : 'Git gutter off', 'info')
    },
  },
  {
    id: 'tools.gitShowStatus',
    title: 'Show git status of the current file',
    category: 'Tools',
    run: () => void showGitStatus(),
  },
  {
    id: 'tools.gitShowDiff',
    title: 'Show git diff of the current file',
    category: 'Tools',
    run: () => void showGitDiff(),
  },
  {
    id: 'tools.gitStage',
    title: 'Stage the current file',
    category: 'Tools',
    run: () => void stageGitFile(),
  },
  {
    id: 'tools.gitCommit',
    title: 'Commit changes (with message)',
    category: 'Tools',
    run: () => void commitGitChanges(),
  },
  {
    id: 'view.toggleWordWrap',
    title: 'Toggle word wrap',
    category: 'View',
    run: () => {
      toggleSetting('lineWrapping')
    },
  },
  {
    id: 'view.toggleLineNumbers',
    title: 'Toggle line numbers',
    category: 'View',
    run: () => {
      toggleSetting('showLineNumbers')
    },
  },
  {
    id: 'view.toggleMinimap',
    title: 'Toggle minimap',
    category: 'View',
    run: () => {
      toggleSetting('showMinimap')
    },
  },
  {
    id: 'view.toggleIndentGuides',
    title: 'Toggle indent guides',
    category: 'View',
    run: () => {
      toggleSetting('showIndentGuides')
    },
  },
  {
    id: 'view.toggleInvisibles',
    title: 'Toggle invisibles',
    category: 'View',
    run: () => {
      toggleSetting('showInvisibles')
    },
  },
  {
    id: 'view.toggleTheme',
    title: 'Toggle dark / light theme',
    category: 'View',
    run: () => {
      const next = store().settings.theme === 'dark' ? 'light' : 'dark'
      store().setSettings({ theme: next })
      void store().saveSettings()
    },
  },
  {
    id: 'view.distractionFree',
    title: 'Distraction free mode',
    category: 'View',
    // Ctrl+Shift+F belongs to the search in files.
    shortcut: 'Ctrl+Alt+F',
    run: () => {
      store().setDistractionFree(!store().distractionFree)
    },
  },
  {
    id: 'view.toggleSplit',
    title: 'Toggle split view',
    category: 'View',
    shortcut: 'Ctrl+Alt+S',
    run: () => {
      store().setSplitView(!store().splitView)
    },
  },
  {
    id: 'view.commandPalette',
    title: 'Command palette…',
    category: 'View',
    shortcut: 'Ctrl+Shift+P',
    run: () => {
      store().setPaletteMode('commands')
    },
  },
  {
    id: 'view.quickSwitcher',
    title: 'Quick switcher (files & notes)',
    category: 'View',
    shortcut: 'Ctrl+Shift+O',
    run: () => {
      store().setPaletteMode('files')
    },
  },

  /* ------------------------------ Format ----------------------------- */
  {
    id: 'format.setLanguage',
    title: 'Set language',
    category: 'Format',
    hidden: true,
    run: (payload?: unknown) => {
      const id = String(payload ?? '')
      const tab = activeTab()
      if (!tab || !id) return
      store().updateTab(tab.id, { language: id })
      store().toast(`Language: ${languageLabel(id)}`)
    },
  },
  {
    id: 'format.setEncoding',
    title: 'Set encoding',
    category: 'Format',
    hidden: true,
    run: (payload?: unknown) => {
      const id = String(payload ?? '')
      const tab = activeTab()
      if (!tab || !id) return
      store().updateTab(tab.id, { encoding: id })
      store().toast(`Encoding: ${id}`)
    },
  },
  {
    id: 'format.encode',
    title: 'Encode with…',
    category: 'Format',
    hidden: true,
    run: (payload?: unknown) => {
      const id = String(payload ?? '')
      const tab = activeTab()
      if (!tab || !id) return
      store().updateTab(tab.id, { encoding: id })
      store().toast(`Save will use ${id}`)
    },
  },
  {
    id: 'format.convertTo',
    title: 'Convert file encoding to…',
    category: 'Format',
    hidden: true,
    run: async (payload?: unknown) => {
      const id = String(payload ?? '')
      const tab = activeTab()
      if (!tab?.path || !id) return
      const payloadFile = await window.api.fs.readFile(tab.path)
      await window.api.fs.writeFile(tab.path, payloadFile.content, id, tab.eol)
      store().updateTab(tab.id, { encoding: id })
      store().toast(`Converted to ${id}`, 'success')
    },
  },
  {
    id: 'format.eol',
    title: 'Convert line endings to…',
    category: 'Format',
    hidden: true,
    run: (payload?: unknown) => {
      const eol = String(payload ?? '\n') as '\n' | '\r\n' | '\r'
      const tab = activeTab()
      if (!tab) return
      store().updateTab(tab.id, { eol })
      store().toast(`Line endings: ${eol === '\n' ? 'LF' : eol === '\r\n' ? 'CRLF' : 'CR'}`)
    },
  },
  {
    id: 'format.sortAsc',
    title: 'Sort lines ascending',
    category: 'Format',
    run: () => applyTransform((text) => sortLines(text, false)),
  },
  {
    id: 'format.sortDesc',
    title: 'Sort lines descending',
    category: 'Format',
    run: () => applyTransform((text) => sortLines(text, true)),
  },
  {
    id: 'format.sortAscInsensitive',
    title: 'Sort lines ascending (case-insensitive)',
    category: 'Format',
    run: () => applyTransform((text) => sortLinesCaseInsensitive(text)),
  },
  {
    id: 'format.sortDescInsensitive',
    title: 'Sort lines descending (case-insensitive)',
    category: 'Format',
    run: () => applyTransform((text) => sortLinesCaseInsensitive(text, true)),
  },
  {
    id: 'format.reverseLines',
    title: 'Reverse lines',
    category: 'Format',
    run: () => applyTransform(reverseLines),
  },
  {
    id: 'format.shuffleLines',
    title: 'Shuffle lines',
    category: 'Format',
    run: () => applyTransform(shuffleLines),
  },
  {
    id: 'format.sortByLengthAsc',
    title: 'Sort lines by length (shortest first)',
    category: 'Format',
    run: () => applyTransform((text) => sortLinesByLength(text, false)),
  },
  {
    id: 'format.sortByLengthDesc',
    title: 'Sort lines by length (longest first)',
    category: 'Format',
    run: () => applyTransform((text) => sortLinesByLength(text, true)),
  },
  {
    id: 'format.removeDuplicates',
    title: 'Remove duplicate lines',
    category: 'Format',
    run: () => applyTransform(removeDuplicateLines),
  },
  {
    id: 'format.trimTrailing',
    title: 'Trim trailing whitespace',
    category: 'Format',
    run: () => applyTransform(trimTrailingWhitespace),
  },
  {
    id: 'format.trimLeading',
    title: 'Trim leading whitespace',
    category: 'Format',
    run: () => applyTransform(trimLeadingWhitespace),
  },
  {
    id: 'format.joinLines',
    title: 'Join lines',
    category: 'Format',
    run: () => applyTransform(joinLines),
  },
  {
    id: 'format.upperCase',
    title: 'UPPERCASE selection',
    category: 'Format',
    run: () => applyTransform((text) => changeCase(text, 'upper')),
  },
  {
    id: 'format.lowerCase',
    title: 'lowercase selection',
    category: 'Format',
    run: () => applyTransform((text) => changeCase(text, 'lower')),
  },
  {
    id: 'format.titleCase',
    title: 'Title Case selection',
    category: 'Format',
    run: () => applyTransform((text) => changeCase(text, 'title')),
  },
  /* --------- programming cases (camel, snake, kebab, …) --------- */
  {
    id: 'format.camelCase',
    title: 'Convert to camelCase',
    category: 'Format',
    run: () => applyTransform((text) => convertCase(text, 'camel')),
  },
  {
    id: 'format.pascalCase',
    title: 'Convert to PascalCase',
    category: 'Format',
    run: () => applyTransform((text) => convertCase(text, 'pascal')),
  },
  {
    id: 'format.snakeCase',
    title: 'Convert to snake_case',
    category: 'Format',
    run: () => applyTransform((text) => convertCase(text, 'snake')),
  },
  {
    id: 'format.kebabCase',
    title: 'Convert to kebab-case',
    category: 'Format',
    run: () => applyTransform((text) => convertCase(text, 'kebab')),
  },
  {
    id: 'format.constantCase',
    title: 'Convert to CONSTANT_CASE',
    category: 'Format',
    run: () => applyTransform((text) => convertCase(text, 'constant')),
  },
  /* ------------------- encode / decode helpers -------------------- */
  {
    id: 'format.base64Encode',
    title: 'Encode selection as Base64',
    category: 'Format',
    run: () => applyTransform(base64Encode),
  },
  {
    id: 'format.base64Decode',
    title: 'Decode selection from Base64',
    category: 'Format',
    run: () =>
      applyTransform((text) => {
        try {
          return base64Decode(text)
        } catch (error) {
          store().toast(`Not valid Base64: ${String(error)}`, 'error')
          return text
        }
      }),
  },
  {
    id: 'format.urlEncode',
    title: 'URL-encode selection',
    category: 'Format',
    run: () => applyTransform(urlEncode),
  },
  {
    id: 'format.urlDecode',
    title: 'URL-decode selection',
    category: 'Format',
    run: () =>
      applyTransform((text) => {
        try {
          return urlDecode(text)
        } catch (error) {
          store().toast(`Not valid URL encoding: ${String(error)}`, 'error')
          return text
        }
      }),
  },
  {
    id: 'format.escapeHtml',
    title: 'Escape HTML entities',
    category: 'Format',
    run: () => applyTransform(escapeHtml),
  },
  {
    id: 'format.unescapeHtml',
    title: 'Unescape HTML entities',
    category: 'Format',
    run: () => applyTransform(unescapeHtml),
  },
  /* ---------------------- format documents ------------------------ */
  {
    id: 'format.jsonPretty',
    title: 'Format JSON',
    category: 'Format',
    run: () =>
      applyTransform((text) => {
        try {
          return formatJson(text)
        } catch (error) {
          store().toast(`Not valid JSON: ${String(error)}`, 'error')
          return text
        }
      }),
  },
  {
    id: 'format.jsonMinify',
    title: 'Minify JSON',
    category: 'Format',
    run: () =>
      applyTransform((text) => {
        try {
          return minifyJson(text)
        } catch (error) {
          store().toast(`Not valid JSON: ${String(error)}`, 'error')
          return text
        }
      }),
  },
  {
    id: 'format.xmlFormat',
    title: 'Format XML / HTML',
    category: 'Format',
    run: () => applyTransform(formatXml),
  },
  /* ------------------------ generators ---------------------------- */
  {
    id: 'edit.insertUuid',
    title: 'Insert UUID',
    category: 'Edit',
    run: () => getEditor(store().activeTabId)?.insertText(makeUuid()),
  },
  {
    id: 'edit.insertTimestamp',
    title: 'Insert Unix timestamp',
    category: 'Edit',
    run: () => getEditor(store().activeTabId)?.insertText(String(Math.floor(Date.now() / 1000))),
  },
  {
    id: 'edit.insertIsoDate',
    title: 'Insert ISO date and time',
    category: 'Edit',
    run: () => getEditor(store().activeTabId)?.insertText(new Date().toISOString()),
  },
  {
    id: 'edit.insertRandomString',
    title: 'Insert random string',
    category: 'Edit',
    run: () => {
      const bytes = new Uint8Array(8)
      crypto.getRandomValues(bytes)
      const value = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
      getEditor(store().activeTabId)?.insertText(value)
    },
  },

  /* ------------------------------ Tools ------------------------------ */
  {
    id: 'tools.compare',
    title: 'Compare with another file…',
    category: 'Tools',
    run: async () => {
      const tab = activeTab()
      if (!tab) return
      const result = await window.api.fs.openDialog({ title: 'Compare with…', filters: FILE_FILTERS })
      if (result.canceled || !result.filePath) return
      const left = tab.path ? (await window.api.fs.readFile(tab.path)).content : tab.content
      const right = (await window.api.fs.readFile(result.filePath)).content
      store().setCompareData({
        left,
        right,
        leftName: tab.name,
        rightName: result.filePath.split(/[\\/]/).pop() ?? result.filePath,
      })
      store().setDialog('compare', true)
    },
  },
  {
    id: 'tools.macroStart',
    title: 'Start recording macro',
    category: 'Tools',
    run: () => {
      if (recorder) return
      recorder = startRecording()
      store().toast('Recording macro…', 'success')
    },
  },
  {
    id: 'tools.macroStop',
    title: 'Stop recording macro',
    category: 'Tools',
    run: async () => {
      if (!recorder) return
      const events = recorder.stop()
      recorder = null
      if (!events.length) {
        store().toast('Macro recorded no events')
        return
      }
      const name = await useUiStore.getState().ask({
        title: 'Save macro',
        message: 'Macro name',
        defaultValue: `Macro ${new Date().toLocaleTimeString()}`,
      })
      if (!name) return
      const macros = loadMacros()
      macros.push({ name, events, createdAt: Date.now() })
      saveMacros(macros)
      store().toast(`Macro "${name}" saved`, 'success')
    },
  },
  {
    id: 'tools.macroPlay',
    title: 'Play macro…',
    category: 'Tools',
    run: async () => {
      const macros = loadMacros()
      if (!macros.length) {
        store().toast('No macros recorded yet')
        return
      }
      const name = await useUiStore.getState().ask({
        title: 'Play macro',
        message: macros.map((m) => m.name).join(', '),
        defaultValue: macros[0].name,
      })
      const macro = macros.find((m) => m.name === name)
      if (!macro) return
      playMacro(macro.events, (event) => {
        if (event.type === 'insert') {
          getEditor(store().activeTabId)?.insertText(event.value)
        }
      })
    },
  },
  {
    id: 'tools.stopRun',
    title: 'Stop the running process',
    category: 'Tools',
    shortcut: 'Shift+F5',
    run: () => {
      // Use the run store so the panel leaves the "running" state as well.
      void import('./runState').then(({ stopRun }) => stopRun())
    },
  },
  {
    id: 'tools.characterMap',
    title: 'Character map…',
    category: 'Tools',
    run: () => {
      store().setDialog('charMap', true)
    },
  },
  {
    id: 'tools.openTerminal',
    title: 'Open terminal here',
    category: 'Tools',
    run: () => {
      const tab = activeTab()
      const cwd = tab?.path ? tab.path.replace(/[\\/][^\\/]*$/, '') : undefined
      void window.api.shell.openTerminal(cwd)
    },
  },
  {
    id: 'view.toggleTerminal',
    title: 'Show the integrated terminal',
    category: 'View',
    shortcut: 'Ctrl+`',
    run: async () => {
      const state = store()
      state.setBottomTab('terminal')
      state.setBottomPanelVisible(true)
      const { useTerminalStore } = await import('./terminalState')
      const terminal = useTerminalStore.getState()
      if (!terminal.getActive()) {
        const tab = state.activeTabId ? state.tabs.find((entry) => entry.id === state.activeTabId) : undefined
        const cwd = tab?.path ? tab.path.replace(/[\\/][^\\/]*$/, '') : (state.workspaceRoot ?? undefined)
        void terminal.start(cwd)
      }
    },
  },
  {
    id: 'terminal.clear',
    title: 'Clear the terminal',
    category: 'Tools',
    run: async () => {
      const { useTerminalStore } = await import('./terminalState')
      const id = useTerminalStore.getState().activeId
      if (id) useTerminalStore.getState().clear(id)
    },
  },
  {
    id: 'terminal.new',
    title: 'New terminal tab',
    category: 'Tools',
    shortcut: 'Ctrl+Shift+`',
    run: async () => {
      const { useTerminalStore } = await import('./terminalState')
      const current = useTerminalStore.getState().getActive()
      const tab = await useTerminalStore.getState().create(current?.cwd || undefined, undefined)
      if (tab) {
        const state = store()
        state.setBottomTab('terminal')
        state.setBottomPanelVisible(true)
      }
    },
  },
  {
    id: 'terminal.restart',
    title: 'Restart the shell',
    category: 'Tools',
    run: async () => {
      const { useTerminalStore } = await import('./terminalState')
      const current = useTerminalStore.getState().getActive()
      if (current) useTerminalStore.getState().close(current.id)
      void useTerminalStore.getState().start(current?.cwd || undefined)
    },
  },
  {
    id: 'tools.run',
    title: 'Run current file',
    category: 'Tools',
    shortcut: 'F5',
    run: async () => {
      // Saves a dirty or untitled buffer first, then starts the interpreter.
      const { runActiveFile } = await import('./runState')
      await runActiveFile()
    },
  },

  /* ------------------------------- Help ------------------------------ */
  {
    id: 'help.about',
    title: 'About FlintQode',
    category: 'Help',
    run: () => {
      store().setDialog('about', true)
    },
  },
  {
    id: 'help.welcome',
    title: 'Welcome & keyboard shortcuts',
    category: 'Help',
    run: () => {
      store().setDialog('welcome', true)
    },
  },
]

/** Register every built-in command. */
export function registerBuiltinCommands(): void {
  registerCommands(builtinCommands)
}
