import type { JSX } from '@solidjs/web'
/**
 * Markdown preview.
 *
 * The markdown is rendered with `marked` and sanitised with DOMPurify.
 */

import { createEffect, createSignal, onSettled } from 'solid-js'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { createDebouncedRenderer, type DebounceScheduler } from '../../state/compat'

export interface MarkdownPreviewProps {
  /** Markdown source. */
  source: string
  /** Called when a link is clicked. */
  onOpenLink?: (target: string) => void
  /** Extra class names for the container. */
  className?: string
}

function markedToHtml(source: string): string {
  try {
    const parsed = marked.parse(source, { async: false, gfm: true, breaks: false })
    return typeof parsed === 'string' ? parsed : ''
  } catch {
    return ''
  }
}

/** Render markdown into sanitised HTML. */
export function renderMarkdown(source: string): string {
  // Rendering a multi megabyte document would freeze the window: preview only
  // the first chunk and let the user open the file in a code editor for the rest.
  const MAX_PREVIEW = 200 * 1024
  const clipped = source.length > MAX_PREVIEW ? `${source.slice(0, MAX_PREVIEW)}\n\n…` : source
  const html = markedToHtml(clipped)
  if (!html) return ''
  try {
    return DOMPurify.sanitize(html)
  } catch {
    // Never fall back to unsanitised HTML: if the sanitiser fails, showing
    // nothing is the safe result.
    return ''
  }
}

/** How long to wait for a pause in typing before rendering the preview. */
export const MARKDOWN_RENDER_DELAY_MS = 180

/** The real timer used by the preview. */
const windowMarkdownScheduler: DebounceScheduler = {
  schedule: (task, delayMs) => window.setTimeout(task, delayMs),
  cancel: (handle) => window.clearTimeout(handle),
}

/** Read-only markdown preview with clickable links. */
export function MarkdownPreview(props: MarkdownPreviewProps): JSX.Element {
  const [html, setHtml] = createSignal('')
  const preview = createDebouncedRenderer(renderMarkdown, windowMarkdownScheduler, MARKDOWN_RENDER_DELAY_MS, setHtml)
  let firstRender = true

  // The preview is mounted only while it is visible, so the first render is
  // immediate; the rest of a typing burst is debounced.
  createEffect(
    () => props.source,
    (source) => {
      preview.update(source, firstRender)
      firstRender = false
    },
  )
  onSettled(() => {
    return () => preview.dispose()
  })

  let host!: HTMLDivElement

  onSettled(() => {
    const handleClick = (event: MouseEvent): void => {
      const target = event.target as HTMLElement | null
      const anchor = target?.closest('a') as HTMLAnchorElement | null
      if (!anchor) return
      event.preventDefault()
      const href = anchor.getAttribute('href')
      // Read the prop when the click happens: Solid props are live getters, so
      // a changed handler is used without re-subscribing the listener.
      if (href) props.onOpenLink?.(href)
    }
    host.addEventListener('click', handleClick)
    return () => host.removeEventListener('click', handleClick)
  })

  return (
    <div
      ref={(el) => {
        host = el
      }}
      class={['markdown-preview', props.className]}
      // The HTML is sanitised by DOMPurify inside renderMarkdown.
      innerHTML={html()}
    />
  )
}
