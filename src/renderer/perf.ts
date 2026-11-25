/**
 * Temporary browser fixture for M1 keystroke-to-paint measurement.
 *
 * It uses the real highlight-all and indent-guide extensions, plus the same
 * local-delta stats update that CodeEditor uses for ordinary keystrokes.
 */
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { countStats, statsAfterChange } from './src/core/editors'
import { highlightAllExtension, setHighlightAll } from './src/core/highlightAll'
import { indentGuidesExtension } from './src/core/indentGuides'

const LINES = 10_000
const source = Array.from(
  { length: LINES },
  (_, index) =>
    `${'  '.repeat(index % 4)}const item${index} = computeValue(${index}); // keep line ${index} long enough for the fixture`,
).join('\n')

let stats = countStats(source)
let pendingStart: number | undefined
const samples: number[] = []
const domSamples: number[] = []
const guideCompartment = new Compartment()

const view = new EditorView({
  parent: document.getElementById('editor')!,
  state: EditorState.create({
    doc: source,
    extensions: [
      lineNumbers(),
      highlightActiveLine(),
      drawSelection(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      highlightAllExtension(),
      guideCompartment.of(indentGuidesExtension({ tabSize: 2, enabled: true })),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return
        update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
          stats = statsAfterChange(stats, update.startState.doc, {
            from: fromA,
            to: toA,
            insert: inserted.toString(),
          })
        })
        if (pendingStart !== undefined) {
          const started = pendingStart
          pendingStart = undefined
          requestAnimationFrame(() => {
            samples.push(performance.now() - started)
          })
        }
      }),
    ],
  }),
})

view.dom.addEventListener(
  'keydown',
  (event) => {
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      pendingStart = performance.now()
    }
  },
  true,
)

function percentile(values: number[], fraction: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]
}

function summary() {
  const sorted = [...samples].sort((a, b) => a - b)
  const dom = [...domSamples].sort((a, b) => a - b)
  return {
    count: sorted.length,
    minMs: sorted[0] ?? 0,
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted.at(-1) ?? 0,
    domMedianMs: percentile(dom, 0.5),
    domP95Ms: percentile(dom, 0.95),
    words: stats.words,
    lines: view.state.doc.lines,
    chars: view.state.doc.length,
  }
}

interface BenchApi {
  clear: () => void
  summary: () => ReturnType<typeof summary>
  setHighlight: (term: string | null) => void
  setGuides: (enabled: boolean) => void
  focusStart: () => void
  raw: () => number[]
  typeOnce: (text: string) => Promise<void>
  runBatch: (count: number) => Promise<ReturnType<typeof summary>>
  view: EditorView
}

const api: BenchApi = {
  clear: () => {
    samples.length = 0
    domSamples.length = 0
    pendingStart = undefined
  },
  summary,
  setHighlight: (term) => view.dispatch({ effects: setHighlightAll.of(term) }),
  setGuides: (enabled) =>
    view.dispatch({
      effects: guideCompartment.reconfigure(indentGuidesExtension({ tabSize: 2, enabled })),
    }),
  focusStart: () => {
    view.dispatch({ selection: { anchor: 0 } })
    view.focus()
  },
  raw: () => [...samples],
  typeOnce: async (text) => {
    const start = performance.now()
    const domBefore = domSamples.length
    const paintBefore = samples.length
    pendingStart = start
    const observer = new MutationObserver(() => {
      if (domSamples.length === domBefore) domSamples.push(performance.now() - start)
      observer.disconnect()
    })
    observer.observe(view.contentDOM, { childList: true, characterData: true, subtree: true })
    const head = view.state.selection.main.head
    view.dispatch({ changes: { from: head, insert: text } })
    await new Promise<void>((resolve) => {
      const check = () => {
        if (domSamples.length > domBefore && samples.length > paintBefore) resolve()
        else requestAnimationFrame(check)
      }
      requestAnimationFrame(check)
    })
  },
  runBatch: async (count) => {
    samples.length = 0
    domSamples.length = 0
    for (let index = 0; index < count; index++) await api.typeOnce('a')
    return summary()
  },
  view,
}
;(window as unknown as { __bench: BenchApi }).__bench = api

view.focus()
