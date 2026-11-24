/** Problems list shared by the side bar and the bottom dock. */

import { createMemo, createSignal, For, Show, type Accessor } from 'solid-js'
import type { JSX } from '@solidjs/web'
import { countProblems, type Problem } from '../core/diagnostics'
import { useT } from '../core/i18n'
import { Icon } from '../components/Icons'

const MARKS = { error: '⨯', warning: '⚠', info: 'ℹ' } as const

export interface ProblemsViewProps {
  problems: Accessor<Problem[]>
  onSelect?: (problem: Problem) => void
}

export function ProblemsView(props: ProblemsViewProps): JSX.Element {
  const [filter, setFilter] = createSignal('')
  const t = useT()
  const counts = createMemo(() => countProblems(props.problems()))
  const visible = createMemo(() => {
    const needle = filter().trim().toLowerCase()
    if (!needle) return props.problems()
    return props
      .problems()
      .filter(
        (problem) =>
          problem.message.toLowerCase().includes(needle) ||
          problem.source.toLowerCase().includes(needle) ||
          `${problem.line}:${problem.column}`.includes(needle),
      )
  })

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
            <For each={visible()}>
              {(problem) => (
                <button
                  class={`problem-entry severity-${problem.severity}`}
                  onClick={() => props.onSelect?.(problem)}
                  title={problem.message}
                >
                  <span class="problem-mark">{MARKS[problem.severity]}</span>
                  <span class="problem-position">
                    {problem.line}:{problem.column}
                  </span>
                  <span class="problem-text">{problem.message}</span>
                  <span class="problem-source">{problem.source}</span>
                </button>
              )}
            </For>
          }
        >
          <div class="empty-state">
            <Show when={props.problems().length > 0} fallback={t('panel.problemsEmpty')}>
              {t('panel.problemsNoMatch', { filter: filter().trim() })}
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
