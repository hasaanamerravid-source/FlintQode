/** Problems list shared by the side bar and the bottom dock. */

import { createMemo, createSignal, For, Show, type Accessor } from 'solid-js'
import type { JSX } from '@solidjs/web'
import { countProblems, type Problem } from '../core/diagnostics'
import { useT } from '../core/i18n'
import { Icon } from '../components/Icons'

const MARKS = { error: '⨯', warning: '⚠', info: 'ℹ' } as const

type SeverityFilter = 'all' | 'error' | 'warning'

export interface ProblemsViewProps {
  problems: Accessor<Problem[]>
  onSelect?: (problem: Problem) => void
}

export function ProblemsView(props: ProblemsViewProps): JSX.Element {
  const [filter, setFilter] = createSignal('')
  const [severity, setSeverity] = createSignal<SeverityFilter>('all')
  const t = useT()
  const counts = createMemo(() => countProblems(props.problems()))

  // Filtering only walks the already computed problem list; it never touches
  // the document or runs diagnostics again.
  const visible = createMemo(() => {
    const needle = filter().trim().toLowerCase()
    const level = severity()
    return props.problems().filter((problem) => {
      if (level === 'error' && problem.severity !== 'error') return false
      if (level === 'warning' && problem.severity !== 'warning') return false
      if (!needle) return true
      return (
        problem.message.toLowerCase().includes(needle) ||
        problem.source.toLowerCase().includes(needle) ||
        `${problem.line}:${problem.column}`.includes(needle)
      )
    })
  })

  const noMatchLabel = (): string => {
    const text = filter().trim()
    if (text) return text
    if (severity() === 'error') return t('panel.problemsSeverityErrors')
    if (severity() === 'warning') return t('panel.problemsSeverityWarnings')
    return t('panel.problemsSeverity')
  }

  const summary = (): string =>
    counts().errors || counts().warnings
      ? t('panel.problemsSummary', { errors: counts().errors, warnings: counts().warnings })
      : t('panel.problemsNone')

  return (
    <div class="panel problems-view">
      <div class="workbench-view-bar">
        <span class="panel-title">{t('panel.problems')}</span>
        <span class="panel-subtitle">{summary()}</span>
        <span class="bar-actions">
          <select
            class="panel-select"
            aria-label={t('panel.problemsSeverity')}
            value={severity()}
            onChange={(event) => setSeverity(event.currentTarget.value as SeverityFilter)}
          >
            <option value="all">{t('panel.problemsSeverityAll')}</option>
            <option value="error">{t('panel.problemsSeverityErrors')}</option>
            <option value="warning">{t('panel.problemsSeverityWarnings')}</option>
          </select>
          <input
            class="panel-input"
            type="search"
            placeholder={t('panel.problemsFilter')}
            value={filter()}
            onInput={(event) => setFilter(event.currentTarget.value)}
          />
        </span>
      </div>
      <div class="workbench-problems-list">
        <Show
          when={visible().length === 0}
          fallback={
            <For each={visible()} keyed={false}>
              {(problem) => (
                <button
                  class={`problem-entry severity-${problem().severity}`}
                  onClick={() => props.onSelect?.(problem())}
                  title={problem().message}
                >
                  <span class="problem-mark">{MARKS[problem().severity]}</span>
                  <span class="problem-position">
                    {problem().line}:{problem().column}
                  </span>
                  <span class="problem-text">{problem().message}</span>
                  <span class="problem-source">{problem().source}</span>
                </button>
              )}
            </For>
          }
        >
          <div class="empty-state">
            <Show when={props.problems().length > 0} fallback={t('panel.problemsEmpty')}>
              {t('panel.problemsNoMatch', { filter: noMatchLabel() })}
            </Show>
          </div>
        </Show>
      </div>
      <div class="hint">
        <Icon name="problems" size={12} /> {t('panel.problemsHint')}
      </div>
    </div>
  )
}
