import { For } from 'solid-js'
import type { JSX } from '@solidjs/web'
import { themeGroups, resolveTheme } from '../core/themeResolver'

export interface ThemeGalleryProps {
  value: string
  onChange: (id: string) => void
}

/** A grid of every available colour theme with a small preview. */
export function ThemeGallery(props: ThemeGalleryProps): JSX.Element {
  const groups = themeGroups()
  return (
    <div>
      <For each={groups}>
        {(group) => (
          <div style={{ 'margin-bottom': '14px' }}>
            <div class="panel-header">
              <span>{group.group}</span>
              <span>{group.themes.length}</span>
            </div>
            <div class="theme-gallery">
              <For each={group.themes}>
                {(theme) => {
                  const full = resolveTheme(theme.id)
                  return (
                    <button
                      class={['theme-card', { active: theme.id === props.value }]}
                      onClick={() => props.onChange(theme.id)}
                      title={theme.label}
                    >
                      <span
                        class="theme-card-preview"
                        style={{ background: full.editor.background, color: full.editor.foreground }}
                      >
                        <span style={{ color: full.tokens.keyword }}>if</span>{' '}
                        <span style={{ color: full.tokens.function }}>run</span>
                        <span style={{ color: full.tokens.punctuation }}>(</span>
                        <span style={{ color: full.tokens.number }}>42</span>
                        <span style={{ color: full.tokens.punctuation }}>)</span>{' '}
                        <span style={{ color: full.tokens.string }}>'hi'</span>
                      </span>
                      <span class="theme-card-name">{theme.label}</span>
                    </button>
                  )
                }}
              </For>
            </div>
          </div>
        )}
      </For>
    </div>
  )
}
