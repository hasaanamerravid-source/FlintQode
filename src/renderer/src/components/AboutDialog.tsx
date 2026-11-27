import { createEffect, createMemo, createSignal, For, Show } from 'solid-js'
import type { JSX } from '@solidjs/web'
import { useAppStore } from '../store/app'
import { Modal } from './Modal'
import { useT } from '../core/i18n'
import { LOCALES, translationProgress } from '../core/i18n'
import type { AppInfo } from '@shared/types'

/** The libraries the application is built with. */
const BUILT_WITH = ['Tauri 2', 'Rust', 'SolidJS 2', 'CodeMirror 6', 'marked', 'diff', 'DOMPurify']

/** The applications the idea comes from. */
const INSPIRED_BY = [
  { name: 'Windows Notepad', what: 'simple text editing' },
  { name: 'Notepad++', what: 'code editing' },
]

export function AboutDialog(): JSX.Element {
  const open = createMemo(() => useAppStore().aboutOpen)
  const [info, setInfo] = createSignal<AppInfo | null>(null)
  const t = useT()

  createEffect(
    () => open(),
    (isOpen) => {
      if (isOpen) void window.api.info().then(setInfo)
    },
  )

  const close = (): void => useAppStore.getState().setDialog('about', false)

  return (
    <Show when={open()}>
      <Modal title={t('dialog.about.title')} onClose={close}>
        <h2 style={{ 'margin-top': '0' }}>FlintQode</h2>
        <p class="hint">{t('app.description')}</p>

        <table class="kbd-table">
          <tbody>
            <tr>
              <td>{t('common.version')}</td>
              <td>
                {info()?.version ?? '…'}
                {info()?.build ? ` · build ${info()!.build}` : ''}
              </td>
            </tr>
            <tr>
              <td>Commit</td>
              <td>
                <code>{info()?.commit ?? '…'}</code>
              </td>
            </tr>
            <tr>
              <td>Tauri</td>
              <td>{info()?.tauri ?? '…'}</td>
            </tr>
            <tr>
              <td>WebView</td>
              <td>{info()?.webview ?? '…'}</td>
            </tr>
            <tr>
              <td>Runtime</td>
              <td>{info()?.runtime ?? '…'}</td>
            </tr>
            <tr>
              <td>{t('common.platform')}</td>
              <td>{info()?.platform ?? '…'}</td>
            </tr>
          </tbody>
        </table>

        <h3 style={{ 'margin-bottom': '6px' }}>{t('dialog.about.languages')}</h3>
        <p class="hint">{t('dialog.about.languagesHint')}</p>
        <ul class="about-languages">
          <For each={LOCALES}>
            {(locale) => {
              const progress = translationProgress(locale.id)
              return (
                <li>
                  <span class="name">{locale.nativeName}</span>
                  <span class="native">{locale.englishName}</span>
                  <span class="progress" aria-hidden="true">
                    {progress.percent}%
                  </span>
                </li>
              )
            }}
          </For>
        </ul>

        <h3 style={{ 'margin-bottom': '6px' }}>{t('dialog.about.builtWith')}</h3>
        <p class="hint">{BUILT_WITH.join(' · ')}</p>

        <h3 style={{ 'margin-bottom': '6px' }}>{t('dialog.about.inspiredBy')}</h3>
        <ul class="about-languages">
          <For each={INSPIRED_BY}>
            {(entry) => (
              <li>
                <span class="name">{entry.name}</span>
                <span class="native">— {entry.what}</span>
              </li>
            )}
          </For>
        </ul>

        <p class="hint" style={{ 'margin-top': '14px' }}>
          {t('dialog.about.license')} {t('dialog.about.noTelemetry')}
        </p>
      </Modal>
    </Show>
  )
}
