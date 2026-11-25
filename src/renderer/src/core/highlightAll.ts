import { StateEffect, type Extension, type Range, type Text } from '@codemirror/state'
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view'

/** Set (or clear) the term whose occurrences should be highlighted. */
export const setHighlightAll = StateEffect.define<string | null>()

const mark = Decoration.mark({ class: 'cm-searchMatch' })

/** A huge document must not create an unbounded decoration set. */
export const MAX_HIGHLIGHT_MATCHES = 2_000

export interface VisibleRange {
  from: number
  to: number
}

/** Merge and widen ranges so a match crossing a viewport edge is still found. */
function mergeRanges(ranges: readonly VisibleRange[], padding: number, length: number): VisibleRange[] {
  if (!ranges.length) return [{ from: 0, to: length }]
  const sorted = [...ranges]
    .map((range) => ({ from: Math.max(0, range.from - padding), to: Math.min(length, range.to + padding) }))
    .sort((a, b) => a.from - b.from)
  const merged: VisibleRange[] = [{ ...sorted[0] }]
  for (let index = 1; index < sorted.length; index++) {
    const range = sorted[index]
    const last = merged[merged.length - 1]
    if (range.from <= last.to) last.to = Math.max(last.to, range.to)
    else merged.push({ ...range })
  }
  return merged
}

/**
 * Build decorations for a term. With no ranges this scans the whole document
 * (used by the baseline and tests); the editor passes only visible ranges so a
 * keystroke never lowercases a megabyte of text.
 */
export function buildHighlightDecorations(
  term: string | null,
  doc: Text,
  ranges?: readonly VisibleRange[],
): DecorationSet {
  if (!term) return Decoration.none
  const needle = term.toLowerCase()
  if (!needle) return Decoration.none
  const found: Range<Decoration>[] = []
  for (const range of mergeRanges(ranges ?? [], needle.length - 1, doc.length)) {
    if (range.from >= range.to) continue
    const haystack = doc.sliceString(range.from, range.to).toLowerCase()
    let index = haystack.indexOf(needle)
    while (index >= 0) {
      const from = range.from + index
      const to = from + needle.length
      // Overlapping widened ranges can report the same match twice.
      if (!found.length || from >= found[found.length - 1].to) found.push(mark.range(from, to))
      if (found.length >= MAX_HIGHLIGHT_MATCHES) break
      index = haystack.indexOf(needle, index + needle.length)
    }
    if (found.length >= MAX_HIGHLIGHT_MATCHES) break
  }
  return found.length ? Decoration.set(found, true) : Decoration.none
}

/** Highlight every occurrence in the viewport, rebuilding only when needed. */
export function highlightAllExtension(): Extension {
  return ViewPlugin.fromClass(
    class {
      term: string | null = null
      decorations: DecorationSet = Decoration.none

      update(update: ViewUpdate): void {
        let changed = update.docChanged || update.viewportChanged
        for (const transaction of update.transactions) {
          for (const effect of transaction.effects) {
            if (effect.is(setHighlightAll)) {
              this.term = effect.value
              changed = true
            }
          }
        }
        if (!changed) return
        this.decorations = buildHighlightDecorations(this.term, update.state.doc, update.view.visibleRanges)
      }
    },
    { decorations: (plugin) => plugin.decorations },
  )
}
