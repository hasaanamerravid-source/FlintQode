/** Search across the project, with optional replace-all. */

import { createEffect, createMemo, createSignal, For, Match, Show, Switch } from 'solid-js'
import type { JSX } from '@solidjs/web'
import { useProjectSearchStore, type ProjectMatch } from '../../core/projectSearch'
import { useAppStore } from '../../store/app'
import { appActions, useActivePath, useSettings } from '../../state/solid'
import { folderOfPath } from '../../core/projectConfig'
import { getEditor } from '../../core/editors'
import { useT } from '../../core/i18n'

/** Hits of one file, in the order the native search returned them. */
export type SearchGroup = [path: string, hits: ProjectMatch[]]

/** Hits rendered before the "more" action is used. */
export const SEARCH_RESULT_PAGE_SIZE = 200

/** Group matches by file without changing their order. */
export function groupMatches(matches: ProjectMatch[]): SearchGroup[] {
  const map = new Map<string, ProjectMatch[]>()
  for (const hit of matches) {
    const list = map.get(hit.path) ?? []
    list.push(hit)
    map.set(hit.path, list)
  }
  return [...map.entries()]
}

/**
 * Keep at most `limit` hits, walking the files in order. Grouping and the
 * order of the hits inside a group are unchanged; later hits are withheld
 * until the caller raises the limit.
 */
export function limitGroups(groups: SearchGroup[], limit: number): SearchGroup[] {
  const visible: SearchGroup[] = []
  let remaining = Math.max(0, limit)
  for (const [path, hits] of groups) {
    if (remaining === 0) break
    const shown = hits.slice(0, remaining)
    visible.push([path, shown])
    remaining -= shown.length
  }
  return visible
}

