/**
 * Regression tests for the integrated terminal store.
 *
 * The bug being guarded against was two UI paths starting the first shell at
 * the same time: the command created a PTY in the app launch directory while
 * the view created a second one in the workspace. The store now shares the
 * in-flight promise and resolves cwd from live app state.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

interface CreateCall {
  cwd: string | null | undefined
  label: string | null | undefined
}

const createCalls: CreateCall[] = []
let activeCalls = 0

function installWindowMock(): void {
  const terminal = {
    create: async (cwd?: string | null, label?: string | null) => {
      createCalls.push({ cwd, label })
      return {
        id: `term-${createCalls.length}`,
        ok: true,
        cwd: cwd || '/fallback',
        shell: 'bash',
        label: label || 'shell',
      }
    },
    active: async () => {
      activeCalls++
      return 'ok'
    },
    onOutput: () => () => undefined,
    close: async () => 'ok',
    write: async () => 'ok',
    interrupt: async () => 'ok',
    stop: async () => 'ok',
  }
  ;(globalThis as unknown as { window: { api: { terminal: typeof terminal } } }).window = {
    api: { terminal },
  }
}

installWindowMock()

const { useTerminalStore } = await import('../src/renderer/src/core/terminalState')
const { useAppStore } = await import('../src/renderer/src/store/app')

function reset(): void {
  createCalls.length = 0
  activeCalls = 0
  useTerminalStore.setState({ sessions: [], activeId: '' })
  const settings = useAppStore.getState().settings
  useAppStore.setState({
    workspaceRoot: null,
    tabs: [],
    activeTabId: null,
    settings: { ...settings, projectFolder: null },
  })
}

test('two simultaneous starts create only one shell', async () => {
  reset()
  const [first, second] = await Promise.all([
    useTerminalStore.getState().start('/workspace'),
    useTerminalStore.getState().start('/workspace'),
  ])
  assert.equal(createCalls.length, 1)
  assert.equal(activeCalls, 1)
  assert.equal(first?.id, 'term-1')
  assert.equal(second?.id, 'term-1')
  assert.equal(useTerminalStore.getState().sessions.length, 1)
})

test('the live workspace root is used when no cwd is passed', async () => {
  reset()
  useAppStore.setState({ workspaceRoot: '/live-workspace' })
  await useTerminalStore.getState().start()
  assert.equal(createCalls[0]?.cwd, '/live-workspace')
})

test('the project folder is used when there is no workspace root', async () => {
  reset()
  const settings = useAppStore.getState().settings
  useAppStore.setState({ settings: { ...settings, projectFolder: '/project' } })
  await useTerminalStore.getState().start()
  assert.equal(createCalls[0]?.cwd, '/project')
})

test('an explicit cwd wins over the live workspace', async () => {
  reset()
  useAppStore.setState({ workspaceRoot: '/live-workspace' })
  await useTerminalStore.getState().start('/explicit')
  assert.equal(createCalls[0]?.cwd, '/explicit')
})
