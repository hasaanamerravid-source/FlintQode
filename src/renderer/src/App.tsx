import { createEffect, createSignal, lazy, Loading, onSettled, Show } from 'solid-js'
import type { JSX } from '@solidjs/web'
import { useAppStore } from './store/app'
import { useTerminalStore } from './core/terminalState'
import { TitleBar } from './components/TitleBar'
import { StatusBar } from './components/StatusBar'
import { Sidebar } from './workbench/Sidebar'
import { ActivityBar } from './workbench/ActivityBar'
import { Dock } from './workbench/Dock'
import { useLspConfiguration } from './core/useProblems'
import { useLspSync } from './core/lspIntegration'
import {
  loadKeybindings,
  parseShortcut,
  readKeybindingsSync,
  setKeybindings,
  setUserDataFolder,
  shortcutOf,
  useKeybindings,
} from './core/keybindings'
import { EditorPane } from './components/editor/EditorPane'
import { CommandPalette } from './components/CommandPalette'
import { SettingsDialog } from './components/SettingsDialog'
import { AboutDialog } from './components/AboutDialog'
import { WelcomeDialog } from './components/WelcomeDialog'
import { Toasts } from './components/Toasts'
import { PromptHost } from './components/PromptHost'
import { registerBuiltinCommands } from './core/builtinCommands'
import { saveTargetOnBlur } from './core/saveBehavior'
import {
  buildShortcutLookup,
  getShortcutMap,
  handledByMenu,
  onCommandsChanged,
  runCommand,
  setMenuAccelerators,
} from './core/commands'
import { useStatusStore } from './store/status'
import { activateEnabledPlugins } from './core/plugins'
import { applyAppearance } from './core/appearance'
import { applyDocumentLocale, useT } from './core/i18n'
import { Modal } from './components/Modal'
import { appActions, statusActions, useActiveTabId, useSettings, useTabs } from './state/solid'

/* Loaded on demand — they are only needed when the user opens them. */
const LazyCompareView = lazy(() => import('./components/panels/CompareView').then((m) => ({ default: m.CompareView })))
const LazyCharacterMap = lazy(() =>
  import('./components/panels/CharacterMap').then((m) => ({ default: m.CharacterMap })),
)

/*
 * The commands are registered before the first render: the shortcuts of the
 * commands are the default bindings, and they have to be known before the
 * keyboard handler reads them.
 */
registerBuiltinCommands()

/** Canonical chord of a binding, in the same shape as `shortcutOf(event)`. */
function chordOf(shortcut: string): string | null {
  const parsed = parseShortcut(shortcut)
  if (!parsed) return null
  return [
    parsed.ctrl ? 'ctrl' : '',
    parsed.shift ? 'shift' : '',
    parsed.alt ? 'alt' : '',
    parsed.meta ? 'meta' : '',
    parsed.key.toLowerCase(),
  ]
    .filter(Boolean)
    .join('+')
}

