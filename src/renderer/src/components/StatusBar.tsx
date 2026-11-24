import { createEffect, createMemo, createSignal, For, Match, Show, Switch } from 'solid-js'
import type { JSX } from '@solidjs/web'
import { useAppStore } from '../store/app'
import { useStatusStore } from '../store/status'
import { runCommand } from '../core/commands'
import { useProblems } from '../core/useProblems'
import { useLspStore } from '../core/lspState'
import { Icon } from './Icons'
import { ENCODING_LABELS, EOL_LABELS } from '../core/defaults'
import { languageLabel, LANGUAGE_IDS } from '../core/languages'
import { useT } from '../core/i18n'
import { useActiveTabId, useTabs } from '../state/solid'

interface MenuItem {
  label: string
  value: string
  active?: boolean
}

interface StatusMenuProps {
  label: JSX.Element
  title: string
  items: MenuItem[]
  onPick: (value: string) => void
}

function StatusMenu(props: StatusMenuProps): JSX.Element {
  const [open, setOpen] = createSignal(false)
  let el: HTMLDivElement | undefined

  createEffect(
    () => open(),
    (isOpen) => {
      if (!isOpen) return
      const close = (e: MouseEvent): void => {
        if (el && !el.contains(e.target as Node)) setOpen(false)
      }
      document.addEventListener('mousedown', close)
      return () => document.removeEventListener('mousedown', close)
    },
  )

  return (
    <div class="stat" ref={(node) => (el = node)} style={{ position: 'relative' }}>
      <button class="stat" title={props.title} onClick={() => setOpen(!open())}>
        {props.label}
      </button>
      <Show when={open()}>
        <div
          class="palette"
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            width: '240px',
            'max-height': '50vh',
            'margin-bottom': '4px',
          }}
        >
          <div class="palette-list">
            <For each={props.items}>
              {(item) => (
                <div
                  class={['palette-item', { selected: item.active }]}
                  onClick={() => {
                    setOpen(false)
                    props.onPick(item.value)
                  }}
                >
                  <span class="cmd-title">{item.label}</span>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  )
}

/**
 * The state of the language server of the active file: it tells the user if
 * the server runs, if it is starting and if it is missing.
 */
function LspStatus(): JSX.Element {
  const language = createMemo(() => {
    const state = useAppStore()
    return state.tabs.find((entry) => entry.id === state.activeTabId)?.language ?? ''
  })
  const status = createMemo(() => useLspStore().status[language()])
  const t = useT()

  return (
    <Show when={status()}>
      {(current) => (
        <Switch fallback={null}>
          <Match when={current().state === 'ready'}>
            <span class="stat" title={t('status.lspRunning', { language: language() })}>
              LSP ✓
            </span>
          </Match>
          <Match when={current().state === 'starting'}>
            <span class="stat" title={t('status.lspStarting', { language: language() })}>
              LSP …
            </span>
          </Match>
          <Match when={current().state === 'error'}>
            <span class="stat" title={current().message ?? t('status.lspUnavailable')}>
              LSP ✕
            </span>
          </Match>
        </Switch>
      )}
    </Show>
  )
}

export function StatusBar(): JSX.Element {
  const status = useStatusStore
  const tabs = useTabs()
  const activeTabId = useActiveTabId()
  const problems = useProblems()
  const tab = createMemo(() => tabs().find((entry) => entry.id === activeTabId()))
  const gitBranch = createMemo(() => useStatusStore().gitBranch)
  const gitDirty = createMemo(() => useStatusStore().gitDirty)
  const t = useT()

  // Show the current branch of the repo the active file lives in.
  createEffect(
    () => tab()?.path ?? '',
    (path) => {
      if (!path) return
      void window.api.git
        ?.status(path)
        .then((result) => {
          useStatusStore.getState().set({
            gitBranch: result.status?.branch ?? '',
            gitDirty: result.status?.dirty ?? false,
          })
        })
        .catch(() => undefined)
    },
  )

  const encodings = createMemo(() =>
    Object.entries(ENCODING_LABELS).map(([value, label]) => ({
      label,
      value,
      active: tab()?.encoding === value,
    })),
  )

  const languages = createMemo(() =>
    LANGUAGE_IDS.map((id) => ({
      label: languageLabel(id),
      value: id,
      active: tab()?.language === id,
    })),
  )

  const eols = createMemo(() =>
    (Object.keys(EOL_LABELS) as string[]).map((eol) => ({
      label: EOL_LABELS[eol as keyof typeof EOL_LABELS],
      value: eol,
      active: tab()?.eol === eol,
    })),
  )

  const errors = createMemo(() => problems().filter((p) => p.severity === 'error').length)
  const warnings = createMemo(() => problems().filter((p) => p.severity === 'warning').length)

  return (
    <footer class="statusbar" aria-label={t('a11y.statusBar')}>
      <span class="stat" title={t('status.cursorPosition')}>
        {t('status.position', { line: status().line, column: status().col })}
      </span>
      <Show when={status().selChars > 0}>
        <span class="stat" title={t('status.selectedCharacters')}>
          {t('status.selectionFormat', { chars: status().selChars, lines: status().selLines + 1 })}
        </span>
      </Show>
      <span class="stat" title={t('status.documentSize')}>
        {t('status.linesCount', { count: status().totalLines })} · {t('status.wordsCount', { count: status().words })} ·{' '}
        {t('status.charsCount', { count: status().totalChars })}
      </span>
      <Show when={gitBranch()}>
        <span
          class="stat"
          title={t('status.gitBranch', { branch: gitBranch() })}
          onClick={() => void window.api.git?.log(tab()?.path ?? '', 10).catch(() => undefined)}
        >
          ⏪ {gitBranch()}
          <Show when={gitDirty()}>{' ●'}</Show>
        </span>
      </Show>
      <span class="spacer" />
      <Show when={errors() > 0 || warnings() > 0}>
        <button
          class="stat"
          title={t('status.showProblems')}
          onClick={() => {
            useAppStore.getState().setBottomTab('problems')
            useAppStore.getState().setBottomPanelVisible(true)
          }}
        >
          <Icon name="error" size={12} /> {errors()} · <Icon name="warning" size={12} /> {warnings()}
        </button>
      </Show>
      <LspStatus />
      <StatusMenu
        title={t('status.lineEnding')}
        label={`EOL: ${tab() ? EOL_LABELS[tab()!.eol] : 'LF (Unix)'}`}
        items={eols()}
        onPick={(value) => {
          if (tab()) useAppStore.getState().updateTab(tab()!.id, { eol: value as never })
        }}
      />
      <StatusMenu
        title={t('status.encoding')}
        label={tab() ? (ENCODING_LABELS[tab()!.encoding] ?? tab()!.encoding) : 'UTF-8'}
        items={encodings()}
        onPick={(value) => {
          if (tab()) useAppStore.getState().updateTab(tab()!.id, { encoding: value })
        }}
      />
      <StatusMenu
        title={t('status.language')}
        label={tab() ? languageLabel(tab()!.language) : t('status.plainText')}
        items={languages()}
        onPick={(value) => {
          if (tab()) useAppStore.getState().updateTab(tab()!.id, { language: value })
        }}
      />
      <button class="stat" title={t('status.zoom')} onClick={() => void runCommand('view.zoomReset')}>
        {Math.round(status().zoom * 100)}%
      </button>
    </footer>
  )
}
