/** Extensions view: enable and disable the plugins found in the plugin folder. */

import { createMemo, createSignal, For, Match, onSettled, Switch } from 'solid-js'
import type { JSX } from '@solidjs/web'
import { useAppStore } from '../../store/app'
import { appActions, useSettings } from '../../state/solid'
import { activatePlugin, deactivatePlugin, loadAllPlugins, type LoadedPlugin } from '../../core/plugins'
import { useT } from '../../core/i18n'

export function PluginsView(): JSX.Element {
  const settings = useSettings()
  const actions = appActions()
  const [plugins, setPlugins] = createSignal<LoadedPlugin[] | null>(null)
  const t = useT()

  onSettled(() => {
    void loadAllPlugins().then(setPlugins)
  })

  const enabled = createMemo(() => new Set(settings().plugins))
  const toggle = (plugin: LoadedPlugin): void => {
    const current = useAppStore.getState().settings
    if (enabled().has(plugin.manifest.id)) {
      deactivatePlugin(plugin.manifest.id)
      actions.setSettings({ plugins: current.plugins.filter((id) => id !== plugin.manifest.id) })
      actions.toast(t('panel.pluginDisabled', { name: plugin.manifest.name }))
    } else {
      const error = activatePlugin(plugin.manifest.id)
      if (error) {
        actions.toast(t('panel.pluginFailed', { name: plugin.manifest.name, error }), 'error')
        return
      }
      actions.setSettings({ plugins: [...current.plugins, plugin.manifest.id] })
      actions.toast(t('panel.pluginEnabled', { name: plugin.manifest.name }), 'success')
    }
    void actions.saveSettings()
  }

  return (
    <div class="panel plugins-view">
      <div class="workbench-view-bar">
        <span class="panel-title">{t('panel.plugins')}</span>
        <span class="panel-subtitle">
          {t('panel.pluginsEnabledCount', {
            enabled: plugins()?.filter((plugin) => plugin.active).length ?? 0,
            total: plugins()?.length ?? 0,
          })}
        </span>
      </div>
      <div class="workbench-plugin-list">
        <Switch>
          <Match when={plugins() === null}>
            <div class="empty-state">{t('panel.pluginsLoading')}</div>
          </Match>
          <Match when={plugins()?.length === 0}>
            <div class="empty-state">
              {t('panel.pluginsEmpty')}
              <span class="hint">{t('panel.pluginsHint')}</span>
            </div>
          </Match>
          <Match when={true}>
            <For each={plugins() ?? []}>
              {(plugin) => (
                <div class="plugin-entry">
                  <div class="plugin-details">
                    <strong>{plugin.manifest.name}</strong>
                    <span class="hint">
                      v{plugin.manifest.version}
                      {plugin.manifest.description ? ` · ${plugin.manifest.description}` : ''}
                      {plugin.error ? ` · ${plugin.error}` : ''}
                    </span>
                  </div>
                  <button class="panel-button" onClick={() => toggle(plugin)}>
                    {enabled().has(plugin.manifest.id) ? t('common.disable') : t('common.enable')}
                  </button>
                </div>
              )}
            </For>
          </Match>
        </Switch>
      </div>
    </div>
  )
}
