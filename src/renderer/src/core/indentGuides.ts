import { type Extension, type Range } from '@codemirror/state'
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view'

/**
 * Indent guides: the leading whitespace of every indented line gets a subtle
 * vertical rule every `tabSize` columns, like Notepad++ does.
 */

export interface VisibleRange {
  from: number
  to: number
}

/** Even a very tall viewport should not turn into thousands of decorations. */
export const MAX_GUIDE_LINES = 5_000

const guide = Decoration.mark({ class: 'cm-indent-guides' })

interface GuideState {
  doc: {
    lines: number
    length?: number
    line(n: number): { from: number; text: string }
    lineAt?(position: number): { number: number }
  }
}

function addLine(marks: Range<Decoration>[], line: { from: number; text: string }, tabSize: number): void {
  const text = line.text
  let indent = 0
  while (indent < text.length && (text[indent] === ' ' || text[indent] === '\t')) indent++
  if (indent >= tabSize) marks.push(guide.range(line.from, line.from + indent))
}

/**
 * Build the guide decorations. With no ranges this scans the first 5,000
 * lines (used by the baseline); the editor passes visible ranges so a keystroke
 * does not rebuild every guide in a large document.
 */
export function buildGuides(state: GuideState, tabSize: number, ranges?: readonly VisibleRange[]): Range<Decoration>[] {
  const marks: Range<Decoration>[] = []
  const canUseRanges = ranges?.length && state.doc.lineAt && state.doc.length !== undefined
  if (!canUseRanges) {
    const limit = Math.min(state.doc.lines, MAX_GUIDE_LINES)
    for (let lineNumber = 1; lineNumber <= limit; lineNumber++) addLine(marks, state.doc.line(lineNumber), tabSize)
    return marks
  }

  const seen = new Set<number>()
  for (const range of ranges) {
    const first = state.doc.lineAt!(Math.max(0, range.from)).number
    const last = state.doc.lineAt!(Math.min(state.doc.length!, range.to)).number
    for (let lineNumber = first; lineNumber <= last && marks.length < MAX_GUIDE_LINES; lineNumber++) {
      if (seen.has(lineNumber)) continue
      seen.add(lineNumber)
      addLine(marks, state.doc.line(lineNumber), tabSize)
    }
  }
  return marks
}

/** Build guides for the viewport and refresh them when the viewport moves. */
export function indentGuidesExtension(options: { tabSize: number; enabled: boolean }): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = options.enabled
          ? Decoration.set(buildGuides(view.state, options.tabSize, view.visibleRanges), true)
          : Decoration.none
      }

      update(update: ViewUpdate): void {
        if (!options.enabled || (!update.docChanged && !update.viewportChanged)) return
        this.decorations = Decoration.set(
          buildGuides(update.view.state, options.tabSize, update.view.visibleRanges),
          true,
        )
      }
    },
    { decorations: (plugin) => plugin.decorations },
  )
}
