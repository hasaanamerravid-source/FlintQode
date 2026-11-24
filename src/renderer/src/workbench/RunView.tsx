/** Run output: a live log with clickable file/line references. */

import { createEffect, createMemo, For, Show } from 'solid-js'
import type { JSX } from '@solidjs/web'
import { useAppStore } from '../store/app'
import { getEditor } from '../core/editors'
import { runCommand } from '../core/commands'
import { useRunStore } from '../core/runState'
import { useT } from '../core/i18n'
import { Icon } from '../components/Icons'

const LOCATION =
  /(?:(?:\/|[A-Za-z]:\\)[^\s:()]+|[^\s:()]+\.[A-Za-z0-9]+):(\d+)(?::(\d+))?|\.([^\s:()]+\.[A-Za-z0-9]+)\((\d+)(?:,\s*(\d+))?\)/

function jumpToMatch(text: string): void {
  const match = LOCATION.exec(text)
  if (!match) return
  const activeId = useAppStore.getState().activeTabId
  const active = useAppStore.getState().tabs.find((tab) => tab.id === activeId)
  const line = Number(match[1] ?? match[5] ?? 1)
  const direct = match[0].split(':')[0].replace(/\($/, '')

  const go = (): void => {
    const state = useAppStore.getState()
    const tab = state.tabs.find((entry) => entry.id === state.activeTabId)
    getEditor(tab?.id ?? '')?.goToLine(line)
    getEditor(tab?.id ?? '')?.focus()
  }

  if (active?.path && (direct === active.path || active.path.endsWith(direct))) {
    go()
    return
  }
  void window.api.fs.exists(direct).then((exists) => {
    if (!exists) return
    void useAppStore.getState().openPath(direct).then(go)
  })
}

export interface RunViewProps {
  onRun?: () => void
  onStop?: () => void
}

export function RunView(props: RunViewProps): JSX.Element {
  const running = createMemo(() => useRunStore().running)
  const lines = createMemo(() => useRunStore().lines)
  const filePath = createMemo(() => useRunStore().filePath)
  const exitCode = createMemo(() => useRunStore().exitCode)
  const clear = useRunStore.getState().clear
  const t = useT()
  let body: HTMLDivElement | undefined

  createEffect(
    () => lines(),
    () => {
      const element = body
      if (element) element.scrollTop = element.scrollHeight
    },
  )

  return (
    <div class="panel run-view">
      <div class="workbench-view-bar">
        <span class="panel-title">{t('panel.run')}</span>
        <span class="panel-subtitle">{filePath()?.split(/[\\/]/).pop() ?? t('panel.runNoProcess')}</span>
        <span class="bar-actions">
          <button
            class="panel-button"
            title={t('title.runFile')}
            onClick={() => (props.onRun ? props.onRun() : void runCommand('tools.run'))}
          >
            <Icon name="terminal" size={14} />
            {t('panel.runRerun')}
          </button>
          <button
            class="panel-button"
            title={t('panel.runStop')}
            disabled={!running()}
            onClick={() => (props.onStop ? props.onStop() : void runCommand('tools.stopRun'))}
          >
            ■ {t('panel.runStop')}
          </button>
          <button class="panel-button" title="Clear" onClick={() => clear()}>
            ⌫
          </button>
        </span>
      </div>
      <div class="workbench-run-log" ref={(element) => (body = element)}>
        <Show
          when={lines().length === 0}
          fallback={
            <For each={lines()}>
              {(line) => (
                <div
                  class={`run-entry run-${line.type}${LOCATION.test(line.text) ? ' linkable' : ''}`}
                  title={LOCATION.test(line.text) ? t('panel.runClickJump') : undefined}
                  onClick={() => LOCATION.test(line.text) && jumpToMatch(line.text)}
                >
                  {line.text || '\u00a0'}
                </div>
              )}
            </For>
          }
        >
          <div class="empty-state">{t('panel.runEmpty')}</div>
        </Show>
        <Show when={!running() && exitCode() !== null}>
          <div class="run-entry run-exit">{t('panel.runExited', { code: exitCode() ?? 0 })}</div>
        </Show>
      </div>
    </div>
  )
}
