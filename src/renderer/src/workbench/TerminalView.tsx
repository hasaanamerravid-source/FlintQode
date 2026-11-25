/**
 * Integrated terminal view.
 *
 * Every session owns an xterm.js instance. The native PTY emits raw data, the
 * store routes it to the right instance, and keystrokes travel back untouched.
 */

import { createEffect, createMemo, createSignal, For, onSettled, Show } from 'solid-js'
import type { JSX } from '@solidjs/web'
import { Terminal } from '@xterm/xterm'
import type { ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { useT } from '../core/i18n'
import { useTerminalStore } from '../core/terminalState'
import { Icon } from '../components/Icons'

const PALETTE = [
  '#1e222b',
  '#e06c75',
  '#98c379',
  '#e5c07b',
  '#61afef',
  '#c678dd',
  '#56b6c2',
  '#abb2bf',
  '#5c6370',
  '#f28b94',
  '#a9d189',
  '#f3ce7f',
  '#8cbcff',
  '#dba4f4',
  '#83d3dd',
  '#ffffff',
]

function cssColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function terminalTheme(): ITheme {
  const background = cssColor('--bg-editor', '#0f1115')
  const foreground = cssColor('--fg', '#e6e9ef')
  const selection = cssColor('--bg-active', '#242b37')
  return {
    background,
    foreground,
    cursor: cssColor('--accent', '#60a5fa'),
    cursorAccent: background,
    selectionBackground: selection,
    black: PALETTE[0],
    red: PALETTE[1],
    green: PALETTE[2],
    yellow: PALETTE[3],
    blue: PALETTE[4],
    magenta: PALETTE[5],
    cyan: PALETTE[6],
    white: PALETTE[7],
    brightBlack: PALETTE[8],
    brightRed: PALETTE[9],
    brightGreen: PALETTE[10],
    brightYellow: PALETTE[11],
    brightBlue: PALETTE[12],
    brightMagenta: PALETTE[13],
    brightCyan: PALETTE[14],
    brightWhite: PALETTE[15],
  }
}

interface SessionTerminalProps {
  sessionId: string
  active: boolean
}

function SessionTerminal(props: SessionTerminalProps): JSX.Element {
  let host!: HTMLDivElement
  let fitRef: FitAddon | null = null

  onSettled(() => {
    const element = host
    const terminal = new Terminal({
      theme: terminalTheme(),
      fontFamily: '"JetBrains Mono", "Fira Code", "SFMono-Regular", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      cursorBlink: true,
      scrollback: 6000,
      allowTransparency: false,
      convertEol: false,
    })
    const fit = new FitAddon()
    fitRef = fit
    terminal.loadAddon(fit)
    terminal.loadAddon(new WebLinksAddon())
    terminal.open(element)

    const fitNow = (): void => {
      if (!props.active || element.clientWidth === 0 || element.clientHeight === 0) return
      try {
        fit.fit()
      } catch {
        /* the panel is being resized */
      }
    }
    fitNow()
    const observer = new ResizeObserver(fitNow)
    observer.observe(element)

    const stopData = useTerminalStore.getState().onData(props.sessionId, (text) => terminal.write(text))
    const stopExit = useTerminalStore.getState().onExit(props.sessionId, (code) => {
      terminal.write(`\r\n\x1b[2m[process exited${code === undefined ? '' : ` ${code}`}]\x1b[0m\r\n`)
    })
    const stopClear = useTerminalStore.getState().onClear(props.sessionId, () => terminal.clear())
    const input = terminal.onData((data) => {
      void useTerminalStore.getState().write(props.sessionId, data)
    })

    const themeObserver = new MutationObserver(() => {
      terminal.options.theme = terminalTheme()
    })
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    return () => {
      observer.disconnect()
      themeObserver.disconnect()
      input.dispose()
      stopData()
      stopExit()
      stopClear()
      terminal.dispose()
      fitRef = null
    }
  })

  createEffect(
    () => props.active,
    (active) => {
      if (!active) return
      const frame = requestAnimationFrame(() => {
        try {
          fitRef?.fit()
        } catch {
          /* not laid out yet */
        }
        host.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')?.focus()
      })
      return () => cancelAnimationFrame(frame)
    },
  )

  return (
    <div
      class="terminal-surface"
      ref={(element) => (host = element)}
      style={{ display: props.active ? 'block' : 'none' }}
    />
  )
}

interface RenameInputProps {
  value: string
  onInput: (value: string) => void
  onCommit: () => void
  onCancel: () => void
}

function RenameInput(props: RenameInputProps): JSX.Element {
  let input!: HTMLInputElement

  onSettled(() => input.focus())

  return (
    <input
      class="tab-rename"
      ref={(element) => (input = element)}
      value={props.value}
      onInput={(event) => props.onInput(event.currentTarget.value)}
      onBlur={() => props.onCommit()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') props.onCommit()
        if (event.key === 'Escape') props.onCancel()
      }}
      onClick={(event) => event.stopPropagation()}
    />
  )
}

