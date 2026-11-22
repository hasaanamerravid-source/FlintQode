/**
 * Git diff gutter markers for the editor.
 *
 * Fetches the unified diff of the active file from the main process and turns
 * the changed lines into green (+) and red (-) line decorations.
 */

import { EditorView, ViewPlugin, ViewUpdate, Decoration, type DecorationSet } from '@codemirror/view'
import type { Range } from '@codemirror/state'
import type { Text } from '@codemirror/state'
import type { Extension } from '@codemirror/state'

export const addedMarker = Decoration.line({ class: 'cm-git-added' })
export const removedMarker = Decoration.line({ class: 'cm-git-removed' })

/** Parse a unified diff into a list of `[zeroBasedLineIndex, kind]`. */
export function parseDiff(diff: string): Map<number, '+' | '-'> {
  const result = new Map<number, '+' | '-'>()
  if (!diff) return result
  let newLine = -1
  for (const rawLine of diff.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
    if (match) {
      newLine = Math.max(0, Number(match[3]) - 1)
      continue
    }
    if (newLine < 0) continue
    if (line.startsWith('+') && !line.startsWith('+++')) {
      result.set(newLine, '+')
      newLine += 1
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      result.set(newLine, '-')
    } else if (line.startsWith('\\')) {
      // "\ No newline at end of file" — do not advance.
    } else {
      newLine += 1
    }
  }
  return result
}

/** Build a DecorationSet from the changed lines of a diff. */
export function diffDecorations(diff: string, doc: Text): DecorationSet {
  const marks: Range<Decoration>[] = []
  for (const [index, kind] of parseDiff(diff)) {
    if (index >= doc.lines) break
    const line = doc.line(index + 1)
    marks.push((kind === '+' ? addedMarker.range(line.from) : removedMarker.range(line.from)) as Range<Decoration>)
  }
  return Decoration.set(marks, true)
}

/**
 * A ViewPlugin that decorates changed lines green/red based on a diff fetched
 * from the main process. It re-fetches when the document changes.
 */
export function gitGutterExtension(getDiff: () => Promise<string>): Extension {
  class Plugin {
    decorations: DecorationSet = Decoration.set([], true)
    constructor(readonly view: EditorView) {
      void this.refresh()
    }
    async refresh(): Promise<void> {
      const diff = await getDiff().catch(() => null)
      this.decorations = diff ? diffDecorations(diff, this.view.state.doc) : Decoration.set([], true)
      this.view.dispatch({})
    }
    update(update: ViewUpdate): void {
      if (update.docChanged) void this.refresh()
    }
  }
  return ViewPlugin.fromClass(Plugin, { decorations: (plugin) => plugin.decorations })
}

/** True when the diff means the file is deleted. */
export function isDeletedFile(diff: string): boolean {
  return diff.includes('deleted file mode')
}
