import { createMemo, Errored, onSettled, Show, type Accessor, type Component } from 'solid-js'
import type { JSX } from '@solidjs/web'
import { useT } from '../core/i18n'

interface ErrorPanelProps {
  error: Accessor<unknown>
  reset: () => void
}

/** The fallback shown when a renderer exception escapes a component. */
function ErrorPanel(props: ErrorPanelProps): JSX.Element {
  const t = useT()
  const failure = createMemo(() => {
    const value = props.error()
    return value instanceof Error ? value : new Error(String(value))
  })
  const info = createMemo(() => {
    const value = props.error() as { componentStack?: unknown } | null | undefined
    return typeof value?.componentStack === 'string' ? value.componentStack : ''
  })

  onSettled(() => {
    try {
      window.api?.reportError?.(String(failure().stack ?? failure()))
    } catch {
      /* the bridge may be gone during teardown */
    }
  })

  return (
    <div class="modal-backdrop">
      <div class="modal" role="dialog" aria-modal="true" aria-label={t('error.title')}>
        <div class="modal-header">
          <span>{t('error.title')}</span>
        </div>
        <div class="modal-body">
          <p class="hint">{t('error.filesSafe')}</p>
          <pre
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              'border-radius': '6px',
              padding: '10px',
              'max-height': '260px',
              overflow: 'auto',
              'font-size': '11px',
              'white-space': 'pre-wrap',
            }}
          >
            {String(failure().stack ?? failure().message)}
          </pre>
          <Show when={info()}>
            <pre
              style={{
                'font-size': '10px',
                color: 'var(--fg-muted)',
                'max-height': '120px',
                overflow: 'auto',
              }}
            >
              {info().slice(0, 2000)}
            </pre>
          </Show>
        </div>
        <div class="modal-footer">
          <button class="icon-btn" onClick={() => window.location.reload()}>
            {t('error.reload')}
          </button>
          <button class="icon-btn" onClick={() => props.reset()}>
            {t('error.dismiss')}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Catches renderer exceptions so a bug shows a readable panel instead of a
 * blank window, and reports the failure to the main process log.
 */
export const ErrorBoundary: Component<{ children: JSX.Element }> = (props) => (
  <Errored fallback={(error, reset) => <ErrorPanel error={error} reset={reset} />}>{props.children}</Errored>
)
