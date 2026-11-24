/**
 * The FlintQode extension marketplace.
 *
 * It ships with the application, so browsing and installing works offline and
 * needs no account. Every entry installs the same `plugin.js` + `plugin.json`
 * layout that a hand-installed plugin uses, and the Extensions view gives it
 * the familiar VS Code flow: search, details, Install, Enable/Disable,
 * Uninstall and Install from file.
 */
import type { PluginManifest } from '@shared/types'
import { useAppStore } from '../store/app'
import {
  activatePlugin,
  deactivatePlugin,
  forgetPlugin,
  installPluginFiles,
  reloadPlugins,
  uninstallPluginFiles,
} from './plugins'

export interface MarketplacePlugin {
  id: string
  name: string
  publisher: string
  version: string
  description: string
  detail: string
  category: string
  icon: string
  source: string
}

export const MARKETPLACE: MarketplacePlugin[] = [
  {
    id: 'flintqode.word-counter',
    name: 'Word Counter',
    publisher: 'FlintQode',
    version: '1.0.0',
    description: 'Report the word count of the active document.',
    detail: 'Adds a command that reports a quick word and character count for the current buffer.',
    category: 'Productivity',
    icon: 'WC',
    source: `export default {
  activate(ctx) {
    ctx.commands.register({
      id: 'extension.wordCounter',
      title: 'Word counter',
      category: 'Extensions',
      run: () => ctx.toast('Word Counter is ready — use the status bar for live counts.'),
    })
  },
}`,
  },
  {
    id: 'flintqode.timestamp',
    name: 'Insert Timestamp',
    publisher: 'FlintQode',
    version: '1.1.0',
    description: 'Copy the current timestamp to the clipboard.',
    detail: 'A tiny utility command that puts an ISO timestamp on the clipboard for pasting into notes.',
    category: 'Snippets',
    icon: 'TS',
    source: `export default {
  activate(ctx) {
    ctx.commands.register({
      id: 'extension.insertTimestamp',
      title: 'Copy timestamp',
      category: 'Extensions',
      run: async () => {
        await ctx.api.clipboard.writeText(new Date().toISOString())
        ctx.toast('Timestamp copied to the clipboard.')
      },
    })
  },
}`,
  },
  {
    id: 'flintqode.sort-lines',
    name: 'Sort Lines',
    publisher: 'FlintQode',
    version: '1.0.2',
    description: 'One-click ascending and descending line sorting.',
    detail: 'Wraps the built-in text transforms so sorting is available straight from the command palette.',
    category: 'Formatting',
    icon: 'AB',
    source: `export default {
  activate(ctx) {
    ctx.commands.register({
      id: 'extension.sortAsc',
      title: 'Sort lines ascending (extension)',
      category: 'Extensions',
      run: () => ctx.commands.run('format.sortAsc'),
    })
    ctx.commands.register({
      id: 'extension.sortDesc',
      title: 'Sort lines descending (extension)',
      category: 'Extensions',
      run: () => ctx.commands.run('format.sortDesc'),
    })
  },
}`,
  },
  {
    id: 'flintqode.focus-mode',
    name: 'Focus Mode',
    publisher: 'FlintQode',
    version: '1.0.0',
    description: 'Hide the chrome with a single command.',
    detail: 'Adds a command for distraction-free editing, handy when you want a quiet, full-screen document.',
    category: 'Productivity',
    icon: 'FM',
    source: `export default {
  activate(ctx) {
    ctx.commands.register({
      id: 'extension.focusMode',
      title: 'Toggle focus mode',
      category: 'Extensions',
      run: () => ctx.commands.run('view.distractionFree'),
    })
  },
}`,
  },
  {
    id: 'flintqode.power-toggle',
    name: 'Power Saver',
    publisher: 'FlintQode',
    version: '1.2.0',
    description: 'Switch power save mode from the palette.',
    detail: 'A tiny companion to the built-in power save command, useful on laptops and low-end machines.',
    category: 'System',
    icon: 'PS',
    source: `export default {
  activate(ctx) {
    ctx.commands.register({
      id: 'extension.powerSave',
      title: 'Toggle power save mode (extension)',
      category: 'Extensions',
      run: () => ctx.commands.run('view.togglePowerSave'),
    })
  },
}`,
  },
  {
    id: 'flintqode.theme-switch',
    name: 'Quick Theme',
    publisher: 'FlintQode',
    version: '1.0.1',
    description: 'Flip between the dark and light themes.',
    detail: 'Adds a one-command theme switch without opening the settings dialog.',
    category: 'Themes',
    icon: 'QS',
    source: `export default {
  activate(ctx) {
    ctx.commands.register({
      id: 'extension.quickTheme',
      title: 'Toggle dark / light theme (extension)',
      category: 'Extensions',
      run: () => ctx.commands.run('view.toggleTheme'),
    })
  },
}`,
  },
]

/** Install a marketplace entry or a plugin file with the standard layout. */
export async function installExtension(entry: MarketplacePlugin): Promise<void> {
  await installPluginFiles(entry.id, entry.name, entry.version, entry.description, entry.source)
  await reloadPlugins()
  const settings = useAppStore.getState().settings
  if (!settings.plugins.includes(entry.id)) {
    useAppStore.getState().setSettings({ plugins: [...settings.plugins, entry.id] })
    await useAppStore.getState().saveSettings()
  }
  activatePlugin(entry.id)
}

/** Install a loose plugin file picked from disk. */
export async function installExtensionFile(path: string, text: string): Promise<void> {
  const isManifest = path.toLowerCase().endsWith('.json')
  const parsed = isManifest ? (JSON.parse(text) as Record<string, unknown>) : {}
  const id = String(
    parsed.id ??
      path
        .split(/[\\/]/)
        .pop()
        ?.replace(/\.(js|json)$/i, '') ??
      'plugin',
  )
  const name = String(parsed.name ?? id)
  const version = String(parsed.version ?? '1.0.0')
  const description = String(parsed.description ?? 'Installed from a local file.')
  const source = isManifest ? String(parsed.source ?? '') : text
  if (!source.trim()) throw new Error('The selected file does not contain plugin source.')
  await installPluginFiles(id, name, version, description, source)
  await reloadPlugins()
  const settings = useAppStore.getState().settings
  if (!settings.plugins.includes(id)) {
    useAppStore.getState().setSettings({ plugins: [...settings.plugins, id] })
    await useAppStore.getState().saveSettings()
  }
  activatePlugin(id)
}

/** Uninstall an extension, including its enabled state and cached commands. */
export async function uninstallExtension(id: string): Promise<void> {
  deactivatePlugin(id)
  const settings = useAppStore.getState().settings
  useAppStore.getState().setSettings({ plugins: settings.plugins.filter((pluginId) => pluginId !== id) })
  await useAppStore.getState().saveSettings()
  await uninstallPluginFiles(id)
  forgetPlugin(id)
  await reloadPlugins()
}

/** Convert a marketplace entry into the native manifest shape for display. */
export function asManifest(entry: MarketplacePlugin): PluginManifest {
  return {
    id: entry.id,
    name: entry.name,
    version: entry.version,
    description: entry.description,
    path: '',
    source: entry.source,
  }
}
