/** Project explorer: a lazily loaded directory tree. */

import { createEffect, createMemo, createSignal, For, Show, type Accessor } from 'solid-js'
import type { JSX } from '@solidjs/web'
import type { DirEntry } from '@shared/types'
import { useAppStore } from '../../store/app'
import { appActions } from '../../state/solid'
import { useT } from '../../core/i18n'
import { FileIcon } from '../../components/FileIcon'

/** A lookup that lowercases each entry name at most once, even across queries. */
export function createLowercaseNameLookup(): (entry: DirEntry) => string {
  const cache = new WeakMap<DirEntry, string>()
  return (entry) => {
    let lower = cache.get(entry)
    if (lower === undefined) {
      lower = entry.name.toLowerCase()
      cache.set(entry, lower)
    }
    return lower
  }
}

/** `needle` is already lowercased by the parent, so nodes never re-case it. */
export function matchesFilter(entry: DirEntry, needle: string, lowercase: (entry: DirEntry) => string): boolean {
  return !needle || lowercase(entry).includes(needle)
}

/** Directories stay visible so their children can still be searched. */
export function filterRootEntries(
  entries: DirEntry[],
  needle: string,
  lowercase: (entry: DirEntry) => string,
): DirEntry[] {
  return entries.filter((entry) => entry.isDir || matchesFilter(entry, needle, lowercase))
}

interface NodeProps {
  entry: DirEntry
  depth: number
  needle: Accessor<string>
  lowercase: (entry: DirEntry) => string
  expanded: Accessor<Set<string>>
  toggle: (path: string) => void
  childrenOf: (path: string) => DirEntry[] | undefined
  load: (path: string) => void
  open: (path: string) => void
  iconTheme: Accessor<string>
}

function TreeNode(props: NodeProps): JSX.Element {
  const isOpen = createMemo(() => props.expanded().has(props.entry.path))
  const children = (): DirEntry[] | undefined => props.childrenOf(props.entry.path)
  const matches = createMemo(() => matchesFilter(props.entry, props.needle(), props.lowercase))
  const childMatches = createMemo(() =>
    (children() ?? []).some((child) => matchesFilter(child, props.needle(), props.lowercase)),
  )
  const t = useT()

  createEffect(
    () => ({ isDir: props.entry.isDir, path: props.entry.path, open: isOpen() }),
    (source) => {
      if (source.isDir && source.open) props.load(source.path)
    },
  )

  return (
    <Show when={matches() || (props.entry.isDir && childMatches())}>
      <div class="explorer-node">
        <div
          class="explorer-row"
          style={{ 'padding-left': `${8 + props.depth * 14}px` }}
          title={props.entry.path}
          onClick={() => {
            if (props.entry.isDir) {
              props.toggle(props.entry.path)
              props.load(props.entry.path)
            } else {
              props.open(props.entry.path)
            }
          }}
          onContextMenu={(event) => {
            event.preventDefault()
            if (!props.entry.isDir) void window.api.fs.showInFolder(props.entry.path)
          }}
        >
          <span class="explorer-arrow">{props.entry.isDir ? (isOpen() ? '▾' : '▸') : ''}</span>
          <FileIcon name={props.entry.name} isDirectory={props.entry.isDir} theme={props.iconTheme()} />
          <span class="explorer-name">{props.entry.name}</span>
        </div>
        <Show when={props.entry.isDir && isOpen()}>
          <div>
            <Show
              when={children() === undefined}
              fallback={
                <For each={children() ?? []}>
                  {(child) => (
                    <TreeNode
                      entry={child}
                      depth={props.depth + 1}
                      needle={props.needle}
                      lowercase={props.lowercase}
                      expanded={props.expanded}
                      toggle={props.toggle}
                      childrenOf={props.childrenOf}
                      load={props.load}
                      open={props.open}
                      iconTheme={props.iconTheme}
                    />
                  )}
                </For>
              }
            >
              <div class="empty-state">{t('panel.loading')}</div>
            </Show>
          </div>
        </Show>
      </div>
    </Show>
  )
}

