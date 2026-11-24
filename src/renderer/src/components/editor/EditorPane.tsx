import type { JSX } from '@solidjs/web'
import { Loading, Show, For, createEffect, createMemo, createSignal, lazy } from 'solid-js'
import type { EditorView } from '@codemirror/view'
import { useAppStore } from '../../store/app'
import { CodeEditor } from './CodeEditor'
import { runCommand } from '../../core/commands'
import { AppLogo } from '../AppLogo'
import { Icon } from '../Icons'
import { useT } from '../../core/i18n'
import { appActions, useActiveTab, useSettings } from '../../state/solid'

/*
 * Heavy parts of the UI are loaded on demand: the markdown preview and the
 * minimap are not needed to open a text file, and on a small machine every
 * megabyte of JavaScript counts.
 */
const MarkdownPreview = lazy(() => import('./MarkdownPreview').then((m) => ({ default: m.MarkdownPreview })))
const Minimap = lazy(() => import('./Minimap').then((m) => ({ default: m.Minimap })))

function PreviewLoading(): JSX.Element {
  return <div class="empty-state">Loading…</div>
}

function ViewSwitcher(props: { view: string; onChange: (v: 'source' | 'preview' | 'split') => void }): JSX.Element {
  const options: { id: 'source' | 'preview' | 'split'; label: string }[] = [
    { id: 'source', label: 'Source' },
    { id: 'split', label: 'Split' },
    { id: 'preview', label: 'Preview' },
  ]
  return (
    <div style={{ display: 'flex', gap: '2px', padding: '2px 6px', background: 'var(--bg-elevated)' }}>
      <For each={options}>
        {(o) => (
          <button
            class={['tb-btn', { active: props.view === o.id }]}
            onClick={() => props.onChange(o.id)}
            title={`${o.label} view`}
          >
            {o.label}
          </button>
        )}
      </For>
    </div>
  )
}

export function EditorPane(): JSX.Element {
  const activeTab = useActiveTab()
  const settings = useSettings()
  const splitView = createMemo(() => useAppStore().splitView)
  const t = useT()

  let editorView: EditorView | null = null
  const [source, setSource] = createSignal('')
  let splitRatio = 0.5
  let splitEl!: HTMLDivElement

  createEffect(
    () => useAppStore().activeTabId,
    (activeTabId) => {
      // Read the freshest content from the store: the previous editor flushes its
      // buffer into the store while unmounting, so the preview is never stale.
      const fresh = useAppStore.getState().tabs.find((entry) => entry.id === activeTabId)
      setSource(fresh?.content ?? '')
      editorView = null
    },
  )

  const handleContentChange = (text: string): void => {
    setSource(text)
  }

  return (
    <Show
      when={activeTab()}
      fallback={
        <div class="editor-pane welcome-pane">
          <div class="welcome-card">
            <AppLogo size={48} />
            <h1>{t('app.name')}</h1>
            <p class="welcome-tagline">{t('app.description')}</p>

            <div class="welcome-actions">
              <button class="welcome-action primary" onClick={() => void runCommand('file.open')}>
                <Icon name="open" size={16} />
                <span>{t('welcome.action.open')}</span>
                <kbd>Ctrl O</kbd>
              </button>
              <button class="welcome-action" onClick={() => void runCommand('file.new')}>
                <Icon name="newFile" size={16} />
                <span>{t('welcome.action.new')}</span>
                <kbd>Ctrl N</kbd>
              </button>
              <button class="welcome-action" onClick={() => void runCommand('view.commandPalette')}>
                <Icon name="search" size={16} />
                <span>{t('welcome.action.commands')}</span>
                <kbd>Ctrl Shift P</kbd>
              </button>
            </div>

            <p class="welcome-hint">Drag files here, or open a folder from the sidebar to search a whole project.</p>
          </div>
        </div>
      }
    >
      {(tab) => {
        const startSplitDrag = (e: MouseEvent): void => {
          e.preventDefault()
          const container = splitEl?.parentElement
          if (!container) return
          const move = (ev: MouseEvent): void => {
            const rect = container.getBoundingClientRect()
            splitRatio = Math.min(0.85, Math.max(0.15, (ev.clientX - rect.left) / rect.width))
            if (splitEl) splitEl.style.flexBasis = `${splitRatio * 100}%`
          }
          const up = (): void => {
            document.removeEventListener('mousemove', move)
            document.removeEventListener('mouseup', up)
          }
          document.addEventListener('mousemove', move)
          document.addEventListener('mouseup', up)
        }

        const showSource = (): boolean => tab().view !== 'preview'
        const showPreview = (): boolean => tab().view !== 'source' && tab().mode === 'markdown'

        /** Resolve a relative link of the preview against the folder of the file. */
        const openRelativeLink = (target: string): void => {
          const clean = target.replace(/^#.*$/, '')
          if (!clean) return
          if (/^[a-z]+:\/\//i.test(clean)) {
            window.open(clean, '_blank', 'noopener,noreferrer')
            return
          }
          const current = tab()
          const dir = current.path
            ? current.path.replace(/[\\/][^\\/]*$/, '')
            : (useAppStore.getState().workspaceRoot ?? '')
          if (!dir) return
          void useAppStore.getState().openPath(`${dir}/${clean.replace(/^\.\//, '')}`)
        }

        return (
          <div class="editor-pane">
            <Show when={tab().largeFile}>
              <div class="large-file-banner">
                <Icon name="warning" size={13} />
                <span>
                  Large file
                  {tab().size ? ` (${((tab().size ?? 0) / 1024 / 1024).toFixed(1)} MB)` : ''} — opened read-only, syntax
                  highlighting is off
                  {tab().truncatedBytes
                    ? `, showing the first ${(((tab().size ?? 0) - (tab().truncatedBytes ?? 0)) / 1024 / 1024).toFixed(0)} MB — saving is disabled to avoid data loss`
                    : ''}
                  .
                </span>
              </div>
            </Show>
            <Show when={tab().mode === 'markdown'}>
              <ViewSwitcher view={tab().view} onChange={(v) => appActions().updateTab(tab().id, { view: v })} />
            </Show>
            <div class="split-view">
              <Show when={showSource()}>
                <div class="editor-pane">
                  <CodeEditor
                    tab={tab()}
                    onContentChange={handleContentChange}
                    onViewReady={(view) => {
                      editorView = view
                    }}
                  />
                  <Show when={settings().showMinimap && !settings().lowMemory}>
                    <Loading fallback={null}>
                      <Minimap getView={() => editorView} width={settings().minimapWidth} />
                    </Loading>
                  </Show>
                </div>
              </Show>
              <Show when={showSource() && splitView()}>
                <div class="split-divider" title="Both panes edit the same buffer" />
              </Show>
              <Show when={showSource() && splitView()}>
                <div class="editor-pane">
                  <CodeEditor tab={tab()} onContentChange={handleContentChange} />
                </div>
              </Show>
              <Show when={showSource() && showPreview()}>
                <div
                  class="split-divider"
                  ref={(el) => {
                    splitEl = el
                  }}
                  onMouseDown={startSplitDrag}
                  title="Drag to resize"
                />
              </Show>
              <Show when={showPreview()}>
                <div class="editor-pane">
                  <Loading fallback={<PreviewLoading />}>
                    <MarkdownPreview source={source()} onOpenLink={openRelativeLink} />
                  </Loading>
                </div>
              </Show>
            </div>
          </div>
        )
      }}
    </Show>
  )
}
