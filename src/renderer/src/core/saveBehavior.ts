/** Opt-in save behaviour helpers, kept pure so they can be tested directly. */

import type { Settings } from '@shared/types'

export function shouldSaveAllBeforeRun(settings: Pick<Settings, 'saveAllBeforeRun'>): boolean {
  return settings.saveAllBeforeRun === true
}

/** Id of the active file that should be saved when the window loses focus. */
export function saveTargetOnBlur(
  settings: Pick<Settings, 'saveOnBlur'>,
  tabs: readonly { id: string; path?: string | null; dirty?: boolean }[],
  activeTabId: string | null,
): string | null {
  if (!settings.saveOnBlur || !activeTabId) return null
  const tab = tabs.find((entry) => entry.id === activeTabId)
  return tab?.dirty && tab.path ? tab.id : null
}
