/** Structure view: headings and common declarations of the active file. */

import { createMemo, For, Show } from 'solid-js'
import type { JSX } from '@solidjs/web'
import { useT } from '../../core/i18n'

export interface OutlineViewProps {
  content: string
  title?: string
  onOpenLine?: (line: number) => void
}

interface SymbolEntry {
  label: string
  line: number
  depth: number
  kind: string
}

const DECLARATION =
  /^\s*(?:(?:export|public|private|protected|async|static|final|abstract)\s+)*(?:class|interface|enum|struct|function|def|fn|impl|trait|type|const)\s+([A-Za-z_$][\w$]*)/
const MARKDOWN_HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*$/

function symbolsOf(source: string): SymbolEntry[] {
  const lines = source.split(/\r?\n/)
  let fence = ''
  const out: SymbolEntry[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)
    if (marker) {
      const char = marker[1][0]
      if (!fence) fence = char
      else if (char === fence) fence = ''
      continue
    }
    if (fence) continue
    const heading = MARKDOWN_HEADING.exec(line)
    if (heading) {
      out.push({
        label: heading[2].replace(/`/g, '').trim() || '…',
        line: index + 1,
        depth: heading[1].length - 1,
        kind: `H${heading[1].length}`,
      })
      continue
    }
    const declaration = DECLARATION.exec(line)
    if (declaration) {
      out.push({ label: declaration[1], line: index + 1, depth: /^\s+/.test(line) ? 1 : 0, kind: '◆' })
    }
  }
  return out
}

export function OutlineView(props: OutlineViewProps): JSX.Element {
  const entries = createMemo(() => symbolsOf(props.content))
  const t = useT()

  return (
    <div class="panel outline-view">
      <div class="workbench-view-bar">
        <span class="panel-title">{t('panel.outline')}</span>
        <span class="panel-subtitle">{props.title}</span>
      </div>
      <div class="workbench-outline-list">
        <Show
          when={entries().length === 0}
          fallback={
            <For each={entries()}>
              {(entry) => (
                <button
                  class="outline-entry"
                  style={{ 'padding-left': `${10 + entry.depth * 14}px` }}
                  title={t('panel.outlineLine', { line: entry.line })}
                  onClick={() => props.onOpenLine?.(entry.line)}
                >
                  <span class="outline-label">{entry.label || t('panel.outlineUntitled')}</span>
                  <span class="outline-kind">{entry.kind}</span>
                </button>
              )}
            </For>
          }
        >
          <div class="empty-state">{t('panel.outlineEmpty')}</div>
        </Show>
      </div>
    </div>
  )
}
