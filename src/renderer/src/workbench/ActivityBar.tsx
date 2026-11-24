/** The vertical rail that selects the side view. */

import { createMemo, For } from 'solid-js'
import type { JSX } from '@solidjs/web'
import { useAppStore, type SidePanel } from '../store/app'
import { appActions } from '../state/solid'
import { panelAllowed } from '../core/profiles'
import { useT, type MessageKey } from '../core/i18n'
import { Icon, type IconName } from '../components/Icons'

interface Entry {
  id: SidePanel
  label: MessageKey
  icon: IconName
}

const ENTRIES: Entry[] = [
  { id: 'files', label: 'panel.files', icon: 'explorer' },
  { id: 'search', label: 'panel.search', icon: 'search' },
  { id: 'outline', label: 'panel.structure', icon: 'outline' },
  { id: 'problems', label: 'panel.problems', icon: 'problems' },
  { id: 'run', label: 'panel.run', icon: 'terminal' },
  { id: 'plugins', label: 'panel.plugins', icon: 'plugins' },
]

export function ActivityBar(): JSX.Element {
  const panel = createMemo(() => useAppStore().sidePanel)
  const setPanel = appActions().setSidePanel
  const t = useT()
  const entries = createMemo(() => ENTRIES.filter((entry) => panelAllowed(useAppStore().settings.profile, entry.id)))

  return (
    <nav class="workbench-rail" aria-label={t('a11y.sidebar')}>
      <For each={entries()}>
        {(entry) => (
          <button
            class={`workbench-rail-item${panel() === entry.id ? ' active' : ''}`}
            title={t(entry.label)}
            aria-label={t(entry.label)}
            aria-pressed={panel() === entry.id ? 'true' : 'false'}
            onClick={() => setPanel(entry.id)}
          >
            <Icon name={entry.icon} size={20} />
          </button>
        )}
      </For>
      <span class="workbench-rail-spacer" />
    </nav>
  )
}
