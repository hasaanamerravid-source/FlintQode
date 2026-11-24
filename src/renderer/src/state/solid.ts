/**
 * Small reactive helpers shared by the Solid components.
 *
 * The command layer still exposes Zustand-shaped stores through the compatibility
 * adapter. These helpers turn those callable stores into convenient accessors so
 * components read state reactively instead of capturing a snapshot.
 */
import { createMemo, type Accessor } from 'solid-js'
import type { Settings, Tab } from '@shared/types'
import { useAppStore } from '../store/app'
import { useStatusStore } from '../store/status'

/** Stable action object from the app store. Safe to call in event handlers. */
export function appActions(): ReturnType<typeof useAppStore.getState> {
  return useAppStore.getState()
}

/** Stable action object from the status store. */
export function statusActions(): ReturnType<typeof useStatusStore.getState> {
  return useStatusStore.getState()
}

export function useSettings(): Accessor<Settings> {
  return createMemo(() => useAppStore().settings)
}

export function useTabs(): Accessor<Tab[]> {
  return createMemo(() => useAppStore().tabs)
}

export function useActiveTabId(): Accessor<string | null> {
  return createMemo(() => useAppStore().activeTabId)
}

export function useActiveTab(): Accessor<Tab | undefined> {
  return createMemo(() => {
    const state = useAppStore()
    return state.tabs.find((tab) => tab.id === state.activeTabId)
  })
}

export function useActivePath(): Accessor<string> {
  return createMemo(() => {
    const state = useAppStore()
    return state.tabs.find((tab) => tab.id === state.activeTabId)?.path ?? ''
  })
}

export function useActiveLanguage(): Accessor<string> {
  return createMemo(() => {
    const state = useAppStore()
    return state.tabs.find((tab) => tab.id === state.activeTabId)?.language ?? 'text'
  })
}
