/** Recent workspace folders are kept in settings, newest first. */

import type { Settings } from '@shared/types'

const MAX_RECENT_WORKSPACES = 10

/** Add a folder to the front of the list without duplicates. */
export function rememberWorkspace(recent: string[] | undefined, folder: string | null | undefined): string[] {
  if (!folder) return [...(recent ?? [])]
  return [folder, ...(recent ?? []).filter((entry) => entry !== folder)].slice(0, MAX_RECENT_WORKSPACES)
}

/** The folder to reopen, if any. */
export function lastWorkspace(settings: Pick<Settings, 'recentWorkspaces'>): string | null {
  return settings.recentWorkspaces?.[0] ?? null
}
