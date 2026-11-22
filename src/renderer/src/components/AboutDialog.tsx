import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { useAppStore } from '../store/app'
import { Modal } from './Modal'
import { useT } from '../core/i18n'
import { LOCALES, translationProgress } from '../core/i18n'
import type { AppInfo } from '@shared/types'

/** The libraries the application is built with. */
const BUILT_WITH = ['Tauri 2', 'Rust', 'React', 'CodeMirror 6', 'Zustand', 'marked', 'diff', 'DOMPurify']

/** The applications the idea comes from. */
const INSPIRED_BY = [
  { name: 'Windows Notepad', what: 'the simplicity of a text editor' },
  { name: 'Notepad++', what: 'the power of a code editor' },
]

export function AboutDialog(): JSX.Element | null {
  const open = useAppStore((s) => s.aboutOpen)
  const setDialog = useAppStore((s) => s.setDialog)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const t = useT()

  useEffect(() => {
    if (open) void window.api.info().then(setInfo)
  }, [open])

  if (!open) return null

  const close = (): void => setDialog('about', false)

  return (
    <Modal title={t('dialog.about.title')} onClose={close}>
      <h2 style={{ marginTop: 0 }}>FlintQode</h2>
      <p className="hint">{t('app.description')}</p>

      <table className="kbd-table">
        <tbody>
          <tr>
            <td>{t('common.version')}</td>
            <td>
              {info?.version ?? '…'}
              {info?.build ? ` · build ${info.build}` : ''}
            </td>
          </tr>
          <tr>
            <td>Commit</td>
            <td>
              <code>{info?.commit ?? '…'}</code>
            </td>
          </tr>
          <tr>
            <td>Tauri</td>
            <td>{info?.tauri ?? '…'}</td>
          </tr>
          <tr>
            <td>WebView</td>
            <td>{info?.webview ?? '…'}</td>
          </tr>
          <tr>
            <td>Runtime</td>
            <td>{info?.runtime ?? '…'}</td>
          </tr>
          <tr>
            <td>{t('common.platform')}</td>
            <td>{info?.platform ?? '…'}</td>
          </tr>
        </tbody>
      </table>

      <h3 style={{ marginBottom: 6 }}>{t('dialog.about.languages')}</h3>
      <p className="hint">{t('dialog.about.languagesHint')}</p>
      <ul className="about-languages">
        {LOCALES.map((locale) => {
          const progress = translationProgress(locale.id)
          return (
            <li key={locale.id}>
              <span className="name">{locale.nativeName}</span>
              <span className="native">{locale.englishName}</span>
              <span className="progress" aria-hidden="true">
                {progress.percent}%
              </span>
            </li>
          )
        })}
      </ul>

      <h3 style={{ marginBottom: 6 }}>{t('dialog.about.builtWith')}</h3>
      <p className="hint">{BUILT_WITH.join(' · ')}</p>

      <h3 style={{ marginBottom: 6 }}>{t('dialog.about.inspiredBy')}</h3>
      <ul className="about-languages">
        {INSPIRED_BY.map((entry) => (
          <li key={entry.name}>
            <span className="name">{entry.name}</span>
            <span className="native">— {entry.what}</span>
          </li>
        ))}
      </ul>

      <p className="hint" style={{ marginTop: 14 }}>
        {t('dialog.about.license')} {t('dialog.about.noTelemetry')}
      </p>
    </Modal>
  )
}
