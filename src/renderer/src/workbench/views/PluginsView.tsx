/** The Extensions view: a VS Code-style marketplace and installed list. */

import { createMemo, createSignal, For, Match, onSettled, Show, Switch } from 'solid-js'
import type { JSX } from '@solidjs/web'
import { useAppStore } from '../../store/app'
import { appActions, useSettings } from '../../state/solid'
import { activatePlugin, deactivatePlugin, reloadPlugins, type LoadedPlugin } from '../../core/plugins'
import {
  MARKETPLACE,
  installExtension,
  installExtensionFile,
  uninstallExtension,
  type MarketplacePlugin,
} from '../../core/marketplace'
import { useT } from '../../core/i18n'
import { Icon } from '../../components/Icons'

type View = 'marketplace' | 'installed'

export function PluginsView(): JSX.Element {
  const settings = useSettings()
  const actions = appActions()
  const t = useT()
  const [plugins, setPlugins] = createSignal<LoadedPlugin[]>([])
  const [loading, setLoading] = createSignal(true)
  const [view, setView] = createSignal<View>('marketplace')
  const [query, setQuery] = createSignal('')
  const [selectedId, setSelectedId] = createSignal<string | null>(null)
  const [busyId, setBusyId] = createSignal<string | null>(null)

  const refresh = async (): Promise<void> => {
    setLoading(true)
    try {
      setPlugins(await reloadPlugins())
    } finally {
      setLoading(false)
    }
  }

  onSettled(() => {
    void refresh()
  })

  const installedIds = createMemo(() => new Set(plugins().map((plugin) => plugin.manifest.id)))
  const enabledIds = createMemo(() => new Set(settings().plugins))
  const needle = createMemo(() => query().trim().toLowerCase())

  const matches = (text: string): boolean => text.toLowerCase().includes(needle())

  const marketplaceEntries = createMemo(() =>
    MARKETPLACE.filter(
      (entry) =>
        !needle() ||
        matches(entry.name) ||
        matches(entry.description) ||
        matches(entry.publisher) ||
        matches(entry.category),
    ),
  )

  const installedEntries = createMemo(() =>
    plugins().filter((plugin) => !needle() || matches(plugin.manifest.name) || matches(plugin.manifest.description)),
  )

  const selectedMarketplace = createMemo(() => MARKETPLACE.find((entry) => entry.id === selectedId()) ?? null)
  const selectedInstalled = createMemo(() => plugins().find((plugin) => plugin.manifest.id === selectedId()) ?? null)

  const toggle = (plugin: LoadedPlugin): void => {
    const current = useAppStore.getState().settings
    const id = plugin.manifest.id
    if (enabledIds().has(id)) {
      deactivatePlugin(id)
      actions.setSettings({ plugins: current.plugins.filter((entryId) => entryId !== id) })
      actions.toast(t('panel.pluginDisabled', { name: plugin.manifest.name }))
    } else {
      const error = activatePlugin(id)
      if (error) {
        actions.toast(t('panel.pluginFailed', { name: plugin.manifest.name, error }), 'error')
        return
      }
      actions.setSettings({ plugins: [...current.plugins, id] })
      actions.toast(t('panel.pluginEnabled', { name: plugin.manifest.name }), 'success')
    }
    void actions.saveSettings()
  }

  const install = async (entry: MarketplacePlugin): Promise<void> => {
    setBusyId(entry.id)
    try {
      await installExtension(entry)
      await refresh()
      actions.toast(`${entry.name} installed`, 'success')
    } catch (error) {
      actions.toast(t('panel.extensionInstallFailed', { name: entry.name }), 'error')
      console.error('[extensions] install failed', error)
    } finally {
      setBusyId(null)
    }
  }

  const uninstall = async (id: string, name: string): Promise<void> => {
    setBusyId(id)
    try {
      await uninstallExtension(id)
      setSelectedId(null)
      await refresh()
      actions.toast(`${name} uninstalled`)
    } catch (error) {
      actions.toast(t('panel.extensionUninstallFailed', { name }), 'error')
      console.error('[extensions] uninstall failed', error)
    } finally {
      setBusyId(null)
    }
  }

  const installFile = async (): Promise<void> => {
    const picked = await window.api.fs.openDialog({
      title: t('panel.extensionInstallFile'),
      filters: [
        { name: 'Plugin', extensions: ['js', 'json'] },
        { name: 'All files', extensions: ['*'] },
      ],
    })
    const path = picked.filePath
    if (picked.canceled || !path) return
    try {
      const source = await window.api.fs.readTextFile(path)
      await installExtensionFile(path, source)
      await refresh()
      actions.toast(t('panel.pluginEnabled', { name: path.split(/[\\/]/).pop() ?? path }), 'success')
    } catch (error) {
      actions.toast(t('panel.extensionInstallFailed', { name: path }), 'error')
      console.error('[extensions] file install failed', error)
    }
  }

  return (
    <div class="panel extensions-view">
      <div class="workbench-view-bar extensions-bar">
        <span class="panel-title">{t('panel.plugins')}</span>
        <span class="bar-actions">
          <button
            class="icon-btn"
            title={t('panel.extensionReload')}
            aria-label={t('panel.extensionReload')}
            onClick={() => void refresh()}
          >
            <Icon name="refresh" size={15} />
          </button>
          <button
            class="icon-btn"
            title={t('panel.extensionInstallFile')}
            aria-label={t('panel.extensionInstallFile')}
            onClick={() => void installFile()}
          >
            <Icon name="newFile" size={15} />
          </button>
        </span>
      </div>

      <div class="extensions-search">
        <Icon name="search" size={14} />
        <input
          type="search"
          value={query()}
          placeholder={t('panel.extensionSearch')}
          aria-label={t('panel.extensionSearch')}
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
      </div>

      <div class="extensions-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={view() === 'marketplace' ? 'true' : 'false'}
          class={['extensions-tab', { active: view() === 'marketplace' }]}
          onClick={() => setView('marketplace')}
        >
          {t('panel.marketplace')}
        </button>
        <button
          role="tab"
          aria-selected={view() === 'installed' ? 'true' : 'false'}
          class={['extensions-tab', { active: view() === 'installed' }]}
          onClick={() => setView('installed')}
        >
          {t('panel.installed')}
        </button>
      </div>

      <div class="extensions-body">
        <Switch>
          <Match when={loading()}>
            <div class="empty-state">{t('panel.pluginsLoading')}</div>
          </Match>
          <Match when={view() === 'marketplace'}>
            <Show
              when={marketplaceEntries().length > 0}
              fallback={<div class="empty-state">{t('panel.extensionNoResults')}</div>}
            >
              <For each={marketplaceEntries()}>
                {(entry) => (
                  <div
                    class={['extension-card', { selected: selectedId() === entry.id }]}
                    onClick={() => setSelectedId(entry.id)}
                  >
                    <span class="extension-icon">{entry.icon}</span>
                    <span class="extension-info">
                      <strong>{entry.name}</strong>
                      <span class="extension-meta">
                        {entry.publisher} · v{entry.version}
                      </span>
                      <span class="extension-description">{entry.description}</span>
                    </span>
                    <button
                      class={['panel-button', { primary: !installedIds().has(entry.id) }]}
                      disabled={installedIds().has(entry.id) || busyId() === entry.id}
                      onClick={(event) => {
                        event.stopPropagation()
                        void install(entry)
                      }}
                    >
                      {installedIds().has(entry.id) ? t('panel.extensionInstalled') : t('panel.extensionInstall')}
                    </button>
                  </div>
                )}
              </For>
            </Show>
          </Match>
          <Match when={view() === 'installed'}>
            <Show
              when={installedEntries().length > 0}
              fallback={
                <div class="empty-state">
                  {t('panel.pluginsEmpty')}
                  <span class="hint">{t('panel.pluginsHint')}</span>
                </div>
              }
            >
              <For each={installedEntries()}>
                {(plugin) => (
                  <div
                    class={['extension-card', { selected: selectedId() === plugin.manifest.id }]}
                    onClick={() => setSelectedId(plugin.manifest.id)}
                  >
                    <span class="extension-icon">{plugin.manifest.name.slice(0, 2).toUpperCase()}</span>
                    <span class="extension-info">
                      <strong>{plugin.manifest.name}</strong>
                      <span class="extension-meta">v{plugin.manifest.version}</span>
                      <span class="extension-description">
                        {(plugin.error ?? plugin.manifest.description) || t('panel.extensionBuiltIn')}
                      </span>
                    </span>
                    <button
                      class="panel-button"
                      disabled={busyId() === plugin.manifest.id}
                      onClick={(event) => {
                        event.stopPropagation()
                        toggle(plugin)
                      }}
                    >
                      {enabledIds().has(plugin.manifest.id) ? t('panel.extensionDisable') : t('panel.extensionEnable')}
                    </button>
                  </div>
                )}
              </For>
            </Show>
          </Match>
        </Switch>
      </div>

      <Show when={selectedMarketplace() || selectedInstalled()}>
        <div class="extension-detail">
          <div class="extension-detail-head">
            <span class="extension-icon">
              {selectedMarketplace()?.icon ?? selectedInstalled()?.manifest.name.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <strong>{selectedMarketplace()?.name ?? selectedInstalled()?.manifest.name}</strong>
              <span class="extension-meta">
                {t('panel.extensionPublisher')}: {selectedMarketplace()?.publisher ?? 'FlintQode'} · v
                {selectedMarketplace()?.version ?? selectedInstalled()?.manifest.version}
              </span>
            </div>
          </div>
          <p>{selectedMarketplace()?.detail ?? selectedInstalled()?.manifest.description}</p>
          <div class="extension-detail-actions">
            <Show
              when={selectedMarketplace()}
              fallback={
                <Show when={selectedInstalled()}>
                  {(plugin) => (
                    <>
                      <button class="panel-button" onClick={() => toggle(plugin())}>
                        {enabledIds().has(plugin().manifest.id)
                          ? t('panel.extensionDisable')
                          : t('panel.extensionEnable')}
                      </button>
                      <button
                        class="panel-button danger"
                        onClick={() => void uninstall(plugin().manifest.id, plugin().manifest.name)}
                      >
                        {t('panel.extensionUninstall')}
                      </button>
                    </>
                  )}
                </Show>
              }
            >
              {(entry) => (
                <button
                  class="panel-button primary"
                  disabled={installedIds().has(entry().id)}
                  onClick={() => void install(entry())}
                >
                  {installedIds().has(entry().id) ? t('panel.extensionInstalled') : t('panel.extensionInstall')}
                </button>
              )}
            </Show>
          </div>
        </div>
      </Show>
    </div>
  )
}
