/**
 * Regression tests for the editor performance fixes.
 *
 * A keystroke used to reparse the markdown preview, copy the whole EditorState
 * into the split peer, notify every status reader and relaunch `git diff`.
 * These tests pin the small, injectable helpers that keep those paths cheap.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

// Some imported modules touch `window` when a plugin is created.
;(globalThis as unknown as { window: { api: unknown } }).window = { api: {} }

interface PendingTask {
  id: number
  task: () => void
  delayMs: number
  cancelled: boolean
}

function fakeClock() {
  let nextId = 1
  const tasks = new Map<number, PendingTask>()
  return {
    set: (task: () => void, delayMs: number): number => {
      const id = nextId++
      tasks.set(id, { id, task, delayMs, cancelled: false })
      return id
    },
    clear: (id: number): void => {
      const pending = tasks.get(id)
      if (pending) pending.cancelled = true
      tasks.delete(id)
    },
    pending: (): PendingTask[] => [...tasks.values()].filter((task) => !task.cancelled),
    runAll: (): void => {
      const due = [...tasks.values()]
      tasks.clear()
      for (const pending of due) {
        if (!pending.cancelled) pending.task()
      }
    },
  }
}

test('a status patch that changes nothing emits no notification', async () => {
  const { useStatusStore } = await import('../src/renderer/src/store/status')
  useStatusStore.getState().reset()

  let notifications = 0
  const unsubscribe = useStatusStore.subscribe(() => {
    notifications++
  })

  useStatusStore.getState().set({ line: 1, col: 1, zoom: 1 })
  useStatusStore.getState().set({})
  assert.equal(notifications, 0)

  useStatusStore.getState().set({ zoom: 1.25 })
  assert.equal(notifications, 1)
  unsubscribe()
})

test('split sync dispatches one changes object per edit and ignores selection-only work', async () => {
  const { dispatchSplitChanges, splitSyncSpec } = await import('../src/renderer/src/state/compat')
  const dispatched: { changes: { from: number; to: number; insert: string }[] }[] = []
  const peer = {
    dispatch: (spec: { changes: { from: number; to: number; insert: string }[] }) => {
      dispatched.push(spec)
    },
    setState: () => {
      throw new Error('a split peer must never be replaced wholesale')
    },
  }

  assert.equal(splitSyncSpec([]), null)
  assert.equal(dispatchSplitChanges([], [peer]), 0)
  assert.equal(dispatched.length, 0)

  const changes = [{ from: 2, to: 4, insert: 'new' }]
  assert.equal(dispatchSplitChanges(changes, [peer, peer]), 2)
  assert.equal(dispatched.length, 2)
  assert.strictEqual(dispatched[0], dispatched[1], 'the same changes object goes to every peer')
  assert.deepEqual(dispatched[0], { changes })
})

test('the markdown renderer parses once after a burst and keeps the old HTML', async () => {
  const { createDebouncedRenderer } = await import('../src/renderer/src/state/compat')
  const clock = fakeClock()
  let renders = 0
  const state = createDebouncedRenderer(
    (source) => {
      renders++
      return `<p>${source}</p>`
    },
    { schedule: clock.set, cancel: clock.clear },
    180,
  )

  state.update('one', true)
  assert.equal(renders, 1)
  assert.equal(state.html(), '<p>one</p>')

  state.update('t')
  state.update('tw')
  state.update('two')
  assert.equal(renders, 1)
  assert.equal(state.html(), '<p>one</p>')
  assert.equal(clock.pending().length, 1)

  clock.runAll()
  assert.equal(renders, 2)
  assert.equal(state.html(), '<p>two</p>')
})

test('a recreated A view is checked again after A -> B -> A', async () => {
  const { createCheckMemo, generationOfView } = await import('../src/renderer/src/core/useProblems')
  const viewA1 = {} as import('@codemirror/view').EditorView
  const viewB = {} as import('@codemirror/view').EditorView
  const viewA2 = {} as import('@codemirror/view').EditorView
  const memo = createCheckMemo()
  const base = {
    content: 'same text',
    language: 'text',
    large: false,
    path: '/a.txt',
    diagnostics: undefined,
  }

  const firstA = { ...base, activeTabId: 'A', viewGeneration: generationOfView(viewA1) }
  assert.equal(memo.shouldRun(firstA), true)
  assert.equal(memo.shouldRun({ ...firstA }), false, 'the dedupe still works for one view')

  assert.equal(memo.shouldRun({ ...base, activeTabId: 'B', viewGeneration: generationOfView(viewB) }), true)
  // B did not commit, and A came back with a fresh editor view.
  assert.equal(memo.shouldRun({ ...base, activeTabId: 'A', viewGeneration: generationOfView(viewA2) }), true)
})

test('the git gutter waits for the debounce instead of fetching at construction', async () => {
  const { gitGutterPluginClass, REFRESH_DELAY_MS } = await import('../src/renderer/src/core/gitGutter')
  const clock = fakeClock()
  let fetches = 0
  const Plugin = gitGutterPluginClass(
    () => {
      fetches++
      return Promise.resolve('')
    },
    { set: clock.set, clear: clock.clear },
  )
  let dispatches = 0
  const view = {
    state: { doc: { lines: 1, line: () => ({ from: 0 }) } },
    dispatch: () => {
      dispatches++
    },
  } as unknown as import('@codemirror/view').EditorView

  const plugin = new Plugin(view)
  assert.equal(fetches, 0)
  assert.equal(clock.pending().length, 1)
  assert.equal(clock.pending()[0].delayMs, REFRESH_DELAY_MS)

  clock.runAll()
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(fetches, 1)
  assert.equal(dispatches, 1)
  plugin.destroy()
})
