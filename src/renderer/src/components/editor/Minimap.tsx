import type { JSX } from '@solidjs/web'
import { Show, createEffect, createMemo, createSignal, onSettled } from 'solid-js'
import { EditorView } from '@codemirror/view'
import { useAppStore } from '../../store/app'

export interface MinimapProps {
  /** Returns the live CodeMirror view, or `null` when no editor is mounted. */
  getView: () => EditorView | null
  width?: number
  height?: number
}

/** Height of one document line inside the minimap, in CSS pixels. */
const LINE_HEIGHT = 2

/** Common keywords used by the colour heuristic. */
const KEYWORDS = new Set([
  'abstract',
  'and',
  'as',
  'assert',
  'async',
  'await',
  'begin',
  'bool',
  'boolean',
  'break',
  'byte',
  'case',
  'catch',
  'char',
  'class',
  'const',
  'constructor',
  'continue',
  'def',
  'default',
  'delete',
  'do',
  'double',
  'elif',
  'else',
  'end',
  'enum',
  'except',
  'export',
  'extends',
  'false',
  'final',
  'finally',
  'float',
  'for',
  'from',
  'func',
  'function',
  'global',
  'goto',
  'if',
  'impl',
  'implements',
  'import',
  'in',
  'include',
  'int',
  'interface',
  'is',
  'lambda',
  'let',
  'local',
  'long',
  'match',
  'module',
  'mut',
  'namespace',
  'new',
  'nil',
  'none',
  'not',
  'null',
  'or',
  'package',
  'pass',
  'print',
  'private',
  'protected',
  'pub',
  'public',
  'raise',
  'return',
  'self',
  'short',
  'sizeof',
  'static',
  'string',
  'struct',
  'super',
  'switch',
  'template',
  'then',
  'this',
  'throw',
  'true',
  'try',
  'type',
  'typedef',
  'typename',
  'union',
  'unsafe',
  'use',
  'var',
  'void',
  'where',
  'while',
  'with',
  'yield',
])

interface Palette {
  default: string
  comment: string
  keyword: string
  string: string
  viewport: string
  viewportBorder: string
  background: string
}

/** Styles for the parts the application stylesheet does not cover. */
const STYLES = `
.minimap-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: var(--fg-muted, #6b7089);
  pointer-events: none;
}
`

const DARK_PALETTE: Palette = {
  default: '#585b70',
  comment: '#45475a',
  keyword: '#c792ea',
  string: '#c3e88d',
  viewport: 'rgba(137, 180, 250, 0.12)',
  viewportBorder: 'rgba(137, 180, 250, 0.45)',
  background: 'transparent',
}

const LIGHT_PALETTE: Palette = {
  default: '#b0b6c3',
  comment: '#d3d8e0',
  keyword: '#8250df',
  string: '#0a7d33',
  viewport: 'rgba(5, 80, 174, 0.10)',
  viewportBorder: 'rgba(5, 80, 174, 0.40)',
  background: 'transparent',
}

