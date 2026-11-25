/**
 * Registry of live editor handles. Commands act on the focused editor through this map
 * so that no component needs to know about CodeMirror internals.
 */
export interface EditorSelection {
  from: number
  to: number
  text: string
}

export interface EditorStats {
  lines: number
  cols: number
  selection: number
  words: number
  chars: number
  selectedChars: number
}

export interface EditorHandle {
  id: string
  mode: 'code' | 'markdown'
  focus(): void
  getSelection(): EditorSelection
  replaceSelection(text: string): void
  insertText(text: string): void
  getContent(): string
  setContent(text: string): void
  undo(): void
  redo(): void
  /** Select the whole document (optional — not every editor kind supports it). */
  selectAll?(): void
  goToLine(line: number): void
  goToOffset(offset: number): void
  stats(): EditorStats
  isDirty(): boolean
  markClean(): void
  focusSearch(query?: string): void
  openSearchPanel(replace?: boolean): void
  findNext(): void
  findPrevious(): void
  destroy(): void
}

/** All handles of a tab (a split view registers two). */
const handles = new Map<string, Set<EditorHandle>>()

/** The handle of the pane that currently has the focus. */
let activeHandle: EditorHandle | null = null

export function registerEditor(handle: EditorHandle): () => void {
  let set = handles.get(handle.id)
  if (!set) {
    set = new Set()
    handles.set(handle.id, set)
  }
  set.add(handle)
  if (!activeHandle) activeHandle = handle
  return () => {
    set?.delete(handle)
    if (set && set.size === 0) handles.delete(handle.id)
    if (activeHandle === handle) activeHandle = null
  }
}

/** Mark a pane as the focused one (used by split view). */
export function setActiveEditor(handle: EditorHandle | null): void {
  activeHandle = handle
}

export function getEditor(id: string | null | undefined): EditorHandle | undefined {
  if (!id) return undefined
  if (activeHandle && activeHandle.id === id) return activeHandle
  const set = handles.get(id)
  if (!set) return undefined
  for (const handle of set) return handle
  return undefined
}

export function getAllEditors(): EditorHandle[] {
  const out: EditorHandle[] = []
  for (const set of handles.values()) for (const handle of set) out.push(handle)
  return out
}

export function destroyEditor(id: string): void {
  const set = handles.get(id)
  if (!set) return
  for (const handle of [...set]) handle.destroy()
  handles.delete(id)
  if (activeHandle?.id === id) activeHandle = null
}

/** A small document view: enough to read local slices without a full string. */
export interface DocSlice {
  length: number
  sliceString(from: number, to: number): string
}

/** The whitespace set used by the JS `\s` class, checked without a regex match array. */
function isSpace(code: number): boolean {
  if (code === 32 || (code >= 9 && code <= 13) || (code >= 28 && code <= 31)) return true
  if (code === 0x85 || code === 0xa0 || code === 0x1680 || code === 0x180e) return true
  if (code >= 0x2000 && code <= 0x200a) return true
  return code === 0x2028 || code === 0x2029 || code === 0x202f || code === 0x205f || code === 0x3000 || code === 0xfeff
}

/** Count whitespace-separated words in one bounded pass, with no allocations. */
function countWords(text: string): number {
  let words = 0
  let inWord = false
  for (let index = 0; index < text.length; index++) {
    if (isSpace(text.charCodeAt(index))) {
      inWord = false
    } else if (!inWord) {
      words++
      inWord = true
    }
  }
  return words
}

/** Word / character count for a plain text string. */
export function countStats(text: string): { words: number; chars: number } {
  return { words: countWords(text), chars: text.length }
}

/**
 * Update a word count after one document change.
 *
 * Only the words touching the edit are rescanned. `doc` is the document *before*
 * the change, so the old affected text can be compared with the new one. This
 * keeps the common keystroke path away from a full-document `toString()`.
 */
export function statsAfterChange(
  previous: { words: number; chars: number },
  doc: DocSlice,
  change: { from: number; to: number; insert: string },
): { words: number; chars: number } {
  const from = Math.max(0, Math.min(change.from, doc.length))
  const to = Math.max(from, Math.min(change.to, doc.length))

  const start = wordStart(doc, from)
  const end = wordEnd(doc, to)
  const left = doc.sliceString(start, from)
  const middle = doc.sliceString(from, to)
  const right = doc.sliceString(to, end)

  const removed = countWords(left + middle + right)
  const inserted = countWords(left + change.insert + right)
  const chars = doc.length + change.insert.length - (to - from)
  return { words: previous.words + inserted - removed, chars }
}

/** Start of the word that ends at `position` (bounded to a local window). */
function wordStart(doc: DocSlice, position: number): number {
  const windowStart = Math.max(0, position - 256)
  const text = doc.sliceString(windowStart, position)
  for (let index = text.length - 1; index >= 0; index--) {
    if (isSpace(text.charCodeAt(index))) return windowStart + index + 1
  }
  return windowStart
}

/** End of the word that starts at `position` (bounded to a local window). */
function wordEnd(doc: DocSlice, position: number): number {
  const windowEnd = Math.min(doc.length, position + 256)
  const text = doc.sliceString(position, windowEnd)
  for (let index = 0; index < text.length; index++) {
    if (isSpace(text.charCodeAt(index))) return position + index
  }
  return windowEnd
}
