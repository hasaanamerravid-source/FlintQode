import { createEffect, createMemo, createSignal, For, Show } from 'solid-js'
import type { JSX } from '@solidjs/web'
import { getCommands, getRecentCommands, runCommand } from '../core/commands'
import { useAppStore } from '../store/app'
import { commandKey, useT, useTWith } from '../core/i18n'

export type PaletteMode = 'commands' | 'files'

function fuzzyScore(query: string, text: string): number {
  if (!query) return 0
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (t.startsWith(q)) return 1000 - t.length
  const direct = t.indexOf(q)
  if (direct >= 0) return 500 - direct - t.length * 0.1
  let score = 0
  let ti = 0
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found < 0) return -1
    score += 20 - Math.min(15, found - ti)
    ti = found + 1
  }
  return score
}

interface PaletteProps {
  open: boolean
  mode: PaletteMode
  onClose: () => void
}

export function CommandPalette(props: PaletteProps): JSX.Element {
  const [query, setQuery] = createSignal('')
  const [selected, setSelected] = createSignal(0)
  let inputRef: HTMLInputElement | undefined
  const workspaceRoot = createMemo(() => useAppStore().workspaceRoot)
  const recentFiles = createMemo(() => useAppStore().settings.recentFiles)
  const t = useT()
  const tWith = useTWith()
  const [projectFiles, setProjectFiles] = createSignal<string[]>([])
  let loadedRoot: string | null = null

  /** Load every file of the current project folder once, so the quick
   * switcher can jump to any file, not just the recent ones.
   * This is what makes FlintQode usable as a code editor: Ctrl+Shift+O finds
   * every file in the folder. */
  createEffect(
    () => ({ mode: props.mode, root: workspaceRoot() }),
    ({ mode, root }) => {
      if (mode !== 'files') return
      if (!root || root === loadedRoot) return
      loadedRoot = root
      let cancelled = false
      void (async () => {
        try {
          const entries = await window.api.fs.listRecursive(root, 12)
          const files = entries
            .filter((e) => !e.isDir)
            .map((e) => e.path)
            // Skip the folders that hold no source code: listing tens of
            // thousands of node_modules files would make the switcher useless.
            .filter(
              (p) => !/[\\/](node_modules|target|dist|build|out|.git|__pycache__|.next|.nuxt|coverage)[\\/]/.test(p),
            )
            .slice(0, 5000)
          if (!cancelled) setProjectFiles(files)
        } catch {
          /* listing the folder is a nice-to-have */
        }
      })()
      return () => {
        cancelled = true
        setProjectFiles([])
        loadedRoot = null
      }
    },
  )

  createEffect(
    () => ({ open: props.open, mode: props.mode }),
    ({ open }) => {
      if (!open) return
      setQuery('')
      setSelected(0)
      const timer = window.setTimeout(() => inputRef?.focus(), 10)
      return () => window.clearTimeout(timer)
    },
  )

  const items = createMemo(() => {
    const currentQuery = query()
    if (props.mode === 'commands') {
      const recentIds = getRecentCommands()
      return getCommands()
        .filter((c) => !c.hidden)
        .map((c) => ({
          id: c.id,
          title: tWith(commandKey(c.id), c.title),
          category: c.category ?? '',
          shortcut: c.shortcut ?? '',
        }))
        .map((c) => ({ ...c, score: fuzzyScore(currentQuery, `${c.category} ${c.title}`) }))
        .filter((c) => c.score >= 0)
        .sort((a, b) => {
          // The commands that were used last come first, as long as the user
          // has not typed anything: a search is a search.
          if (currentQuery) return b.score - a.score
          const aRecent = recentIds.indexOf(a.id)
          const bRecent = recentIds.indexOf(b.id)
          if (aRecent >= 0 && bRecent >= 0) return aRecent - bRecent
          if (aRecent >= 0) return -1
          if (bRecent >= 0) return 1
          return b.score - a.score
        })
        .slice(0, 60)
    }
    const recent = recentFiles().map((f) => ({
      id: f,
      title: f.split(/[\\/]/).pop() ?? f,
      category: f,
      shortcut: '',
    }))
    const files = projectFiles().map((p) => ({
      id: p,
      title: p.split(/[\\/]/).pop() ?? p,
      category: p,
      shortcut: '',
    }))
    return [...recent, ...files]
      .map((c) => ({ ...c, score: fuzzyScore(currentQuery, `${c.category} ${c.title}`) }))
      .filter((c) => c.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 60)
  })

  createEffect(
    () => query(),
    () => {
      setSelected(0)
    },
  )

  const activate = (index: number): void => {
    const item = items()[index]
    if (!item) return
    props.onClose()
    if (props.mode === 'commands') {
      void runCommand(item.id)
    } else {
      void useAppStore.getState().openPath(item.id)
    }
  }

  return (
    <Show when={props.open}>
      <div class="overlay" onMouseDown={props.onClose}>
        <div class="palette" onMouseDown={(e) => e.stopPropagation()}>
          <input
            ref={(el) => (inputRef = el)}
            type="text"
            value={query()}
            aria-label={t('a11y.palette')}
            placeholder={props.mode === 'commands' ? t('palette.commandPlaceholder') : t('palette.filePlaceholder')}
            onInput={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSelected((s) => Math.min(items().length - 1, s + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSelected((s) => Math.max(0, s - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                activate(selected())
              } else if (e.key === 'Escape') {
                e.preventDefault()
                props.onClose()
              }
            }}
          />
          <div class="palette-list">
            <Show when={items().length === 0}>
              <div class="palette-empty">{t('palette.noMatches')}</div>
            </Show>
            <For each={items()} keyed={(item) => item.id}>
              {(item, index) => (
                <div
                  class={['palette-item', { selected: index() === selected() }]}
                  onMouseEnter={() => setSelected(index())}
                  onClick={() => activate(index())}
                >
                  <span class="cmd-title">{item().title}</span>
                  <Show when={item().category}>
                    <span class="cmd-category">{item().category}</span>
                  </Show>
                  <Show when={item().shortcut}>
                    <span class="kbd">{item().shortcut}</span>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </Show>
  )
}