export default function App(): JSX.Element {
  const ready = () => useAppStore().ready
  const settings = useSettings()
  const tabs = useTabs()
  const activeTabId = useActiveTabId()
  const paletteOpen = () => useAppStore().paletteOpen
  const paletteMode = () => useAppStore().paletteMode
  const sidebarVisible = () => useAppStore().sidebarVisible
  const statusBarVisible = () => useAppStore().statusBarVisible
  const distractionFree = () => useAppStore().distractionFree
  const compareOpen = () => useAppStore().compareOpen
  const compareData = () => useAppStore().compareData
  const charMapOpen = () => useAppStore().charMapOpen
  const externalChange = () => useAppStore().externalChange
  const pendingClose = () => useAppStore().pendingClose
  const bottomPanelVisible = () => useAppStore().bottomPanelVisible
  const [dragging, setDragging] = createSignal(false)
  const t = useT()
  useLspSync()
  useLspConfiguration()

  const status = statusActions()
  const keybindings = useKeybindings()

  // The global keydown handler used to scan every binding and every default
  // shortcut on each key. The lookup is rebuilt only when the bindings or the
  // command registry change.
  let userLookup = new Map<string, string>()
  let defaultLookup = new Map<string, string>()
  const rebuildShortcutLookup = (bindings: Record<string, string>): void => {
    userLookup = buildShortcutLookup(bindings, {}, chordOf)
    defaultLookup = buildShortcutLookup({}, getShortcutMap(), chordOf)
  }

  /* ---------------------------- bootstrap --------------------------- */
  onSettled(() => {
    void appActions()
      .init()
      .then(() => {
        const s = useAppStore.getState()
        void activateEnabledPlugins(s.settings.plugins)
      })
    // The folder of the settings holds the keybindings file.
    void loadKeybindings()
    void window.api.info().then((info) => {
      setUserDataFolder(info.userData)
    })
    // The native menu handles some of the keys itself.
    void window.api.menu
      .accelerators()
      .then(setMenuAccelerators)
      .catch(() => undefined)
    const stop = window.api.onMenuAccelerators(setMenuAccelerators)
    const stopCommands = onCommandsChanged(() => rebuildShortcutLookup(readKeybindingsSync()))
    rebuildShortcutLookup(readKeybindingsSync())
    return () => {
      stop()
      stopCommands()
    }
  })

  // The shortcuts of the user are kept in the keyboard handler.
  createEffect(keybindings, (bindings) => {
    setKeybindings(bindings)
    rebuildShortcutLookup(bindings)
  })

  // Panel visibility owns the terminal lifecycle. Hiding unmounts the xterm
  // views; the store closes their PTYs only when the user asked for that.
  createEffect(
    () => !distractionFree() && bottomPanelVisible(),
    (visible) => {
      void useTerminalStore.getState().handlePanelVisibility(visible)
    },
  )

  // A plugin shows a message with `ctx.toast(...)`.
  onSettled(() => {
    const onToast = (event: Event): void => {
      const detail = (event as CustomEvent<{ message?: string; kind?: 'info' | 'error' | 'success' }>).detail
      if (!detail?.message) return
      appActions().toast(detail.message, detail.kind ?? 'info')
    }
    window.addEventListener('flintqode:toast', onToast)
    return () => window.removeEventListener('flintqode:toast', onToast)
  })

  /* ------------------------------ theme ----------------------------- */
  createEffect(
    () => ({ theme: settings().theme, direction: settings().direction }),
    ({ theme, direction }) => {
      const root = document.documentElement
      const apply = (): void => {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
        const resolved = theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme
        root.setAttribute('data-theme', resolved)
        root.setAttribute('data-direction', direction)
        window.api.win.setTheme(resolved === 'dark' ? '#1e1e28' : '#f6f8fa')
      }
      apply()
      const media = window.matchMedia('(prefers-color-scheme: dark)')
      media.addEventListener('change', apply)
      return () => media.removeEventListener('change', apply)
    },
  )

  /* ----------------------------- language --------------------------- */
  // The document knows which language it is in, so that the screen reader and
  // the browser pick the right spelling rules and the right direction.
  createEffect(
    () => settings().language,
    (language) => applyDocumentLocale(language),
  )

  /* ---------------------------- appearance --------------------------- */
  createEffect(
    () => settings(),
    (current) => applyAppearance(current),
  )

  /* --------------------------- menu visibility ----------------------- */
  createEffect(
    () => settings().mainMenuStyle,
    (style) => {
      // The native Windows menu bar is always reachable with Alt, like in other
      // Windows editors; it only stays visible when the user asks for it.
      const visible = style === 'native' || style === 'both'
      void window.api.win.setMenuBar(visible)
    },
  )

  /* --------------------------- window state --------------------------- */
  onSettled(() => {
    return window.api.win.onMaximizeChange((maximized) => {
      status.set({ maximized })
    })
  })

  /* --------------------------- native menu --------------------------- */
  createEffect(
    () => settings().profile,
    (profile) => {
      void window.api.menu.setProfile(profile)
    },
  )

  /* --------------------------- window title ------------------------- */
  createEffect(
    () => {
      const tab = tabs().find((item) => item.id === activeTabId())
      return tab ? `${tab.dirty ? '● ' : ''}${tab.name}` : 'FlintQode'
    },
    (name) => {
      window.api.win.setTitle(`${name} — FlintQode`)
    },
  )

  /* ------------------------ native menu commands -------------------- */
  onSettled(() => {
    return window.api.onCommand((id, payload) => {
      void runCommand(id, payload)
    })
  })

  createEffect(
    () => settings().recentFiles,
    (recentFiles) => {
      void window.api.menu.setRecent(recentFiles)
    },
  )

  onSettled(() => {
    return window.api.onOpenFiles((paths) => {
      void useAppStore.getState().openPaths(paths)
    })
  })

  /* --------------------------- keyboard ----------------------------- */
  onSettled(() => {
    const onKey = (e: KeyboardEvent): void => {
      const ctrl = e.ctrlKey || e.metaKey
      const s = useAppStore.getState()

      if (e.key === 'Escape' && s.paletteOpen) {
        s.setPalette(false)
        return
      }

      const chord = shortcutOf(e)
      // User bindings win over the defaults. Both are cached by chord, so a
      // key press is two map reads instead of two scans of every shortcut.
      const userCommand = userLookup.get(chord)
      if (userCommand) {
        // The native menu handles some of the keys itself: the command must
        // not run a second time.
        if (handledByMenu(userCommand)) return
        e.preventDefault()
        e.stopPropagation()
        void runCommand(userCommand)
        return
      }

      // The editor has already handled the key (undo, select all, …): the
      // command of the app must not run a second time.
      if (e.defaultPrevented) return

      // The shortcuts of the commands are the default bindings.
      const defaultCommand = defaultLookup.get(chord)
      if (defaultCommand) {
        if (handledByMenu(defaultCommand)) return
        e.preventDefault()
        e.stopPropagation()
        void runCommand(defaultCommand)
        return
      }

      // Alt with the arrow keys walks through the tabs.
      if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault()
        const list = s.tabs
        if (list.length < 2) return
        const index = list.findIndex((item) => item.id === s.activeTabId)
        const next = e.key === 'ArrowRight' ? (index + 1) % list.length : (index - 1 + list.length) % list.length
        s.setActiveTab(list[next].id)
        return
      }

      if (!ctrl) return

      if (e.key === 'Tab') {
        e.preventDefault()
        const list = s.tabs
        if (list.length < 2) return
        const index = list.findIndex((item) => item.id === s.activeTabId)
        const next = e.shiftKey ? (index - 1 + list.length) % list.length : (index + 1) % list.length
        s.setActiveTab(list[next].id)
        return
      }
      if (e.key >= '1' && e.key <= '9') {
        const index = Number(e.key) - 1
        if (s.tabs[index]) {
          e.preventDefault()
          s.setActiveTab(s.tabs[index].id)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* --------------------------- drag & drop --------------------------- */
  onSettled(() => {
    // Tauri intercepts native drops before the DOM sees them and gives us
    // real paths instead of File objects.
    const stopNative = window.api.onDropPaths((paths) => {
      setDragging(false)
      if (paths.length) void useAppStore.getState().openPaths(paths)
    })
    const onDragOver = (e: DragEvent): void => {
      e.preventDefault()
      setDragging(true)
    }
    const onDragLeave = (e: DragEvent): void => {
      if (e.relatedTarget === null) setDragging(false)
    }
    const onDrop = (e: DragEvent): void => {
      e.preventDefault()
      setDragging(false)
      const files = Array.from(e.dataTransfer?.files ?? [])
      const paths = files.map((f) => window.api.pathForFile(f)).filter(Boolean)
      if (paths.length) void useAppStore.getState().openPaths(paths)
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      stopNative()
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  })

  /* ------------------------- session + autosave ---------------------- */
  const persist = (): void => {
    void useAppStore.getState().persistSession()
    // The crash trail keeps unsaved buffers across a crash or exit.
    void useAppStore.getState().saveCrashTrail()
    // Settings are normally auto-saved by the dialog, but a change made by a
    // command or a plugin may land here directly.
    void useAppStore.getState().saveSettings()
  }
  // Power save backs off the periodic session writes; they still run on exit.
  createEffect(
    () => settings().powerSave,
    (powerSave) => {
      const timer = window.setInterval(persist, powerSave ? 60_000 : 15_000)
      return () => window.clearInterval(timer)
    },
  )
  onSettled(() => {
    window.addEventListener('beforeunload', persist)
    return () => {
      window.removeEventListener('beforeunload', persist)
      persist()
    }
  })

  createEffect(
    () => settings().autosaveInterval,
    (interval) => {
      if (!interval) return
      const timer = window.setInterval(() => {
        void useAppStore.getState().saveAll()
      }, interval * 60_000)
      return () => window.clearInterval(timer)
    },
  )

  /* ----------------------------- save on blur ------------------------ */
  // Opt-in: when the window loses focus, save the active file if it is dirty.
  onSettled(() => {
    const onBlur = (): void => {
      const state = useAppStore.getState()
      const id = saveTargetOnBlur(state.settings, state.tabs, state.activeTabId)
      if (id) void state.saveTab(id)
    }
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  })

  /* ------------------------------- zoom ------------------------------ */
  // Zoom polling is cheap on its own, but it is pure background work: stretch
  // it out when the user asks the app to save power.
  createEffect(
    () => settings().powerSave,
    (powerSave) => {
      const timer = window.setInterval(
        () => {
          void window.api.win
            .getZoom()
            .then((zoom) => {
              if (typeof zoom !== 'number' || useStatusStore.getState().zoom === zoom) return
              status.set({ zoom })
            })
            .catch(() => undefined)
        },
        powerSave ? 10_000 : 2000,
      )
      return () => window.clearInterval(timer)
    },
  )

  /* ------------------------- status bar sync ------------------------- */
  // The status bar reads encoding/EOL/language directly from the active tab.
  // Mirroring them into the status store only made every tab write relay into
  // a second version signal, so StatusBar rendered once with stale values.

  return (
    <div class={['app', { 'distraction-free': distractionFree(), dragging: dragging() }]}>
      <TitleBar />
      <div class="app-body">
        <Show when={!distractionFree()}>
          <ActivityBar />
        </Show>
        <Show when={sidebarVisible() && !distractionFree()}>
          <Sidebar />
        </Show>
        <main class="app-main">
          <Show when={compareOpen() && compareData()} fallback={<EditorPane />}>
            {(data) => (
              <Loading fallback={<div class="empty-state">Loading…</div>}>
                <LazyCompareView
                  left={data().left}
                  right={data().right}
                  leftName={data().leftName}
                  rightName={data().rightName}
                  onClose={() => useAppStore.getState().setDialog('compare', false)}
                />
              </Loading>
            )}
          </Show>
        </main>
      </div>
      <Show when={!distractionFree() && bottomPanelVisible()}>
        <Dock />
      </Show>
      <Show when={statusBarVisible() && !distractionFree()}>
        <StatusBar />
      </Show>

      <CommandPalette
        open={paletteOpen()}
        mode={paletteMode()}
        onClose={() => useAppStore.getState().setPalette(false)}
      />
      <SettingsDialog />
      <AboutDialog />
      <WelcomeDialog />
      <PromptHost />
      <Toasts />

      <Show when={externalChange()}>
        {(change) => (
          <Modal
            title={t('dialog.externalChange.title')}
            onClose={() => void useAppStore.getState().resolveExternalChange('keep')}
            footer={
              <>
                <button class="btn btn-ghost" onClick={() => void useAppStore.getState().resolveExternalChange('keep')}>
                  {t('dialog.externalChange.keep')}
                </button>
                <button
                  class="btn btn-primary"
                  onClick={() => void useAppStore.getState().resolveExternalChange('reload')}
                >
                  {t('dialog.externalChange.reload')}
                </button>
                <button
                  class="btn btn-ghost"
                  onClick={() => void useAppStore.getState().resolveExternalChange('compare')}
                >
                  {t('dialog.externalChange.compare')}
                </button>
              </>
            }
          >
            <p class="hint">{t('dialog.externalChange.message', { name: change().name })}</p>
          </Modal>
        )}
      </Show>

      <Show when={pendingClose()}>
        {(request) => (
          <Modal
            title={t('dialog.confirm.unsaved.title')}
            size="small"
            onClose={() => void useAppStore.getState().resolvePendingClose('cancel')}
            footer={
              <>
                <button class="btn btn-ghost" onClick={() => void useAppStore.getState().resolvePendingClose('cancel')}>
                  {t('common.cancel')}
                </button>
                <button
                  class="btn btn-ghost"
                  onClick={() => void useAppStore.getState().resolvePendingClose('discard')}
                >
                  {t('dialog.confirm.unsaved.discard')}
                </button>
                <button class="btn btn-primary" onClick={() => void useAppStore.getState().resolvePendingClose('save')}>
                  {t('common.save')}
                </button>
              </>
            }
          >
            <p>{t('dialog.confirm.unsaved.message', { name: request().name })}</p>
            <p class="hint">{t('dialog.confirm.unsaved.hint')}</p>
          </Modal>
        )}
      </Show>

      <Show when={charMapOpen()}>
        <Modal title={t('dialog.charMap.title')} onClose={() => useAppStore.getState().setDialog('charMap', false)}>
          <Loading fallback={<div class="empty-state">{t('common.loading')}</div>}>
            <LazyCharacterMap
              onInsert={(char) => {
                void runCommand('edit.insertText', char)
              }}
              onClose={() => useAppStore.getState().setDialog('charMap', false)}
            />
          </Loading>
        </Modal>
      </Show>

      <Show when={dragging()}>
        <div class="drag-overlay">{t('title.dropFiles')}</div>
      </Show>
      <Show when={!ready()}>
        <div class="modal-backdrop">
          <div class="modal small" role="dialog" aria-modal="true" aria-label={t('app.name')}>
            <div class="modal-body">{t('common.loading')}</div>
          </div>
        </div>
      </Show>
    </div>
  )
}
