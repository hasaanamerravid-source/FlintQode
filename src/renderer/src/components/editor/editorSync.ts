/**
 * Helpers for keeping a CodeMirror view in step with the open tab.
 *
 * The editor is recreated when the active tab changes, but during the switch
 * the previous view is still mounted for one effect pass. These helpers make
 * that window explicit so content belonging to the incoming tab can never be
 * written into the outgoing editor (which used to copy one file into another).
 */

/** The part of an `EditorView` the sync helpers need (also easy to fake in tests). */
export interface EditorDocumentView {
  state: { doc: { toString: () => string; length: number } }
  dispatch: (spec: { changes: { from: number; to: number; insert: string } }) => void
}

/** True when the mounted editor is the one that belongs to `tabId`. */
export function editorOwnsTab(tabId: string, currentTabId: string): boolean {
  return tabId === currentTabId
}

/**
 * Apply a content change that came from outside the editor (a reload from
 * disk or a restored tab). Returns true when the document was replaced.
 *
 * Nothing happens while another tab's editor is still mounted or when the
 * buffer has unsaved changes: the editor is not the owner of that content.
 */
export function applyExternalContent(
  view: EditorDocumentView,
  tabId: string,
  currentTabId: string,
  content: string | null | undefined,
  dirty: boolean,
): boolean {
  if (!editorOwnsTab(tabId, currentTabId)) return false
  const incoming = content ?? ''
  if (dirty || view.state.doc.toString() === incoming) return false
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: incoming } })
  return true
}
