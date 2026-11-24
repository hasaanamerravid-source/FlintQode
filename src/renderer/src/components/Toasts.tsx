import { For } from 'solid-js'
import type { JSX } from '@solidjs/web'
import { useAppStore } from '../store/app'

export function Toasts(): JSX.Element {
  return (
    <div class="toast-stack">
      <For each={useAppStore().toasts}>
        {(toast) => (
          <div class={['toast', toast.kind]} onClick={() => useAppStore.getState().dismissToast(toast.id)}>
            {toast.message}
          </div>
        )}
      </For>
    </div>
  )
}
