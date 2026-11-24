/**
 * Translation layer for the Solid renderer. The catalogue lives in `src/shared/i18n`;
 * this module adds reactive access to the current UI language.
 */
import {
  DEFAULT_LOCALE,
  formatDate,
  formatNumber,
  formatTime,
  interpolate,
  isLocaleId,
  localeDirection,
  localeInfo,
  LOCALES,
  translate,
  translateWith,
  translationProgress,
  type LocaleId,
  type MessageKey,
  type TranslationParams,
} from '@shared/i18n'
import { useAppStore } from '../store/app'

export type { LocaleId, MessageKey } from '@shared/i18n'
export { LOCALES, localeInfo, translationProgress, formatDate, formatNumber, formatTime, localeDirection }

/** Non-reactive language snapshot, for commands and other plain modules. */
export function currentLocale(): LocaleId {
  const language = useAppStore.getState().settings.language
  return isLocaleId(language) ? language : DEFAULT_LOCALE
}

/** Reactive language read — call it inside a component or effect. */
function reactiveLocale(): LocaleId {
  const language = useAppStore().settings.language
  return isLocaleId(language) ? language : DEFAULT_LOCALE
}

/** Reactive translation. Safe to call as `t('key')` inside JSX. */
export function t(key: MessageKey, params?: TranslationParams): string {
  return translate(reactiveLocale(), key, params)
}

/** Reactive translation with fallback. */
export function tWith(key: MessageKey, fallback: string, params?: TranslationParams): string {
  return translateWith(reactiveLocale(), key, fallback, params)
}

export function useT(): (key: MessageKey, params?: TranslationParams) => string {
  return t
}

export function useTWith(): (key: MessageKey, fallback: string, params?: TranslationParams) => string {
  return tWith
}

export function commandKey(id: string): MessageKey {
  return `cmd.${id}` as MessageKey
}

export function sectionKey(id: string): MessageKey {
  return `menu.${id}` as MessageKey
}

export function useLocale(): LocaleId {
  return reactiveLocale()
}

export function applyDocumentLocale(locale: string | undefined): void {
  const info = localeInfo(locale)
  const root = document.documentElement
  root.lang = info.tag
  root.dir = info.direction
  root.dataset.locale = info.id
}

export async function setLocale(locale: LocaleId): Promise<void> {
  const store = useAppStore.getState()
  store.setSettings({ language: locale })
  applyDocumentLocale(locale)
  await store.saveSettings()
  try {
    await window.api.menu.setLocale(locale)
  } catch {
    /* native menu is optional */
  }
}

export { interpolate }
