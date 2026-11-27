/** Pure selection ranges, used by the CodeMirror selection commands. */

export interface TextRange {
  from: number
  to: number
}

const WORD = /[\p{L}\p{N}_$]+/gu

/** Word containing `position`, including when the caret sits just after it. */
export function wordRangeAt(text: string, position: number): TextRange | null {
  WORD.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = WORD.exec(text))) {
    if (position >= match.index && position <= match.index + match[0].length) {
      return { from: match.index, to: match.index + match[0].length }
    }
  }
  return null
}

/** Grow a selection to whole words; with an empty caret, select the word. */
export function expandToWord(text: string, from: number, to: number): TextRange | null {
  if (to <= from) return wordRangeAt(text, from)
  const start = wordRangeAt(text, from)
  const end = wordRangeAt(text, to - 1)
  if (!start || !end) return null
  return { from: start.from, to: end.to }
}

/** Grow a selection to the line (or lines) it touches. */
export function expandToLine(text: string, from: number, to: number): TextRange {
  const start = text.lastIndexOf('\n', Math.max(0, from - 1)) + 1
  let end = text.indexOf('\n', Math.max(from, to))
  if (end < 0) end = text.length
  if (text[end - 1] === '\r') end -= 1
  return { from: start, to: Math.max(start, end) }
}

/** Every non-overlapping match of a literal term, in document order. */
export function findAllMatches(text: string, term: string): TextRange[] {
  if (!term) return []
  const ranges: TextRange[] = []
  let index = text.indexOf(term)
  while (index >= 0) {
    ranges.push({ from: index, to: index + term.length })
    index = text.indexOf(term, index + term.length)
  }
  return ranges
}
