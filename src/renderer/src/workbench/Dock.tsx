/** The bottom dock: problems, run output and the integrated terminal. */

import { createMemo, createSignal, For, lazy, Loading, Match, Show, Switch } from 'solid-js'
import type { JSX } from '@solidjs/web'
import { useAppStore, type BottomTab } from '../store/app'
import { appActions } from '../state/solid'
import { useT } from '../core/i18n'
import { projectFolder } from '../core/projectConfig'
import { runCommand } from '../core/commands'
import { useProblems } from '../core/useProblems'
import { jumpToProblem } from '../core/lspCommands'
import { Icon, type IconName } from '../components/Icons'
import { ProblemsView } from './ProblemsView'
import { RunView } from './RunView'

const TerminalView = lazy(() => import('./TerminalView').then((module) => ({ default: module.TerminalView })))

interface TabInfo {
  id: BottomTab
  label: string
  icon: IconName
}

export function Dock(): JSX.Element {
  const active = createMemo(() => useAppStore().bottomTab)
  const workspaceRoot = createMemo(() => useAppStore().workspaceRoot)
  const select = appActions().setBottomTab
  const close = appActions().setBottomPanelVisible
  const [height, setHeight] = createSignal(260)
  const problems = useProblems()
  const t = useT()

  const tabs = createMemo<TabInfo[]>(() => [
    { id: 'problems', label: t('panel.problems'), icon: 'problems' },
    { id: 'run', label: t('panel.run'), icon: 'terminal' },
    { id: 'terminal', label: t('panel.terminal'), icon: 'terminal' },
  ])

  const startResize = (event: MouseEvent): void => {
    event.preventDefault()
    const move = (moveEvent: MouseEvent): void => {
      const bottom = window.innerHeight
      setHeight(Math.min(620, Math.max(140, bottom - moveEvent.clientY)))
    }
    const up = (): void => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }

  return (
    <section class="workbench-dock" style={{ height: `${height()}px` }}>
      <div class="workbench-dock-resizer" onMouseDown={startResize} />
      <header class="workbench-dock-header">
        <nav class="workbench-dock-tabs" aria-label="Panels">
          <For each={tabs()} keyed={(tab) => tab.id}>
            {(tab) => (
              <button
                class={`workbench-dock-tab${active() === tab().id ? ' active' : ''}`}
                aria-current={active() === tab().id ? 'true' : 'false'}
                onClick={() => select(tab().id)}
              >
                <Icon name={tab().icon} size={14} />
                <span>{tab().label}</span>
                <Show when={tab().id === 'problems' && problems().length > 0}>
                  <span class="tab-count">{problems().length}</span>
                </Show>
              </button>
            )}
          </For>
        </nav>
        <button class="icon-btn" title="Close panel" onClick={() => close(false)}>
          ×
        </button>
      </header>
      <div class="workbench-dock-body">
        <Switch>
          <Match when={active() === 'terminal'}>
            <Loading fallback={<div class="empty-state">{t('common.loading')}</div>}>
              <TerminalView cwd={workspaceRoot() ?? projectFolder() ?? undefined} />
            </Loading>
          </Match>
          <Match when={active() === 'run'}>
            <RunView onRun={() => void runCommand('tools.run')} onStop={() => void runCommand('tools.stopRun')} />
          </Match>
          <Match when={true}>
            <ProblemsView problems={problems} onSelect={(problem) => void jumpToProblem(problem)} />
          </Match>
        </Switch>
      </div>
    </section>
  )
}
