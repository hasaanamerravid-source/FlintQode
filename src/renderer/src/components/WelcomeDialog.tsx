import { createMemo, For, Show } from 'solid-js'
import type { JSX } from '@solidjs/web'
import { useAppStore } from '../store/app'
import { runCommand } from '../core/commands'
import { Modal } from './Modal'
import { useT } from '../core/i18n'
import type { MessageKey } from '@shared/i18n'

/** The shortcuts that are shown when the application starts. */
const SHORTCUTS: [MessageKey, string][] = [
  ['cmd.file.new', 'Ctrl+N'],
  ['cmd.file.open', 'Ctrl+O'],
  ['settings.shortcutSave', 'Ctrl+S / Ctrl+Shift+S'],
  ['cmd.view.commandPalette', 'Ctrl+Shift+P'],
  ['cmd.view.quickSwitcher', 'Ctrl+Shift+O'],
  ['settings.shortcutFind', 'Ctrl+F / Ctrl+H'],
  ['cmd.edit.gotoLine', 'Ctrl+G'],
  ['cmd.view.toggleSidebar', 'Ctrl+Shift+E'],
  ['cmd.view.distractionFree', 'Ctrl+Alt+F'],
  ['cmd.edit.duplicateLine', 'Ctrl+D'],
  ['cmd.view.fullscreen', 'F11'],
]

/** The commands that are offered when the application starts. */
const ACTIONS: [string, MessageKey][] = [
  ['file.new', 'welcome.action.new'],
  ['file.open', 'welcome.action.open'],
  ['file.openFromClipboard', 'welcome.action.clipboard'],
  ['view.commandPalette', 'welcome.action.commands'],
]

export function WelcomeDialog(): JSX.Element {
  const open = createMemo(() => useAppStore().welcomeOpen)
  const recent = createMemo(() => useAppStore().settings.recentFiles)
  const t = useT()

  const close = (): void => useAppStore.getState().setDialog('welcome', false)

  return (
    <Show when={open()}>
      <Modal
        title={t('dialog.welcome.title')}
        onClose={close}
        footer={
          <button class="icon-btn" onClick={close}>
            {t('common.close')}
          </button>
        }
      >
        <p class="hint">{t('dialog.welcome.subtitle')}</p>
        <div style={{ display: 'grid', 'grid-template-columns': '1fr 1fr', gap: '24px' }}>
          <div>
            <h3>{t('welcome.start')}</h3>
            <For each={ACTIONS}>
              {([id, key]) => (
                <button class="panel-item" onClick={() => void runCommand(id)}>
                  <span class="name">{t(key)}</span>
                </button>
              )}
            </For>
            <Show when={recent().length > 0}>
              <h3>{t('welcome.recentFiles')}</h3>
              <For each={recent().slice(0, 8)}>
                {(file) => (
                  <button class="panel-item" title={file} onClick={() => void runCommand('file.openPath', file)}>
                    <span class="name">{file.split(/[\\/]/).pop()}</span>
                    <span class="count">{file}</span>
                  </button>
                )}
              </For>
            </Show>
          </div>
          <div>
            <h3>{t('welcome.shortcuts')}</h3>
            <table class="kbd-table">
              <tbody>
                <For each={SHORTCUTS}>
                  {([key, keys]) => (
                    <tr>
                      <td>{t(key)}</td>
                      <td>
                        <kbd>{keys}</kbd>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </div>
      </Modal>
    </Show>
  )
}