export function TerminalView(props: { cwd?: string }): JSX.Element {
  const sessions = createMemo(() => useTerminalStore().sessions)
  const sessionIds = createMemo(() => sessions().map((session) => session.id))
  const active = createMemo(
    () => sessions().find((session) => session.id === useTerminalStore().activeId) ?? sessions()[0],
  )
  const actions = useTerminalStore.getState()
  const [editing, setEditing] = createSignal<string | null>(null)
  const [label, setLabel] = createSignal('')
  const t = useT()

  createEffect(
    () => ({ count: sessions().length, cwd: props.cwd }),
    (source) => {
      // This view owns the first shell. Reopening the dock with a live
      // session must reattach to it, not start another PTY.
      if (source.count === 0) void actions.ensureFirst(source.cwd)
    },
  )

  const commitRename = (): void => {
    const current = editing()
    const next = label().trim()
    if (current && next) actions.rename(current, next)
    setEditing(null)
  }

  return (
    <div class="panel terminal-view">
      <div class="workbench-terminal-tabs">
        <For each={sessionIds()}>
          {(id) => {
            const info = createMemo(() => sessions().find((session) => session.id === id))
            const title = createMemo(() => `${info()?.label ?? ''} — ${info()?.cwd ?? ''}`)
            return (
              <div
                class={`workbench-terminal-tab${active()?.id === id ? ' active' : ''}`}
                onClick={() => actions.switchTo(id)}
                onDblClick={() => {
                  setEditing(id)
                  setLabel(info()?.label ?? '')
                }}
                title={title()}
              >
                <Icon name="terminal" size={13} />
                <Show when={editing() === id} fallback={<span class="tab-label">{info()?.label}</span>}>
                  <RenameInput
                    value={label()}
                    onInput={(value) => setLabel(value)}
                    onCommit={() => commitRename()}
                    onCancel={() => setEditing(null)}
                  />
                </Show>
                <Show when={info()?.cwd}>
                  <span class="terminal-tab-cwd" title={info()!.cwd}>
                    {info()!.cwd}
                  </span>
                </Show>
                <span class={`tab-dot${info()?.running ? ' live' : ''}`} />
                <button
                  class="tab-close"
                  aria-label="Close terminal"
                  onClick={(event) => {
                    event.stopPropagation()
                    void actions.close(id)
                  }}
                >
                  ×
                </button>
              </div>
            )
          }}
        </For>
        <button
          class="panel-button"
          title={t('panel.terminalNewHere')}
          onClick={() => void actions.create(active()?.cwd ?? props.cwd)}
        >
          +
        </button>
      </div>

      <div class="workbench-terminal-bar">
        <span class="panel-subtitle" title={active()?.cwd}>
          {active() ? `${active()?.shell} · ${active()?.cwd}` : t('panel.terminalNoShell')}
        </span>
        <span class="bar-actions">
          <button
            class="panel-button"
            title={t('panel.terminalNewHere')}
            onClick={() => void actions.create(active()?.cwd ?? props.cwd)}
          >
            {t('panel.terminalNewHere')}
          </button>
          <button
            class="panel-button"
            title={t('panel.terminalStopShell')}
            disabled={!active()?.running}
            onClick={() => active() && void actions.stop(active()!.id)}
          >
            ✕
          </button>
          <button class="panel-button" title="Clear" onClick={() => active() && actions.clear(active()!.id)}>
            ⌫
          </button>
        </span>
      </div>

      <div class="workbench-terminal-body">
        <Show
          when={active()}
          fallback={
            <div class="empty-state">
              {t('panel.terminalNotRunning')}
              <button class="panel-button" onClick={() => void actions.start(props.cwd)}>
                {t('panel.terminalStart')}
              </button>
            </div>
          }
        >
          <For each={sessionIds()}>{(id) => <SessionTerminal sessionId={id} active={active()?.id === id} />}</For>
        </Show>
      </div>
    </div>
  )
}
