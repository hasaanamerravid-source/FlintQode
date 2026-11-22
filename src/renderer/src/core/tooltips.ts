/**
 * Simple floating tooltips used by signature help and hover documentation.
 *
 * A tooltip is appended to the document body and positioned near the cursor,
 * it stays open until the pointer moves away or the user presses Escape.
 */

export interface TooltipOptions {
  /** Lines of text to show. */
  lines: string[]
  /** Position the tooltip next to this point (viewport coordinates). */
  x?: number
  y?: number
  /** Use a monospace, code-styled font. */
  code?: boolean
}

let current: HTMLElement | null = null

function textOf(entry: unknown): string {
  if (!entry) return ''
  if (typeof entry === 'string') return entry
  if (Array.isArray(entry)) {
    const parts: string[] = []
    for (const part of entry) parts.push(textOf(part))
    return parts.join('')
  }
  if (typeof entry === 'object') {
    const record = entry as Record<string, unknown>
    if (typeof record.value === 'string') return record.value
    if (typeof record.text === 'string') return record.text
    if (Array.isArray(record.contents)) {
      const parts: string[] = []
      for (const part of record.contents) {
        if (typeof part === 'string') parts.push(part)
        else if (part && typeof part === 'object' && 'value' in part) {
          parts.push(typeof part.value === 'string' ? part.value : '')
        }
      }
      return parts.join('\n')
    }
  }
  return ''
}

export function extractText(entry: unknown): string {
  return textOf(entry).trim()
}

/** Convert an LSP markdown content string to readable text. */
export function mdToText(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) => line.replace(/^(#{1,6}\s*|```)/g, '').replace(/[*_`]/g, ''))
    .filter(Boolean)
    .join('\n')
}

export function showTooltip(opts: TooltipOptions): void {
  hideTooltip()
  const text = opts.lines
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
  if (!text) return
  const tooltip = document.createElement('div')
  tooltip.className = 'lsp-tooltip'
  if (opts.code) tooltip.classList.add('code')
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = document.createElement('div')
    line.className = 'lsp-tooltip-line'
    line.textContent = lines[index]
    tooltip.appendChild(line)
  }
  tooltip.style.left = `${Math.min(opts.x ?? 0, window.innerWidth - 260)}px`
  tooltip.style.top = `${Math.min(opts.y ?? 16, 16)}px`
  document.body.appendChild(tooltip)
  current = tooltip

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') hideTooltip()
  }
  const onMouse = (): void => hideTooltip()
  window.addEventListener('keydown', onKey)
  tooltip.addEventListener('mouseover', (event) => event.stopPropagation())
  document.addEventListener('mousedown', onMouse, { once: true, capture: true })
}

export function hideTooltip(): void {
  if (current?.parentElement) current.parentElement.removeChild(current)
  current = null
}

/** Show the signature help of the active file at the cursor. */
export function showSignatureHelp(): void {
  void import('./lspCommands').then(async (lsp) => {
    const help = await lsp.getSignatureHelp()
    if (!help) {
      hideTooltip()
      return
    }
    const text = extractText(help)
    if (text) showTooltip({ lines: [text], code: true })
  })
}

/** Show the hover documentation of the active file at the cursor. */
export function showHoverDocs(): void {
  void import('./lspCommands').then(async (lsp) => {
    const hover = await lsp.getHover()
    if (!hover) {
      hideTooltip()
      return
    }
    const text = extractText(hover)
    if (text) showTooltip({ lines: mdToText(text).split('\n') })
  })
}
