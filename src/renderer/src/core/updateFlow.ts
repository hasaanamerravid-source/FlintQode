/**
 * The in-app update flow, kept free of Solid and DOM APIs so it can be tested
 * directly. The Settings dialog supplies the native bridge, the translated
 * strings and the in-app confirm dialog.
 */

import type { MessageKey } from '@shared/i18n'
import type { AppInfo } from '@shared/types'

export interface UpdateCandidate {
  version: string
  url: string
  assetName: string
  sha256: string
}

export interface UpdateApi {
  info: () => Promise<AppInfo>
  checkUpdate: (currentVersion: string) => Promise<UpdateCandidate | null>
  downloadUpdate: (url: string, dest: string, sha256: string) => Promise<string>
  installUpdate: (path: string, sha256: string) => Promise<string>
}

export interface UpdateFlowDeps {
  api: UpdateApi
  confirm: (title: string, message: string, confirmLabel: string) => Promise<boolean>
  text: (key: MessageKey, params?: Record<string, string>) => string
  status: (message: string) => void
  busy: (busy: boolean) => void
}

/** The destination is kept in the app's temp folder, with one name per flow. */
export function updateDestination(temp: string): string {
  const folder = temp.replace(/[\\/]+$/, '') || '/tmp'
  return `${folder}/flintqode-update.deb`
}

/**
 * Check, download and optionally install an update. Every prompt is awaited
 * through the injected in-app confirm, so the webview never blocks.
 */
export async function runUpdateFlow(deps: UpdateFlowDeps): Promise<void> {
  const { api, confirm: ask, text, status, busy } = deps

  busy(true)
  status(text('settings.updatesChecking'))

  try {
    const app = await api.info()
    const update = await api.checkUpdate(app.version)

    if (!update) {
      status(text('settings.updatesUpToDate'))
      return
    }

    if (!update.sha256) {
      throw new Error(text('settings.updatesChecksumMissing'))
    }
    status(text('settings.updatesAvailable', { version: update.version }))

    // The user is choosing whether to download; the button is free while the
    // in-app dialog is open.
    busy(false)
    const download = await ask(
      text('settings.title'),
      text('settings.updatesDownloadPrompt', { version: update.version }),
      text('common.yes'),
    )
    if (!download) return

    busy(true)
    status(text('settings.updatesDownloading'))
    const destination = updateDestination(app.temp)
    await api.downloadUpdate(update.url, destination, update.sha256)
    status(text('settings.updatesDownloaded'))

    busy(false)
    const install = await ask(text('settings.title'), text('settings.updatesInstallPrompt'), text('common.yes'))
    if (!install) return

    busy(true)
    status(text('settings.updatesInstalling'))
    await api.installUpdate(destination, update.sha256)
    status(text('settings.updatesInstalled'))
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    status(`${text('settings.updatesFailed', { error: reason })} ${text('settings.updatesFailedHint')}`)
  } finally {
    busy(false)
  }
}