export function ExplorerView(): JSX.Element {
  const root = createMemo(() => useAppStore().workspaceRoot)
  const roots = createMemo(() => useAppStore().workspaceRoots)
  const [entries, setEntries] = createSignal<DirEntry[]>([])
  const [children, setChildren] = createSignal<Record<string, DirEntry[]>>({})
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set())
  const [filter, setFilter] = createSignal('')
  const actions = appActions()
  const iconTheme = createMemo(() => useAppStore().settings.iconTheme)
  const loading = new Set<string>()
  const t = useT()

  const reload = (path: string, target: 'root' | 'child'): void => {
    void window.api.fs
      .readDir(path)
      .then((list) => {
        if (target === 'root') setEntries(list)
        else setChildren((state) => ({ ...state, [path]: list }))
      })
      .catch(() => {
        if (target === 'root') setEntries([])
        else setChildren((state) => ({ ...state, [path]: [] }))
      })
  }

  createEffect(
    () => root(),
    (currentRoot) => {
      setChildren({})
      if (currentRoot) reload(currentRoot, 'root')
      else setEntries([])
    },
  )

  const load = (path: string): void => {
    if (children()[path] !== undefined || loading.has(path)) return
    loading.add(path)
    void window.api.fs
      .readDir(path)
      .then((list) => setChildren((state) => ({ ...state, [path]: list })))
      .catch(() => setChildren((state) => ({ ...state, [path]: [] })))
      .finally(() => loading.delete(path))
  }

  const toggle = (path: string): void => {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const chooseFolder = async (add: boolean): Promise<string | null> => {
    const result = await window.api.fs.openDialog({ title: t('panel.filesOpenFolderTitle'), directory: true })
    const folder = result.filePaths[0]
    if (!folder) return null
    if (add) actions.setWorkspaceRoots([...new Set([...roots(), folder])])
    else {
      actions.setWorkspaceRoot(folder)
      actions.toast(t('panel.filesWorkspace', { name: folder.split(/[\\/]/).pop() ?? '' }), 'success')
    }
    return folder
  }

  const needle = createMemo(() => filter().toLowerCase())
  const lowercase = createLowercaseNameLookup()
  const visible = createMemo(() => filterRootEntries(entries(), needle(), lowercase))
  const extraRoots = createMemo(() => roots().filter((item) => item !== root()))

  return (
    <div class="panel explorer-view">
      <div class="workbench-view-bar">
        <span class="panel-title" title={root() ?? undefined}>
          {root() ? root()?.split(/[\\/]/).pop() : t('panel.filesExplorer')}
        </span>
        <span class="bar-actions">
          <button class="icon-btn" title={t('panel.filesChangeFolder')} onClick={() => void chooseFolder(false)}>
            ⤓
          </button>
          <button class="icon-btn" title={t('panel.filesAddFolder')} onClick={() => void chooseFolder(true)}>
            +
          </button>
          <button
            class="icon-btn"
            title={t('panel.filesRefresh')}
            onClick={() => {
              const current = root()
              if (current) reload(current, 'root')
            }}
          >
            ⟳
          </button>
        </span>
      </div>
      <input
        class="panel-input explorer-filter"
        placeholder={t('panel.filesFilter')}
        value={filter()}
        onInput={(event) => setFilter(event.currentTarget.value)}
      />
      <Show when={extraRoots().length > 0}>
        <div class="explorer-roots">
          <For each={extraRoots()}>
            {(item) => (
              <button
                title={item}
                onClick={() => actions.setWorkspaceRoots([...roots().filter((r) => r !== item), item])}
              >
                {item.split(/[\\/]/).pop() ?? item}
              </button>
            )}
          </For>
        </div>
      </Show>
      <div class="workbench-explorer-list">
        <Show
          when={root()}
          fallback={
            <div class="empty-state">
              {t('panel.filesNoFolder')}
              <button class="panel-button" onClick={() => void chooseFolder(false)}>
                {t('panel.filesOpenFolder')}
              </button>
            </div>
          }
        >
          <For each={visible()}>
            {(entry) => (
              <TreeNode
                entry={entry}
                depth={0}
                needle={needle}
                lowercase={lowercase}
                expanded={expanded}
                toggle={toggle}
                childrenOf={(path) => children()[path]}
                load={load}
                open={(path) => void actions.openPath(path)}
                iconTheme={iconTheme}
              />
            )}
          </For>
        </Show>
      </div>
    </div>
  )
}
