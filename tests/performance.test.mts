/**
 * Regression tests for the v1.5.1 performance fixes.
 *
 * v1.5.0 rebuilt large parts of the editor UI on every keystroke: the store
 * bumped its version even for no-op updates, every debounce copied the whole
 * document into a dedupe key, LSP clients re-sent `didOpen` with the full
 * text, and a tab switch could write the incoming file into the outgoing
 * editor. These tests pin the guards that made those paths cheap and safe.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_DIAGNOSTICS, mergeDiagnostics } from '../src/renderer/src/core/defaults'

interface LspParams {
  language: string
  uri: string
  text?: string
}

const lspCalls: { method: string; params: LspParams }[] = []

const lsp = {
  didOpen: (params: LspParams) => {
    lspCalls.push({ method: 'didOpen', params })
    return true
  },
  didChange: (params: LspParams) => {
    lspCalls.push({ method: 'didChange', params })
    return true
  },
  didClose: (params: LspParams) => {
    lspCalls.push({ method: 'didClose', params })
    return true
  },
}

;(globalThis as unknown as { window: { api: unknown } }).window = { api: { lsp } }

const { create } = await import('../src/renderer/src/state/compat')
const { useAppStore } = await import('../src/renderer/src/store/app')
const { useLspStore } = await import('../src/renderer/src/core/lspState')
const { openDialogFilters } = await import('../src/renderer/src/bridge')
const { createCheckMemo } = await import('../src/renderer/src/core/useProblems')
const { applyExternalContent } = await import('../src/renderer/src/components/editor/editorSync')

test('a store update that returns the same state notifies nobody', () => {
  const store = create<{ count: number }>(() => ({ count: 0 }))
  let notifications = 0
  store.subscribe(() => {
    notifications++
  })

  store.setState((current) => current)
  assert.equal(notifications, 0)

  store.setState({ count: 1 })
  assert.equal(notifications, 1)
})

test('re-marking a dirty tab does not wake the store', () => {
  useAppStore.setState({ tabs: [], activeTabId: null })
  const id = useAppStore.getState().newTab({ id: 'perf-tab', dirty: true, content: 'a' })

  let notifications = 0
  const unsubscribe = useAppStore.subscribe(() => {
    notifications++
  })

  useAppStore.getState().setTabDirty(id, true)
  useAppStore.getState().setTabDirty('missing-tab', true)
  assert.equal(notifications, 0)

  useAppStore.getState().setTabDirty(id, false)
  assert.equal(notifications, 1)

  unsubscribe()
})

test('didOpen is sent once per document and again after close', () => {
  lspCalls.length = 0
  const open = useLspStore.getState().open
  const change = useLspStore.getState().change
  const close = useLspStore.getState().close

  open('typescript', 'file:///perf.ts', 'const a = 1')
  open('typescript', 'file:///perf.ts', 'const a = 2')
  assert.equal(lspCalls.filter((call) => call.method === 'didOpen').length, 1)

  change('typescript', 'file:///perf.ts', 'const a = 3')
  assert.equal(lspCalls.filter((call) => call.method === 'didChange').length, 1)

  close('typescript', 'file:///perf.ts')
  open('typescript', 'file:///perf.ts', 'const a = 4')
  assert.equal(lspCalls.filter((call) => call.method === 'didOpen').length, 2)
})

test('an All Files filter leaves the native picker unfiltered', () => {
  assert.deepEqual(openDialogFilters({ filters: [{ name: 'All Files', extensions: ['*'] }] }), [])
  assert.deepEqual(
    openDialogFilters({
      filters: [
        { name: 'All Files', extensions: ['*'] },
        { name: 'Text', extensions: ['.txt'] },
      ],
    }),
    [],
  )
  assert.deepEqual(openDialogFilters({ filters: [{ name: 'Markdown', extensions: ['.md', '.markdown'] }] }), [
    { name: 'Markdown', extensions: ['md', 'markdown'] },
  ])
  assert.deepEqual(openDialogFilters({}), [])
})

test('the problem check memo compares content without copying it into the key', () => {
  const memo = createCheckMemo()
  const base = {
    activeTabId: 'tab-a',
    content: '<p>one</p>',
    language: 'html',
    large: false,
    path: '/one.html',
    diagnostics: undefined,
  }

  assert.equal(memo.shouldRun(base), true)
  assert.equal(memo.shouldRun({ ...base }), false)

  // An edit of the same size must still run the check.
  assert.equal(memo.shouldRun({ ...base, content: '<p>two</p>' }), true)

  // Switching tabs must run it even when the text happens to be identical.
  assert.equal(memo.shouldRun({ ...base, activeTabId: 'tab-b' }), true)

  // Changing a rule must run it without touching the document.
  const strict = mergeDiagnostics({
    rules: { ...DEFAULT_DIAGNOSTICS.rules, lineLength: { enabled: true } },
  } as never)
  assert.equal(memo.shouldRun({ ...base, activeTabId: 'tab-b', diagnostics: strict }), true)
})

function fakeView(initial: string) {
  let text = initial
  const dispatches: { changes: { from: number; to: number; insert: string } }[] = []
  return {
    view: {
      state: {
        doc: {
          toString: () => text,
          get length() {
            return text.length
          },
        },
      },
      dispatch: (spec: { changes: { from: number; to: number; insert: string } }) => {
        dispatches.push(spec)
        text = spec.changes.insert
      },
    },
    dispatches,
    text: () => text,
  }
}

test('a tab switch never writes the incoming file into the outgoing editor', () => {
  const outgoing = fakeView('outgoing code')

  const applied = applyExternalContent(outgoing.view, 'incoming-tab', 'outgoing-tab', 'incoming code', false)

  assert.equal(applied, false)
  assert.equal(outgoing.dispatches.length, 0)
  // The teardown still flushes the old view, so this must be the old text.
  assert.equal(outgoing.text(), 'outgoing code')
})

test('external content is applied only to the current clean tab', () => {
  const editor = fakeView('old text')

  assert.equal(applyExternalContent(editor.view, 'tab', 'tab', 'old text', false), false)
  assert.equal(editor.dispatches.length, 0)

  assert.equal(applyExternalContent(editor.view, 'tab', 'tab', 'new text', true), false)
  assert.equal(editor.dispatches.length, 0)

  assert.equal(applyExternalContent(editor.view, 'tab', 'tab', 'new text', false), true)
  assert.equal(editor.dispatches.length, 1)
  assert.equal(editor.text(), 'new text')
})
