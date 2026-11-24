/** The side bar: a resizable host for the activity views. */

import { createMemo, createSignal, lazy, Loading, Match, Switch } from 'solid-js'
import type { JSX } from '@solidjs/web'
import { useAppStore } from '../store/app'
import { appActions, useActiveTab, useActiveTabId } from '../state/solid'
import { panelAllowed } from '../core/profiles'
import { useProblems } from '../core/useProblems'
import { jumpToProblem } from '../core/lspCommands'
import { getEditor } from '../core/editors'
import { useT } from '../core/i18n'
import { ProblemsView } from './ProblemsView'
import { RunView } from './RunView'

const ExplorerView = lazy(() => import('./views/ExplorerView').then((module) => ({ default: module.ExplorerView })))
const SearchView = lazy(() => import('./views/SearchView').then((module) => ({ default: module.SearchView })))
const OutlineView = lazy(() => import('./views/OutlineView').then((module) => ({ default: module.OutlineView })))
const PluginsView = lazy(() => import('./views/PluginsView').then((module) => ({ default: module.PluginsView })))

export function Sidebar(): JSX.Element {
  const panel = createMemo(() => useAppStore().sidePanel)
  const profile = createMemo(() => useAppStore().settings.profile)
  const setPanel = appActions().setSidePanel
  const [width, setWidth] = createSignal(useAppStore.getState().sidebarWidth)
  const problems = useProblems()
  const t = useT()
  const active = useActiveTab()
  const activeTabId = useActiveTabId()
  let widthRef = useAppStore.getState().sidebarWidth

  const startResize = (event: MouseEvent): void => {
    event.preventDefault()
    const move = (moveEvent: MouseEvent): void => {
      const next = Math.min(560, Math.max(180, moveEvent.clientX))
      widthRef = next
      setWidth(next)
    }
    const up = (): void => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
      useAppStore.getState().setSettings({ sidebarWidth: widthRef })
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }

  const allowed = createMemo(() => panelAllowed(profile(), panel()))

  return (
    <aside class="workbench-sidebar" style={{ width: `${width()}px` }} aria-label={t('a11y.sidebar')}>
      <div class="workbench-sidebar-content">
        <Switch>
          <Match when={!allowed()}>
            <div class="empty-state">
              {t('panel.notInProfile')}
              <button class="panel-button" onClick={() => setPanel('files')}>
                {t('panel.showProject')}
              </button>
            </div>
          </Match>
          <Match when={panel() === 'files'}>
            <Loading fallback={<div class="empty-state">{t('common.loading')}</div>}>
              <ExplorerView />
            </Loading>
          </Match>
          <Match when={panel() === 'search'}>
            <Loading fallback={<div class="empty-state">{t('common.loading')}</div>}>
              <SearchView />
            </Loading>
          </Match>
          <Match when={panel() === 'outline'}>
            <OutlineView
              content={active()?.content ?? ''}
              title={active()?.name}
              onOpenLine={(line) => getEditor(activeTabId())?.goToLine(Math.max(1, line))}
            />
          </Match>
          <Match when={panel() === 'plugins'}>
            <Loading fallback={<div class="empty-state">{t('common.loading')}</div>}>
              <PluginsView />
            </Loading>
          </Match>
          <Match when={panel() === 'problems'}>
            <ProblemsView problems={problems} onSelect={(problem) => void jumpToProblem(problem)} />
          </Match>
          <Match when={true}>
            <RunView />
          </Match>
        </Switch>
      </div>
      <div class="workbench-sidebar-resizer" onMouseDown={startResize} />
    </aside>
  )
}