export function SearchView(): JSX.Element {
  const query = createMemo(() => useProjectSearchStore().query)
  const replacement = createMemo(() => useProjectSearchStore().replacement)
  const options = createMemo(() => useProjectSearchStore().options)
  const matches = createMemo(() => useProjectSearchStore().matches)
  const searching = createMemo(() => useProjectSearchStore().searching)
  const files = createMemo(() => useProjectSearchStore().files)
  const took = createMemo(() => useProjectSearchStore().took)
  const error = createMemo(() => useProjectSearchStore().error)
  const searchActions = useProjectSearchStore.getState()
  const openPath = appActions().openPath
  const root = createMemo(() => useAppStore().workspaceRoot)
  const activePath = useActivePath()
  const settings = useSettings()
  const [replaceOpen, setReplaceOpen] = createSignal(false)
  const [visibleLimit, setVisibleLimit] = createSignal(SEARCH_RESULT_PAGE_SIZE)
  const t = useT()

  const folder = createMemo(() => root() ?? settings().projectFolder ?? folderOfPath(activePath()) ?? '')

  createEffect(
    () => ({ query: query(), options: options(), folder: folder() }),
    (source) => {
      setVisibleLimit(SEARCH_RESULT_PAGE_SIZE)
      if (!source.query.trim() || !source.folder) return
      const timer = window.setTimeout(() => void searchActions.search(source.folder), 250)
      return () => window.clearTimeout(timer)
    },
  )

  const groups = createMemo(() => groupMatches(matches()))
  const totals = createMemo(() => new Map(groups().map(([path, hits]) => [path, hits.length])))
  const visibleGroups = createMemo(() => limitGroups(groups(), visibleLimit()))
  const visibleCount = createMemo(() => Math.min(matches().length, visibleLimit()))

  const jump = async (path: string, line: number): Promise<void> => {
    await openPath(path)
    const state = useAppStore.getState()
    const tab = state.tabs.find((entry) => entry.id === state.activeTabId)
    getEditor(tab?.id ?? '')?.goToLine(line)
    getEditor(tab?.id ?? '')?.focus()
  }

  return (
    <div class="panel search-view">
      <div class="workbench-view-bar">
        <span class="panel-title">{t('panel.search')}</span>
        <span class="panel-subtitle">
          <Show
            when={searching()}
            fallback={
              <Show when={matches().length > 0}>
                {t('panel.searchHits', { count: matches().length, files: groups().length })}
              </Show>
            }
          >
            {t('panel.searching')}
          </Show>
        </span>
      </div>
      <div class="search-fields">
        <input
          class="panel-input"
          placeholder={t('panel.searchPlaceholder')}
          value={query()}
          spellcheck="false"
          onInput={(event) => searchActions.setQuery(event.currentTarget.value)}
          onKeyDown={(event) => event.key === 'Enter' && void searchActions.search(folder())}
        />
        <div class="search-options">
          <button
            class={`chip${options().regex ? ' active' : ''}`}
            title={t('panel.searchRegex')}
            onClick={() => searchActions.setOptions({ regex: !options().regex })}
          >
            .*
          </button>
          <button
            class={`chip${options().caseSensitive ? ' active' : ''}`}
            title={t('panel.searchCase')}
            onClick={() => searchActions.setOptions({ caseSensitive: !options().caseSensitive })}
          >
            Aa
          </button>
          <button
            class={`chip${options().wholeWord ? ' active' : ''}`}
            title={t('panel.searchWholeWord')}
            onClick={() => searchActions.setOptions({ wholeWord: !options().wholeWord })}
          >
            ab
          </button>
          <button class="chip" title={t('panel.searchReplaceAll')} onClick={() => setReplaceOpen((open) => !open)}>
            {t('common.replace')}
          </button>
          <input
            class="panel-input"
            placeholder={t('panel.searchGlob')}
            value={options().include}
            onInput={(event) => searchActions.setOptions({ include: event.currentTarget.value })}
          />
        </div>
        <Show when={replaceOpen()}>
          <div class="search-replace">
            <input
              class="panel-input"
              placeholder={t('panel.searchReplaceWith')}
              value={replacement()}
              onInput={(event) => searchActions.setReplacement(event.currentTarget.value)}
            />
            <button class="panel-button" onClick={() => void searchActions.replace(folder())}>
              {t('common.replaceAll')}
            </button>
          </div>
        </Show>
        <Show when={error()}>{(message) => <div class="hint error-text">{message()}</div>}</Show>
      </div>
      <div class="workbench-search-results">
        <Switch>
          <Match when={!folder()}>
            <div class="empty-state">{t('panel.searchOpenFileFirst')}</div>
          </Match>
          <Match when={!searching() && !!query().trim() && matches().length === 0}>
            <div class="empty-state">{t('panel.searchNoResults')}</div>
          </Match>
          <Match when={true}>
            <For each={visibleGroups()}>
              {([path, hits]) => (
                <div class="search-group">
                  <div class="search-file" title={path}>
                    <span>{path.split(/[\\/]/).pop()}</span>
                    <span class="hint">{totals().get(path) ?? hits.length}</span>
                  </div>
                  <For each={hits}>
                    {(hit) => (
                      <button class="search-hit" onClick={() => void jump(hit.path, hit.line)}>
                        <span class="hit-line">{hit.line}</span>
                        <span class="hit-text">{hit.text.trim()}</span>
                      </button>
                    )}
                  </For>
                </div>
              )}
            </For>
          </Match>
        </Switch>
      </div>
      <Show when={matches().length > 0}>
        <div class="hint search-footer">
          {t('panel.searchDuration', { files: files(), ms: took() })}
          <Show when={visibleCount() < matches().length}>
            <button class="chip" onClick={() => setVisibleLimit((limit) => limit + SEARCH_RESULT_PAGE_SIZE)}>
              {t('common.more')}
            </button>
          </Show>
          <button class="chip" onClick={() => searchActions.clear()}>
            {t('common.clear')}
          </button>
        </div>
      </Show>
    </div>
  )
}
