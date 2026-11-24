import { createMemo, createSignal, For, Show } from 'solid-js'
import { Portal, type JSX } from '@solidjs/web'
import { useAppStore } from '../store/app'
import { useStatusStore } from '../store/status'
import { runCommand } from '../core/commands'
import { MainMenu } from './MainMenu'
import { AppLogo } from './AppLogo'
import { Icon } from './Icons'
import { FileIcon } from './FileIcon'
import { useRunStore } from '../core/runState'
import { useTerminalStore } from '../core/terminalState'
import { useT } from '../core/i18n'
import { useActiveTab, useActiveTabId, useSettings, useTabs } from '../state/solid'

export function TitleBar(): JSX.Element {
  const tabs = useTabs()
  const activeTabId = useActiveTabId()
  const settings = useSettings()
  const maximized = createMemo(() => useStatusStore().maximized)
  const runRunning = createMemo(() => useRunStore().running)
  const terminalBusy = createMemo(() => useTerminalStore().sessions.some((entry) => entry.running))
  const active = useActiveTab()
  const iconTheme = createMemo(() => settings().iconTheme)
  const showHamburger = createMemo(() => settings().mainMenuStyle !== 'native')
  const [menuOpen, setMenuOpen] = createSignal(false)
  const t = useT()
  let listRef: HTMLDivElement | undefined

  const anyRunning = createMemo(() => runRunning() || terminalBusy())
  const runTitle = createMemo(() => (anyRunning() ? t('cmd.tools.stopRun') : t('title.runFile')))
  const runAria = createMemo(() => (anyRunning() ? t('cmd.tools.stopRun') : t('title.runFile')))
  const handleRunClick = (): void => {
    if (runRunning()) {
      void runCommand('tools.stopRun')
    } else if (terminalBusy()) {
      const id = useTerminalStore.getState().activeId
      if (id) useTerminalStore.getState().interrupt(id)
    } else {
      void runCommand('tools.run')
    }
  }

  /** Show a tab and give it the keyboard focus. */
  const focusTab = (index: number): void => {
    const tab = tabs()[index]
    if (!tab) return
    useAppStore.getState().setActiveTab(tab.id)
    const element = listRef?.querySelector<HTMLElement>(`[data-tab-id="${tab.id}"]`)
    element?.focus()
  }

  /** The arrow keys walk through the tabs, like in every other editor. */
  const onTabKeyDown = (event: KeyboardEvent, index: number): void => {
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      focusTab((index + 1) % Math.max(1, tabs().length))
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      focusTab((index - 1 + tabs().length) % Math.max(1, tabs().length))
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusTab(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusTab(tabs().length - 1)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const tab = tabs()[index]
      if (tab) useAppStore.getState().setActiveTab(tab.id)
    } else if (event.key === 'Delete') {
      event.preventDefault()
      const tab = tabs()[index]
      if (tab) void useAppStore.getState().closeTab(tab.id)
    }
  }

  return (
    <header class="titlebar">
      <Show when={showHamburger()}>
        <button
          class="main-menu-button"
          title={t('title.mainMenu')}
          aria-label={t('title.mainMenu')}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <Icon name="menu" size={16} />
        </button>
      </Show>
      <span class="titlebar-logo" title="FlintQode" data-tauri-drag-region>
        <AppLogo size={17} />
      </span>

      <nav class="titlebar-tabs" role="tablist" aria-label={t('a11y.openFiles')}>
        <div class="titlebar-tab-list" ref={(el) => (listRef = el)}>
          <For each={tabs()}>
            {(tab, index) => (
              <div
                role="tab"
                data-tab-id={tab.id}
                aria-selected={tab.id === activeTabId() ? 'true' : 'false'}
                tabindex={tab.id === activeTabId() ? 0 : -1}
                class={['titlebar-tab', { active: tab.id === activeTabId() }]}
                title={tab.path ?? tab.name}
                onClick={() => useAppStore.getState().setActiveTab(tab.id)}
                onKeyDown={(event) => onTabKeyDown(event, index())}
                onAuxClick={(e) => {
                  if (e.button === 1) void useAppStore.getState().closeTab(tab.id)
                }}
              >
                <Show when={tab.dirty}>
                  <span class="dirty-dot" title={t('common.unsavedChanges')} />
                </Show>
                <FileIcon name={tab.name} theme={iconTheme()} size={13} />
                <span class="label">{tab.name}</span>
                <button
                  class="tab-close"
                  title={t('a11y.closeTab')}
                  aria-label={t('a11y.closeTab')}
                  onClick={(e) => {
                    e.stopPropagation()
                    void useAppStore.getState().closeTab(tab.id)
                  }}
                >
                  <Icon name="close" size={11} />
                </button>
              </div>
            )}
          </For>
        </div>
        <button
          class="titlebar-tab-add"
          title={t('a11y.newTab')}
          aria-label={t('a11y.newTab')}
          onClick={() => useAppStore.getState().newTab()}
        >
          <Icon name="newFile" size={14} />
        </button>
      </nav>

      <div class="titlebar-drag" data-tauri-drag-region />

      <div class="titlebar-actions">
        <button
          class={['icon-btn', { active: useAppStore().sidebarVisible }]}
          title={t('title.toggleProject')}
          aria-label={t('title.toggleProject')}
          onClick={() => void runCommand('view.toggleSidebar')}
        >
          <Icon name="file" />
        </button>
        <button
          class="icon-btn"
          title={t('title.openFile')}
          aria-label={t('title.openFile')}
          onClick={() => void runCommand('file.open')}
        >
          <Icon name="open" />
        </button>
        <button
          class="icon-btn"
          title={t('title.save')}
          aria-label={t('title.save')}
          onClick={() => void runCommand('file.save')}
        >
          <Icon name="save" />
        </button>
        <button
          class="icon-btn"
          title={t('title.searchInFiles')}
          aria-label={t('title.searchInFiles')}
          onClick={() => void runCommand('search.findInFiles')}
        >
          <Icon name="search" />
        </button>
        <button
          class="icon-btn"
          title={t('cmd.view.toggleTerminal')}
          aria-label={t('cmd.view.toggleTerminal')}
          onClick={() => void runCommand('view.toggleTerminal')}
        >
          <Icon name="terminal" />
        </button>
        <button
          class="icon-btn"
          title={t('title.splitView')}
          aria-label={t('title.splitView')}
          onClick={() => void runCommand('view.toggleSplit')}
        >
          <Icon name="split" />
        </button>
        <button
          class="icon-btn"
          title={t('title.commandPalette')}
          aria-label={t('title.commandPalette')}
          onClick={() => void runCommand('view.commandPalette')}
        >
          <Icon name="search" />
        </button>
        <button
          class="icon-btn"
          title={t('title.settings')}
          aria-label={t('title.settings')}
          onClick={() => useAppStore.getState().setDialog('settings', true)}
        >
          <Icon name="settings" />
        </button>
      </div>

      {/* The window frame is drawn by the app, so the controls are ours. */}
      <div class="window-controls">
        <button
          class="window-control"
          title={t('a11y.minimize')}
          aria-label={t('a11y.minimize')}
          onClick={() => window.api.win.minimize()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 5h10" stroke="currentColor" stroke-width="1" />
          </svg>
        </button>
        <button
          class="window-control"
          title={maximized() ? t('a11y.restore') : t('a11y.maximize')}
          aria-label={maximized() ? t('a11y.restore') : t('a11y.maximize')}
          onClick={() => window.api.win.toggleMaximize()}
        >
          <Show
            when={maximized()}
            fallback={
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" stroke-width="1" />
              </svg>
            }
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <rect x="0.5" y="2.5" width="7" height="7" stroke="currentColor" stroke-width="1" />
              <path d="M3 2.5V0.5h7v7H7.5" stroke="currentColor" stroke-width="1" />
            </svg>
          </Show>
        </button>
        <button
          class="window-control close"
          title={t('a11y.closeWindow')}
          aria-label={t('a11y.closeWindow')}
          onClick={() => window.api.win.close()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" stroke-width="1" />
          </svg>
        </button>
      </div>

      <Show when={menuOpen()}>
        <Portal mount={document.body}>
          <MainMenu
            open={menuOpen()}
            profile="coding"
            onClose={() => setMenuOpen(false)}
            onCommand={(id, payload) => {
              void runCommand(id, payload)
            }}
          />
        </Portal>
      </Show>
    </header>
  )
}
