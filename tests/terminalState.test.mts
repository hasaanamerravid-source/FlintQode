/**
 * Regression tests for the integrated terminal store.
 *
 * The original bug was two UI paths starting the first shell at the same time:
 * the command created a PTY in the app launch directory while the view created
 * a second one in the workspace. The store now shares the in-flight promise,
 * resolves cwd from live app state, and gives the panel explicit lifecycle
 * ownership (hide keeps sessions by default, close kills exactly one PTY).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

interface CreateCall {
  cwd: string | null | undefined
  label: string | null | undefined
}

interface OutputEvent {
  type: 'data' | 'exit'
  sessionId: string
  text?: string
  code?: number
}

const createCalls: CreateCall[] = []
const closeCalls: string[] = []
let activeCalls = 0
let emitOutput: ((event: OutputEvent) => void) | undefined

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
    onOutput: (cb: (event: OutputEvent) => void) => {
      emitOutput = cb
      return () => undefined
    },
    close: async (id: string) => {
      closeCalls.push(id)
      return 'ok'
    },
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
  closeCalls.length = 0
  activeCalls = 0
  useTerminalStore.setState({ sessions: [], activeId: '' })
  const settings = useAppStore.getState().settings
  useAppStore.setState({
    workspaceRoot: null,
    tabs: [],
    activeTabId: null,
    bottomPanelVisible: true,
    settings: { ...settings, projectFolder: null, closeOnPanelHide: false },
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

test('hiding with zero sessions starts one shell when the panel reopens', async () => {
  reset()
  await useTerminalStore.getState().handlePanelVisibility(false)
  assert.equal(createCalls.length, 0)

  const session = await useTerminalStore.getState().ensureFirst('/workspace')
  assert.equal(createCalls.length, 1)
  assert.equal(session?.cwd, '/workspace')
})

test('hiding with a live session starts zero shells on reopen', async () => {
  reset()
  const first = await useTerminalStore.getState().ensureFirst('/workspace')
  await useTerminalStore.getState().handlePanelVisibility(false)

  const reopened = await useTerminalStore.getState().ensureFirst('/different')
  assert.equal(createCalls.length, 1)
  assert.equal(reopened, undefined)
  assert.equal(useTerminalStore.getState().getActive()?.id, first?.id)
})

test('closing a tab kills exactly that PTY', async () => {
  reset()
  const first = await useTerminalStore.getState().create('/first')
  const second = await useTerminalStore.getState().create('/second')
  closeCalls.length = 0

  await useTerminalStore.getState().close(first!.id)
  assert.deepEqual(closeCalls, [first!.id])
  assert.deepEqual(
    useTerminalStore.getState().sessions.map((session) => session.id),
    [second!.id],
  )
})

test('closing a session removes its output listeners', async () => {
  reset()
  const session = await useTerminalStore.getState().create('/first')
  const received: string[] = []
  const stop = useTerminalStore.getState().onData(session!.id, (text) => received.push(text))
  assert.ok(emitOutput)

  emitOutput!({ type: 'data', sessionId: session!.id, text: 'first' })
  await useTerminalStore.getState().close(session!.id)
  emitOutput!({ type: 'data', sessionId: session!.id, text: 'second' })

  assert.deepEqual(received, ['first'])
  stop()
})

test('closeOnPanelHide closes every live session', async () => {
  reset()
  const settings = useAppStore.getState().settings
  useAppStore.setState({ settings: { ...settings, closeOnPanelHide: true } })
  const first = await useTerminalStore.getState().create('/first')
  const second = await useTerminalStore.getState().create('/second')
  closeCalls.length = 0

  await useTerminalStore.getState().handlePanelVisibility(false)
  assert.equal(closeCalls.length, 2)
  assert.ok(closeCalls.includes(first!.id))
  assert.ok(closeCalls.includes(second!.id))
  assert.equal(useTerminalStore.getState().sessions.length, 0)
})

test('a start already in flight is closed when the panel hides with closeOnPanelHide', async () => {
  reset()
  const settings = useAppStore.getState().settings
  useAppStore.setState({ settings: { ...settings, closeOnPanelHide: true } })

  const pending = useTerminalStore.getState().start('/late')
  await useTerminalStore.getState().handlePanelVisibility(false)
  assert.equal(await pending, undefined)
  assert.deepEqual(closeCalls, ['term-1'])
  assert.equal(useTerminalStore.getState().sessions.length, 0)
})

test('restart reuses the recorded cwd', async () => {
  reset()
  const first = await useTerminalStore.getState().create('/old-cwd')
  closeCalls.length = 0

  const restarted = await useTerminalStore.getState().restart()
  assert.deepEqual(closeCalls, [first!.id])
  assert.equal(createCalls.at(-1)?.cwd, '/old-cwd')
  assert.equal(restarted?.cwd, '/old-cwd')
  assert.notEqual(restarted?.id, first?.id)
})
