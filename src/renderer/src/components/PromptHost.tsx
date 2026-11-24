import { createEffect, createSignal, Show } from 'solid-js'
import type { JSX } from '@solidjs/web'
import { useUiStore } from '../store/ui'
import { Modal } from './Modal'
import { useT } from '../core/i18n'

export function PromptHost(): JSX.Element {
  const prompt = () => useUiStore().prompt
  const confirm = () => useUiStore().confirm
  const [value, setValue] = createSignal('')
  const t = useT()

  createEffect(
    () => prompt(),
    (current) => {
      if (current) setValue(current.defaultValue ?? '')
    },
  )

  return (
    <Show
      when={prompt()}
      fallback={
        <Show when={confirm()}>
          {(request) => (
            <Modal title={request().title} onClose={() => useUiStore.getState().closeConfirm()} size="small">
              <div class="modal-body" style={{ padding: 0 }}>
                {request().message}
              </div>
              <div class="modal-footer" style={{ padding: '12px 0 0', 'border-top': 'none' }}>
                <button class="icon-btn" onClick={() => useUiStore.getState().closeConfirm()}>
                  {request().cancelLabel ?? t('common.cancel')}
                </button>
                <button
                  class="icon-btn"
                  onClick={() => {
                    request().resolve(true)
                    useUiStore.setState({ confirm: null })
                  }}
                >
                  {request().confirmLabel ?? t('common.ok')}
                </button>
              </div>
            </Modal>
          )}
        </Show>
      }
    >
      {(request) => (
        <Modal title={request().title} onClose={() => useUiStore.getState().closePrompt()} size="small">
          <Show when={request().message}>
            <div class="hint">{request().message}</div>
          </Show>
          <input
            autofocus
            type="text"
            value={value()}
            placeholder={request().placeholder}
            aria-label={request().title}
            style={{ width: '100%' }}
            onInput={(event) => setValue(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                request().resolve(value())
                useUiStore.setState({ prompt: null })
              }
            }}
          />
          <div class="modal-footer" style={{ 'margin-top': '12px', padding: 0, 'border-top': 'none' }}>
            <button class="icon-btn" onClick={() => useUiStore.getState().closePrompt()}>
              {t('common.cancel')}
            </button>
            <button
              class="icon-btn"
              onClick={() => {
                request().resolve(value())
                useUiStore.setState({ prompt: null })
              }}
            >
              {t('common.ok')}
            </button>
          </div>
        </Modal>
      )}
    </Show>
  )
}