/** Clamp a number into a range. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** Pick a colour for one line of the document. */
function colorForLine(text: string, palette: Palette): string {
  const trimmed = text.trim()
  if (!trimmed) return palette.background
  if (/^(\/\/|#|\*|--|;|<!--|\/\*)/.test(trimmed)) return palette.comment
  if (/^['"`]/.test(trimmed)) return palette.string
  const tokens = trimmed.match(/[A-Za-z_$][\w$]*/g)
  if (tokens && tokens.some((token) => KEYWORDS.has(token))) return palette.keyword
  if (/['"`]/.test(trimmed)) return palette.string
  return palette.default
}

export function Minimap(props: MinimapProps): JSX.Element {
  let canvas!: HTMLCanvasElement
  let wrap!: HTMLDivElement
  let offset = 0
  let dragging = false
  let loopFrame = 0
  let drawFrame = 0
  const [hasView, setHasView] = createSignal(false)

  const width = (): number => props.width ?? 110
  const height = (): number => props.height ?? 320

  const palette = createMemo<Palette>(() => {
    const theme = useAppStore().settings.theme
    const dark =
      theme === 'dark' ||
      (theme === 'system' &&
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches)
    return dark ? DARK_PALETTE : LIGHT_PALETTE
  })

  /** Draw the minimap. Safe to call when no editor is mounted. */
  function draw(): void {
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1
    const w = Math.max(1, Math.round(width()))
    const h = Math.max(1, Math.round(height()))
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    const view = props.getView()
    if (!view) return
    const doc = view.state.doc
    const total = doc.lines
    if (!total) return

    const firstLine = Math.max(1, Math.floor(offset / LINE_HEIGHT) + 1)
    const lastLine = Math.min(total, Math.ceil((offset + h) / LINE_HEIGHT))

    let longest = 1
    for (let n = firstLine; n <= lastLine; n += 1) {
      longest = Math.max(longest, doc.line(n).length)
    }

    for (let n = firstLine; n <= lastLine; n += 1) {
      const line = doc.line(n)
      const length = line.length
      if (!length) continue
      const bar = Math.max(2, (length / longest) * (w - 3))
      const y = (n - 1) * LINE_HEIGHT - offset
      ctx.fillStyle = colorForLine(line.text, palette())
      ctx.fillRect(0, y, bar, LINE_HEIGHT)
    }

    // Viewport indicator.
    const scrollTop = view.scrollDOM.scrollTop
    const clientHeight = view.scrollDOM.clientHeight || 1
    const topLine = doc.lineAt(Math.min(scrollTop + 1, doc.length)).number
    const bottomLine = doc.lineAt(Math.min(scrollTop + clientHeight, doc.length)).number
    const viewTop = (topLine - 1) * LINE_HEIGHT - offset
    const viewBottom = (bottomLine - 1) * LINE_HEIGHT + LINE_HEIGHT - offset
    if (viewBottom > 0 && viewTop < h) {
      const y = Math.max(0, viewTop)
      const barHeight = Math.max(3, Math.min(h, viewBottom) - y)
      const currentPalette = palette()
      ctx.fillStyle = currentPalette.viewport
      ctx.fillRect(0, y, w, barHeight)
      ctx.strokeStyle = currentPalette.viewportBorder
      ctx.lineWidth = 1
      ctx.strokeRect(0.5, y + 0.5, w - 1, Math.max(1, barHeight - 1))
    }
  }

  /** Redraw on the next animation frame. */
  function scheduleDraw(): void {
    if (drawFrame) return
    drawFrame = requestAnimationFrame(() => {
      drawFrame = 0
      draw()
    })
  }

  // Main loop: keeps the minimap in sync with the editor.
  createEffect(
    () => ({ width: width(), height: height() }),
    () => {
      let lastScroll = -1
      let lastKey = ''
      let active = true

      const frame = (): void => {
        if (!active) return
        const view = props.getView()
        if (!view) {
          if (lastKey !== 'none') {
            lastKey = 'none'
            setHasView(false)
            offset = 0
            scheduleDraw()
          }
          return
        }
        const doc = view.state.doc
        const total = doc.lines
        const scrollTop = view.scrollDOM.scrollTop
        if (scrollTop !== lastScroll) {
          lastScroll = scrollTop
          // Follow the editor: keep the visible part of the document in sight.
          const maxOffset = Math.max(0, total * LINE_HEIGHT - height())
          const topLine = doc.lineAt(Math.min(scrollTop + 1, doc.length)).number
          const target = clamp((topLine - 1) * LINE_HEIGHT - height() / 3, 0, maxOffset)
          offset = target
        }
        const key = `${total}|${doc.length}|${scrollTop}|${offset}|${width()}|${height()}`
        if (key !== lastKey) {
          lastKey = key
          setHasView(true)
          scheduleDraw()
        }
      }

      // A timer instead of a permanent animation frame: the minimap only has to
      // follow the scroll position, 8 times a second is plenty.
      const timer = window.setInterval(frame, 120)
      frame()
      return () => {
        active = false
        window.clearInterval(timer)
        if (loopFrame) cancelAnimationFrame(loopFrame)
        loopFrame = 0
        if (drawFrame) cancelAnimationFrame(drawFrame)
        drawFrame = 0
      }
    },
  )

  // Redraw when the palette changes.
  createEffect(
    () => palette(),
    () => {
      scheduleDraw()
    },
  )

  /** Scroll the editor to a line. */
  function scrollToLine(lineNumber: number): void {
    const view = props.getView()
    if (!view) return
    const doc = view.state.doc
    const n = clamp(Math.round(lineNumber), 1, Math.max(1, doc.lines))
    const pos = doc.line(n).from
    view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'center' }) })
  }

  /** Line under a pointer position. */
  function lineAt(clientY: number): number {
    if (!canvas) return 1
    const rect = canvas.getBoundingClientRect()
    const y = clientY - rect.top + offset
    return Math.floor(y / LINE_HEIGHT) + 1
  }

  const handleMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0) return
    dragging = true
    const line = lineAt(event.clientY)
    scrollToLine(line)
    const view = props.getView()
    if (view) {
      const maxOffset = Math.max(0, view.state.doc.lines * LINE_HEIGHT - height())
      const rect = canvas?.getBoundingClientRect()
      const y = rect ? event.clientY - rect.top : 0
      offset = clamp(y + offset - height() / 2, 0, maxOffset)
    }
    scheduleDraw()
    event.preventDefault()
  }

  // Dragging: follow the pointer while the button is held.
  onSettled(() => {
    const onMove = (event: MouseEvent): void => {
      if (!dragging) return
      scrollToLine(lineAt(event.clientY))
      scheduleDraw()
    }
    const onUp = (): void => {
      dragging = false
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  })

  // Wheel scrolling of the minimap itself.
  onSettled(() => {
    const element = wrap
    if (!element) return
    const onWheel = (event: WheelEvent): void => {
      const view = props.getView()
      if (!view) return
      const maxOffset = Math.max(0, view.state.doc.lines * LINE_HEIGHT - height())
      offset = clamp(offset + event.deltaY, 0, maxOffset)
      scheduleDraw()
      event.preventDefault()
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  })

  return (
    <div
      class="minimap"
      ref={(el) => {
        wrap = el
      }}
      style={{ width: `${width()}px`, height: `${height()}px`, overflow: 'hidden' }}
    >
      <style>{STYLES}</style>
      <canvas
        class="minimap-canvas"
        ref={(el) => {
          canvas = el
        }}
        onMouseDown={handleMouseDown}
        style={{ display: 'block', cursor: 'pointer' }}
      />
      <Show when={!hasView()}>
        <div class="minimap-empty">No editor</div>
      </Show>
    </div>
  )
}
