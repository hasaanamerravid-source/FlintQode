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

/** Wait for a pause in typing before asking native code for a diff. */
export const REFRESH_DELAY_MS = 600

/** Injectable timers, so the first refresh can be tested without a clock. */
export interface GitGutterScheduler {
  set: (task: () => void, delayMs: number) => number
  clear: (handle: number) => void
}

/** The real window timers used by the editor plugin. */
export const windowGitGutterScheduler: GitGutterScheduler = {
  set: (task, delayMs) => window.setTimeout(task, delayMs),
  clear: (handle) => window.clearTimeout(handle),
}

/**
 * The plugin class is built by a factory so tests can pass their own timer
 * and diff source. Stale replies are ignored with a generation guard: a native
 * `git diff` is a process launch, so one per keystroke made typing sluggish.
 */
export function gitGutterPluginClass(
  getDiff: () => Promise<string>,
  scheduler: GitGutterScheduler = windowGitGutterScheduler,
) {
  return class GitGutterPlugin {
    decorations: DecorationSet = Decoration.set([], true)
    timer: number | undefined
    generation = 0
    disposed = false

    constructor(readonly view: EditorView) {
      // The first diff waits for the same pause as later ones. Refreshing in
      // the constructor launched git while the editor was still mounting.
      this.refresh(REFRESH_DELAY_MS)
    }

    refresh(delay: number): void {
      const run = ++this.generation
      if (this.timer !== undefined) scheduler.clear(this.timer)
      const fetch = (): void => {
        this.timer = undefined
        void getDiff()
          .catch(() => null)
          .then((diff) => {
            if (this.disposed || run !== this.generation) return
            this.decorations = diff ? diffDecorations(diff, this.view.state.doc) : Decoration.set([], true)
            this.view.dispatch({})
          })
      }
      if (delay > 0) this.timer = scheduler.set(fetch, delay)
      else fetch()
    }

    update(update: ViewUpdate): void {
      if (update.docChanged) this.refresh(REFRESH_DELAY_MS)
    }

    destroy(): void {
      this.disposed = true
      if (this.timer !== undefined) scheduler.clear(this.timer)
    }
  }
}

/** ViewPlugin that decorates changed lines green/red from the file's diff. */
export function gitGutterExtension(getDiff: () => Promise<string>): Extension {
  return ViewPlugin.fromClass(gitGutterPluginClass(getDiff), { decorations: (plugin) => plugin.decorations })
}

/** True when the diff means the file is deleted. */
export function isDeletedFile(diff: string): boolean {
  return diff.includes('deleted file mode')
}
