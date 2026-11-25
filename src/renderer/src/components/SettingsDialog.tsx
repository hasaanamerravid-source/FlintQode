import { createEffect, createMemo, createSignal, For, Match, Show, Switch } from 'solid-js'
import type { JSX } from '@solidjs/web'
import type { Settings, SyntaxColorKey } from '@shared/types'
import { useAppStore } from '../store/app'
import { confirm } from '../store/ui'
import { runUpdateFlow } from '../core/updateFlow'
import { useSettings } from '../state/solid'
import { DEFAULT_SETTINGS, ENCODING_LABELS, EOL_LABELS } from '../core/defaults'
import { themeGroups, resolveTheme, syntaxTokens, editorTheme, SYNTAX_COLOR_KEYS } from '../core/themeResolver'
import { ThemeGallery } from './ThemeGallery'
import { FileIcon } from './FileIcon'
import { ICON_THEMES } from '../core/iconThemes'
import { SOUND_THEMES, playSound } from '../core/sounds'
import { getCommands } from '../core/commands'
import {
  fromVSCode,
  keybindingsPath,
  readKeybindings,
  setKeybindings,
  writeKeybindings,
  type Keybindings,
} from '../core/keybindings'
import { PROJECT_CONFIG_NAME, projectFolder, readProjectConfig, writeProjectConfig } from '../core/projectConfig'
import {
  commandKey,
  LOCALES,
  setLocale,
  translationProgress,
  useT,
  useTWith,
  type LocaleId,
  type MessageKey,
} from '../core/i18n'
import { Modal } from './Modal'

type Section =
  'appearance' | 'typography' | 'icons' | 'toolchain' | 'workspace' | 'editor' | 'files' | 'shortcuts' | 'updates'

const SECTIONS: [Section, MessageKey][] = [
  ['appearance', 'settings.tab.appearance'],
  ['typography', 'settings.tab.typography'],
  ['icons', 'settings.tab.icons'],
  ['toolchain', 'settings.tab.toolchain'],
  ['workspace', 'settings.tab.general'],
  ['editor', 'settings.tab.editor'],
  ['files', 'settings.tab.files'],
  ['shortcuts', 'settings.tab.shortcuts'],
  ['updates', 'settings.tab.updates'],
]

/** Monospace fonts that are commonly installed, offered as suggestions. */
const FONT_CHOICES = [
  'Cascadia Code',
  'Cascadia Mono',
  'JetBrains Mono',
  'Fira Code',
  'Source Code Pro',
  'IBM Plex Mono',
  'Victor Mono',
  'Hack',
  'Inconsolata',
  'Menlo',
  'Consolas',
  'DejaVu Sans Mono',
  'Liberation Mono',
  'Ubuntu Mono',
  'monospace',
]

/** The interpreters / SDKs the user can point at. */
const TOOLCHAIN_LANGUAGES: { id: string; label: string; hint: string; placeholder: string; exe?: string }[] = [
  {
    id: 'java',
    label: 'Java (JDK)',
    hint: 'The JDK used to compile and run .java files',
    placeholder: 'C:\\Program Files\\Java\\jdk-21',
    exe: 'bin\\java.exe',
  },
  {
    id: 'node',
    label: 'Node.js',
    hint: 'The node executable',
    placeholder: 'C:\\Program Files\\nodejs\\node.exe',
    exe: 'node.exe',
  },
  {
    id: 'python',
    label: 'Python',
    hint: 'The python executable',
    placeholder: 'C:\\Python312\\python.exe',
    exe: 'python.exe',
  },
  { id: 'go', label: 'Go', hint: 'The go executable', placeholder: 'C:\\Go\\bin\\go.exe', exe: 'go.exe' },
  {
    id: 'dotnet',
    label: '.NET SDK',
    hint: 'The dotnet executable',
    placeholder: 'C:\\Program Files\\dotnet\\dotnet.exe',
    exe: 'dotnet.exe',
  },
  {
    id: 'rust',
    label: 'Rust',
    hint: 'The cargo executable',
    placeholder: '%USERPROFILE%\\.cargo\\bin\\cargo.exe',
    exe: 'cargo.exe',
  },
  { id: 'php', label: 'PHP', hint: 'The php executable', placeholder: 'C:\\php\\php.exe', exe: 'php.exe' },
  { id: 'ruby', label: 'Ruby', hint: 'The ruby executable', placeholder: 'C:\\Ruby\\bin\\ruby.exe', exe: 'ruby.exe' },
  {
    id: 'dotnet-script',
    label: 'Script',
    hint: 'The interpreter used for .csx scripts',
    placeholder: 'dotnet-script',
    exe: 'dotnet-script.exe',
  },
]

/**
 * The hints of the toolchain rows.
 *
 * The map holds the English text for now: a language that has no message yet
 * falls back to the text that is written down here.
 */
const TOOLCHAIN_HINTS: Record<string, string> = {
  java: 'The JDK used to compile and run .java files',
  node: 'The node executable',
  python: 'The python executable',
  go: 'The go executable',
  dotnet: 'The dotnet executable',
  rust: 'The cargo executable',
  php: 'The php executable',
  ruby: 'The ruby executable',
  'dotnet-script': 'The interpreter used for .csx scripts',
}

/** The languages that can have a language server. */
const LSP_LANGUAGES = [
  'go',
  'java',
  'typescript',
  'javascript',
  'python',
  'rust',
  'csharp',
  'cpp',
  'php',
  'ruby',
  'kotlin',
  'swift',
  'lua',
]

const SHORTCUTS: [MessageKey, string][] = [
  ['cmd.file.new', 'Ctrl+N'],
  ['cmd.file.open', 'Ctrl+O'],
  ['settings.shortcutSave', 'Ctrl+S / Ctrl+Shift+S'],
  ['cmd.view.commandPalette', 'Ctrl+Shift+P'],
  ['cmd.view.quickSwitcher', 'Ctrl+Shift+O'],
  ['settings.shortcutFind', 'Ctrl+F / Ctrl+H'],
  ['cmd.edit.gotoLine', 'Ctrl+G'],
  ['cmd.view.toggleSidebar', 'Ctrl+Shift+E'],
  ['cmd.view.toggleSplit', 'Ctrl+Alt+S'],
  ['cmd.view.distractionFree', 'Ctrl+Alt+F'],
  ['cmd.edit.duplicateLine', 'Ctrl+D'],
  ['cmd.edit.deleteLine', 'Ctrl+Shift+K'],
  ['settings.shortcutMove', 'Alt+Shift+Up / Down'],
  ['cmd.edit.copyLine', 'Ctrl+Shift+C'],
  ['cmd.edit.toggleBookmark', 'Ctrl+F2'],
  ['settings.shortcutBookmarks', 'F2 / Shift+F2'],
  ['cmd.edit.selectAllOccurrences', 'Ctrl+Shift+L'],
  ['cmd.edit.insertDateTime', 'Ctrl+Alt+D'],
  ['cmd.view.fullscreen', 'F11'],
]

interface RowProps {
  label: string
  hint?: string
  children: JSX.Element
}

function Row(props: RowProps): JSX.Element {
  return (
    <div class="form-row">
      <div>
        <div>{props.label}</div>
        <Show when={props.hint}>{(hint) => <div class="hint">{hint()}</div>}</Show>
      </div>
      <div class="control">{props.children}</div>
    </div>
  )
}

export function SettingsDialog(): JSX.Element {
  const open = createMemo(() => useAppStore().settingsOpen)
  const settings = useSettings()
  const t = useT()
  const tWith = useTWith()
  const [section, setSection] = createSignal<Section>('appearance')
  const [importText, setImportText] = createSignal('')
  const [bindings, setBindings] = createSignal<Keybindings>({})
  const [updateStatus, setUpdateStatus] = createSignal('')
  const [updateBusy, setUpdateBusy] = createSignal(false)

  // The flow is testable and keeps every prompt inside the app instead of
  // blocking the webview with window.confirm().
  const checkForUpdate = (): Promise<void> =>
    runUpdateFlow({
      api: {
        info: () => window.api.info(),
        checkUpdate: (version) => window.api.app.checkUpdate(version),
        downloadUpdate: (url, destination) => window.api.app.downloadUpdate(url, destination),
        installUpdate: (path) => window.api.app.installUpdate(path),
      },
      confirm,
      text: t,
      status: setUpdateStatus,
      busy: setUpdateBusy,
    })

  const commandsWithShortcuts = getCommands().filter((command) => command.shortcut && !command.hidden)
  const progress = createMemo(() => translationProgress(settings().language))

  // The shortcuts of the user are read when the tab is opened.
  createEffect(
    () => section(),
    (current) => {
      if (current !== 'shortcuts') return
      let cancelled = false
      void readKeybindings().then((loaded) => {
        if (!cancelled) setBindings(loaded)
      })
      return () => {
        cancelled = true
      }
    },
  )

  // Settings are written shortly after any change, so a crash or a window
  // close can never lose an edit. The dialog used to write only on close,
  // which is exactly why typography changes appeared not to persist.
  createEffect(
    () => ({ open: open(), settings: settings() }),
    ({ open: isOpen }) => {
      if (!isOpen) return
      const timer = window.setTimeout(() => {
        void useAppStore.getState().saveSettings()
      }, 350)
      return () => window.clearTimeout(timer)
    },
  )

  const close = (): void => {
    useAppStore.getState().setDialog('settings', false)
    void useAppStore.getState().saveSettings()
  }

  const patch = (partial: Partial<Settings>): void => {
    useAppStore.getState().setSettings(partial)
    void useAppStore.getState().saveSettings()
  }

  const patchAppearance = (partial: Partial<Settings['appearance']>): void => {
    useAppStore.getState().setSettings({ appearance: { ...settings().appearance, ...partial } })
  }

  const tokenColor = (key: SyntaxColorKey): string =>
    settings().syntaxColors?.[key] || syntaxTokens(editorTheme(settings()).id)[key]

  const setSyntaxColor = (key: SyntaxColorKey, value: string): void => {
    const next = { ...settings().syntaxColors }
    if (value) next[key] = value
    else delete next[key]
    useAppStore.getState().setSettings({ syntaxColors: next })
  }

  const resetSyntaxColors = (): void => {
    useAppStore.getState().setSettings({ syntaxColors: {} })
  }

  return (
    <Show when={open()}>
      <Modal
        title={t('settings.title')}
        onClose={close}
        tabs={
          <div class="settings-tabs" role="tablist" aria-label={t('settings.title')}>
            <For each={SECTIONS}>
              {([id, label]) => (
                <div
                  role="tab"
                  aria-selected={section() === id ? 'true' : 'false'}
                  class={['settings-tab', { active: section() === id }]}
                  onClick={() => setSection(id)}
                >
                  {t(label)}
                </div>
              )}
            </For>
          </div>
        }
        footer={
          <button class="icon-btn" onClick={close}>
            {t('common.close')}
          </button>
        }
      >
        <Switch>
          <Match when={section() === 'appearance'}>
            <Row label={t('settings.theme')} hint={t('settings.themeHint')}>
              <select value={settings().theme} onChange={(e) => patch({ theme: e.currentTarget.value as never })}>
                <option value="dark">{t('settings.themeDark')}</option>
                <option value="light">{t('settings.themeLight')}</option>
                <option value="system">{t('settings.themeSystem')}</option>
              </select>
            </Row>
            <Row label={t('settings.editorBackground')} hint={t('settings.editorBackgroundHint')}>
              <select
                value={settings().editorBackground}
                onChange={(e) => patch({ editorBackground: e.currentTarget.value as never })}
              >
                <option value="app">{t('settings.editorBackgroundApp')}</option>
                <option value="theme">{t('settings.editorBackgroundTheme')}</option>
              </select>
            </Row>
            <div class="panel-header" style={{ 'margin-top': '10px' }}>
              <span>{t('settings.syntaxTheme')}</span>
              <span>
                {t('settings.themeCount', {
                  count: themeGroups().reduce((sum, g) => sum + g.themes.length, 0),
                })}
              </span>
            </div>
            <ThemeGallery
              value={settings().syntaxTheme}
              onChange={(id) => {
                useAppStore.getState().setSettings({ syntaxTheme: id })
                void useAppStore.getState().saveSettings()
              }}
            />
            <div style={{ margin: '4px 0 14px' }}>
              <div class="syntax-theme-preview" data-syntax-theme={settings().syntaxTheme}>
                <span class="tok-keyword">function</span> <span class="tok-function">greet</span>(
                <span class="tok-type">User</span> <span class="tok-property">name</span>) {'{'}
                <br />
                &nbsp;&nbsp;<span class="tok-comment">// say hello</span>
                <br />
                &nbsp;&nbsp;<span class="tok-keyword">return</span>{' '}
                <span class="tok-string">
                  `Hello ${'{'}name{'}'}`
                </span>
                <br />
                {'}'}
                <br />
                <span class="tok-number">42</span> <span class="tok-tag">&lt;tag</span>{' '}
                <span class="tok-string">"value"</span> <span class="tok-tag">/&gt;</span>
              </div>
              <div class="hint">
                {resolveTheme(settings().syntaxTheme).label} — {resolveTheme(settings().syntaxTheme).basedOn}
              </div>
            </div>
            <Row label={t('settings.cornerRadius')} hint={t('settings.cornerRadiusHint')}>
              <input
                type="range"
                min={0}
                max={18}
                step={1}
                value={settings().appearance.cornerRadius}
                onInput={(e) => patchAppearance({ cornerRadius: Number(e.currentTarget.value) })}
                style={{ 'min-width': '220px' }}
              />
              <span style={{ width: '34px', 'text-align': 'right' }}>{settings().appearance.cornerRadius} px</span>
            </Row>
            <Row label={t('settings.glassTopBar')} hint={t('settings.glassTopBarHint')}>
              <input
                type="checkbox"
                checked={settings().appearance.glassTopBar}
                onChange={(e) => patchAppearance({ glassTopBar: e.currentTarget.checked })}
              />
            </Row>
            <Row label={t('settings.glassBlur')}>
              <input
                type="range"
                min={0}
                max={30}
                value={settings().appearance.glassBlur}
                onInput={(e) => patchAppearance({ glassBlur: Number(e.currentTarget.value) })}
                style={{ 'min-width': '220px' }}
              />
              <span style={{ width: '34px', 'text-align': 'right' }}>{settings().appearance.glassBlur} px</span>
            </Row>
            <Row label={t('settings.glassOpacity')}>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(settings().appearance.glassOpacity * 100)}
                onInput={(e) => patchAppearance({ glassOpacity: Number(e.currentTarget.value) / 100 })}
                style={{ 'min-width': '220px' }}
              />
              <span style={{ width: '34px', 'text-align': 'right' }}>
                {Math.round(settings().appearance.glassOpacity * 100)}%
              </span>
            </Row>
            <Row label={t('settings.gradient')} hint={t('settings.gradientHint')}>
              <input
                type="checkbox"
                checked={settings().appearance.gradient}
                onChange={(e) => patchAppearance({ gradient: e.currentTarget.checked })}
              />
            </Row>
            <Row label={t('settings.gradientColours')}>
              <input
                type="color"
                value={settings().appearance.gradientFrom}
                onInput={(e) => patchAppearance({ gradientFrom: e.currentTarget.value })}
              />
              <input
                type="color"
                value={settings().appearance.gradientTo}
                onInput={(e) => patchAppearance({ gradientTo: e.currentTarget.value })}
              />
            </Row>
            <Row label={t('settings.accentColor')} hint={t('settings.accentColorHint')}>
              <input
                type="color"
                value={settings().appearance.accentColor}
                onInput={(e) => patchAppearance({ accentColor: e.currentTarget.value })}
              />
            </Row>
            <Row label={t('settings.density')}>
              <select
                value={settings().appearance.density}
                onChange={(e) => patchAppearance({ density: e.currentTarget.value as never })}
              >
                <option value="compact">{t('settings.densityCompact')}</option>
                <option value="cozy">{t('settings.densityCozy')}</option>
                <option value="comfortable">{t('settings.densityComfortable')}</option>
              </select>
            </Row>
            <Row label={t('settings.tabStyle')}>
              <select
                value={settings().appearance.tabStyle}
                onChange={(e) => patchAppearance({ tabStyle: e.currentTarget.value as never })}
              >
                <option value="rounded">{t('settings.tabStyleRounded')}</option>
                <option value="pill">{t('settings.tabStylePill')}</option>
                <option value="underline">{t('settings.tabStyleUnderline')}</option>
              </select>
            </Row>
            <Row label={t('settings.uiScale')} hint={t('settings.uiScaleHint')}>
              <input
                type="range"
                min={0.85}
                max={1.25}
                step={0.05}
                value={settings().uiScale ?? 1}
                onInput={(e) => patch({ uiScale: Number(e.currentTarget.value) })}
                style={{ 'min-width': '220px' }}
              />
              <span style={{ width: '44px', 'text-align': 'right' }}>
                {Math.round((settings().uiScale ?? 1) * 100)}%
              </span>
            </Row>
            <Row label={t('settings.minimalToolbar')} hint={t('settings.minimalToolbarHint')}>
              <input
                type="checkbox"
                checked={settings().minimalToolbar}
                onChange={(e) => patch({ minimalToolbar: e.currentTarget.checked })}
              />
            </Row>
            <Row label={t('settings.powerSave')} hint={t('settings.powerSaveHint')}>
              <input
                type="checkbox"
                checked={settings().powerSave}
                onChange={(e) => patch({ powerSave: e.currentTarget.checked })}
              />
            </Row>
            <Row label={t('settings.softShadows')}>
              <input
                type="checkbox"
                checked={settings().appearance.softShadows}
                onChange={(e) => patchAppearance({ softShadows: e.currentTarget.checked })}
              />
            </Row>
            <Row label={t('settings.animations')}>
              <input
                type="checkbox"
                checked={settings().appearance.animations}
                onChange={(e) => patchAppearance({ animations: e.currentTarget.checked })}
              />
            </Row>
            <Row label={t('settings.lowMemory')} hint={t('settings.lowMemoryHint')}>
              <input
                type="checkbox"
                checked={settings().lowMemory}
                onChange={(e) => patch({ lowMemory: e.currentTarget.checked })}
              />
            </Row>
            <Row label={t('settings.softwareRendering')} hint={t('settings.softwareRenderingHint')}>
              <input
                type="checkbox"
                checked={settings().softwareRendering}
                onChange={(e) => patch({ softwareRendering: e.currentTarget.checked })}
              />
            </Row>
            <Row label={t('settings.showStatusBar')}>
              <input
                type="checkbox"
                checked={settings().showStatusBar}
                onChange={(e) => {
                  useAppStore.getState().setSettings({ showStatusBar: e.currentTarget.checked })
                  useAppStore.setState({ statusBarVisible: e.currentTarget.checked })
                  void useAppStore.getState().saveSettings()
                }}
              />
            </Row>
            <Row label={t('settings.showSidebarOnStart')}>
              <input
                type="checkbox"
                checked={settings().showSidebar}
                onChange={(e) => {
                  useAppStore.getState().setSettings({ showSidebar: e.currentTarget.checked })
                  useAppStore.setState({ sidebarVisible: e.currentTarget.checked })
                  void useAppStore.getState().saveSettings()
                }}
              />
            </Row>
            <div style={{ 'margin-top': '14px' }}>
              <div class="panel-header">
                <span>{t('settings.preview')}</span>
              </div>
              <div class="appearance-preview">
                <div class="preview-top">
                  <span class="preview-dot" />
                  <span style={{ 'font-size': '11px', color: '#fff' }}>FlintQode</span>
                </div>
                <div class="preview-body">
                  <div class="preview-panel" />
                  <div class="preview-button">{t('settings.previewButton')}</div>
                </div>
              </div>
            </div>
          </Match>

          <Match when={section() === 'typography'}>
            <div class="panel-header">
              <span>{t('settings.typographyTitle')}</span>
              <span>{t('settings.typographyHintShort')}</span>
            </div>
            <div class="hint" style={{ 'margin-top': 0, 'margin-bottom': '10px' }}>
              {t('settings.typographyHintLong')}
            </div>
            <Row label={t('settings.fontFamily')} hint={t('settings.fontFamilyHint')}>
              <input
                type="text"
                list="flintqode-font-choices"
                value={settings().fontFamily}
                placeholder='"Cascadia Code", ui-monospace, monospace'
                style={{ 'min-width': '300px' }}
                onInput={(e) => useAppStore.getState().setSettings({ fontFamily: e.currentTarget.value })}
              />
              <datalist id="flintqode-font-choices">
                <For each={FONT_CHOICES}>{(font) => <option value={font} />}</For>
              </datalist>
            </Row>
            <Row label={t('settings.fontSize')} hint={t('settings.fontSizeHint')}>
              <input
                type="range"
                min={8}
                max={32}
                step={1}
                value={settings().fontSize}
                onInput={(e) => useAppStore.getState().setSettings({ fontSize: Number(e.currentTarget.value) })}
                style={{ 'min-width': '200px' }}
              />
              <input
                type="number"
                min={8}
                max={40}
                value={settings().fontSize}
                onInput={(e) => useAppStore.getState().setSettings({ fontSize: Number(e.currentTarget.value) })}
                style={{ width: '68px' }}
              />
              <span class="hint">px</span>
            </Row>
            <Row label={t('settings.fontWeight')} hint={t('settings.fontWeightHint')}>
              <select
                value={settings().fontWeight}
                onChange={(e) => useAppStore.getState().setSettings({ fontWeight: Number(e.currentTarget.value) })}
              >
                <option value={300}>{t('settings.fontWeightLight')}</option>
                <option value={400}>{t('settings.fontWeightNormal')}</option>
                <option value={500}>{t('settings.fontWeightMedium')}</option>
                <option value={600}>{t('settings.fontWeightSemibold')}</option>
                <option value={700}>{t('settings.fontWeightBold')}</option>
              </select>
            </Row>
            <Row label={t('settings.fontStyle')} hint={t('settings.fontStyleHint')}>
              <select
                value={settings().fontStyle}
                onChange={(e) =>
                  useAppStore.getState().setSettings({ fontStyle: e.currentTarget.value as 'normal' | 'italic' })
                }
              >
                <option value="normal">{t('settings.fontStyleNormal')}</option>
                <option value="italic">{t('settings.fontStyleItalic')}</option>
              </select>
            </Row>
            <Row label={t('settings.lineHeight')} hint={t('settings.lineHeightHint')}>
              <input
                type="range"
                min={1}
                max={2.4}
                step={0.05}
                value={settings().lineHeight}
                onInput={(e) => useAppStore.getState().setSettings({ lineHeight: Number(e.currentTarget.value) })}
                style={{ 'min-width': '200px' }}
              />
              <span style={{ width: '44px', 'text-align': 'right' }}>{settings().lineHeight.toFixed(2)}</span>
            </Row>
            <Row label={t('settings.letterSpacing')} hint={t('settings.letterSpacingHint')}>
              <input
                type="range"
                min={-1}
                max={4}
                step={0.1}
                value={settings().letterSpacing}
                onInput={(e) => useAppStore.getState().setSettings({ letterSpacing: Number(e.currentTarget.value) })}
                style={{ 'min-width': '200px' }}
              />
              <span style={{ width: '44px', 'text-align': 'right' }}>{settings().letterSpacing.toFixed(1)} px</span>
            </Row>
            <Row label={t('settings.fontLigatures')} hint={t('settings.fontLigaturesHint')}>
              <input
                type="checkbox"
                checked={settings().fontLigatures}
                onChange={(e) => useAppStore.getState().setSettings({ fontLigatures: e.currentTarget.checked })}
              />
            </Row>

            <div class="panel-header" style={{ 'margin-top': '18px' }}>
              <span>{t('settings.textColours')}</span>
              <button
                class="icon-btn"
                onClick={() =>
                  useAppStore.getState().setSettings({
                    editorForeground: '',
                    editorBackgroundColor: '',
                    editorCaretColor: '',
                    editorSelectionColor: '',
                  })
                }
              >
                {t('settings.resetColours')}
              </button>
            </div>
            <div class="hint" style={{ 'margin-top': 0, 'margin-bottom': '10px' }}>
              {t('settings.textColoursHint')}
            </div>
            <Row label={t('settings.editorTextColour')} hint={t('settings.colourAutoHint')}>
              <input
                type="color"
                value={settings().editorForeground || '#e6e9ef'}
                onInput={(e) => useAppStore.getState().setSettings({ editorForeground: e.currentTarget.value })}
              />
              <button class="icon-btn" onClick={() => useAppStore.getState().setSettings({ editorForeground: '' })}>
                {t('settings.colourAuto')}
              </button>
            </Row>
            <Row label={t('settings.editorBackgroundColour')} hint={t('settings.colourAutoHint')}>
              <input
                type="color"
                value={settings().editorBackgroundColor || '#ffffff'}
                onInput={(e) => useAppStore.getState().setSettings({ editorBackgroundColor: e.currentTarget.value })}
              />
              <button
                class="icon-btn"
                onClick={() => useAppStore.getState().setSettings({ editorBackgroundColor: '' })}
              >
                {t('settings.colourAuto')}
              </button>
            </Row>
            <Row label={t('settings.editorCaretColour')} hint={t('settings.colourAutoHint')}>
              <input
                type="color"
                value={settings().editorCaretColor || '#2563eb'}
                onInput={(e) => useAppStore.getState().setSettings({ editorCaretColor: e.currentTarget.value })}
              />
              <button class="icon-btn" onClick={() => useAppStore.getState().setSettings({ editorCaretColor: '' })}>
                {t('settings.colourAuto')}
              </button>
            </Row>
            <Row label={t('settings.editorSelectionColour')} hint={t('settings.colourAutoHint')}>
              <input
                type="color"
                value={settings().editorSelectionColor || '#2563eb'}
                onInput={(e) => useAppStore.getState().setSettings({ editorSelectionColor: e.currentTarget.value })}
              />
              <button class="icon-btn" onClick={() => useAppStore.getState().setSettings({ editorSelectionColor: '' })}>
                {t('settings.colourAuto')}
              </button>
            </Row>

            <div class="panel-header" style={{ 'margin-top': '18px' }}>
              <span>{t('settings.syntaxColours')}</span>
              <button class="icon-btn" onClick={resetSyntaxColors}>
                {t('settings.resetSyntaxColours')}
              </button>
            </div>
            <div class="hint" style={{ 'margin-top': 0, 'margin-bottom': '10px' }}>
              {t('settings.syntaxColoursHint')}
            </div>
            <div class="syntax-color-grid">
              <For each={SYNTAX_COLOR_KEYS}>
                {(key) => (
                  <div class="syntax-color-row">
                    <span>{t(`settings.token.${key}` as MessageKey)}</span>
                    <input
                      type="color"
                      value={tokenColor(key)}
                      aria-label={t(`settings.token.${key}` as MessageKey)}
                      onInput={(e) => setSyntaxColor(key, e.currentTarget.value)}
                    />
                    <button class="icon-btn" title={t('settings.colourAuto')} onClick={() => setSyntaxColor(key, '')}>
                      {t('settings.colourAuto')}
                    </button>
                  </div>
                )}
              </For>
            </div>

            <div class="panel-header" style={{ 'margin-top': '18px' }}>
              <span>{t('settings.typographyPreview')}</span>
              <span>{t('settings.typographyPreviewHint')}</span>
            </div>
            <pre
              class="typography-preview"
              style={{
                'font-family': settings().fontFamily,
                'font-size': `${settings().fontSize}px`,
                'font-weight': settings().fontWeight,
                'font-style': settings().fontStyle,
                'line-height': settings().lineHeight,
                'letter-spacing': `${settings().letterSpacing}px`,
                'font-variant-ligatures': settings().fontLigatures ? 'common-ligatures contextual' : 'none',
                color: settings().editorForeground || undefined,
                background: settings().editorBackgroundColor || undefined,
              }}
            >
              <span class="tok-keyword" style={{ color: tokenColor('keyword') }}>
                function
              </span>{' '}
              <span class="tok-function" style={{ color: tokenColor('function') }}>
                greet
              </span>
              (
              <span class="tok-type" style={{ color: tokenColor('type') }}>
                User
              </span>{' '}
              <span class="tok-property" style={{ color: tokenColor('property') }}>
                name
              </span>
              ) {'{'}
              {'\n'} {'  '}
              <span class="tok-comment" style={{ color: tokenColor('comment') }}>
                // 0123456789 — careful with l/i/1 and O/0
              </span>
              {'\n'} {'  '}
              <span class="tok-keyword" style={{ color: tokenColor('keyword') }}>
                const
              </span>{' '}
              <span class="tok-variable" style={{ color: tokenColor('variable') }}>
                limit
              </span>{' '}
              <span class="tok-operator" style={{ color: tokenColor('operator') }}>
                =
              </span>{' '}
              <span class="tok-number" style={{ color: tokenColor('number') }}>
                42
              </span>
              {'\n'} {'  '}
              <span class="tok-keyword" style={{ color: tokenColor('keyword') }}>
                return
              </span>{' '}
              <span class="tok-string" style={{ color: tokenColor('string') }}>
                `Hello ${'{'}name{'}'}`
              </span>
              {'\n'}
              {'}'}
            </pre>
          </Match>

          <Match when={section() === 'icons'}>
            <div class="panel-header">
              <span>{t('settings.fileIcons')}</span>
              <span>{t('settings.themeCount', { count: ICON_THEMES.length })}</span>
            </div>
            <div class="icon-gallery">
              <For each={ICON_THEMES}>
                {(theme) => (
                  <button
                    class={['icon-card', { active: settings().iconTheme === theme.id }]}
                    onClick={() => patch({ iconTheme: theme.id })}
                    title={theme.basedOn}
                  >
                    <span style={{ display: 'flex', gap: '2px', 'align-items': 'center' }}>
                      <FileIcon name="Main.java" theme={theme.id} size={15} />
                      <FileIcon name="app.ts" theme={theme.id} size={15} />
                      <FileIcon name="notes.md" theme={theme.id} size={15} />
                      <FileIcon name="data.json" theme={theme.id} size={15} />
                    </span>
                    <span class="name">{theme.label}</span>
                  </button>
                )}
              </For>
            </div>
            <div class="hint" style={{ 'margin-top': '8px' }}>
              {ICON_THEMES.find((icon) => icon.id === settings().iconTheme)?.basedOn}
            </div>

            <div class="panel-header" style={{ 'margin-top': '18px' }}>
              <span>{t('settings.sounds')}</span>
              <span>{t('settings.themeCount', { count: SOUND_THEMES.length })}</span>
            </div>
            <Row label={t('settings.playSounds')}>
              <input
                type="checkbox"
                checked={settings().soundsEnabled}
                onChange={(e) => patch({ soundsEnabled: e.currentTarget.checked })}
              />
            </Row>
            <Row label={t('settings.soundVolume')}>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(settings().soundVolume * 100)}
                onInput={(e) =>
                  useAppStore.getState().setSettings({ soundVolume: Number(e.currentTarget.value) / 100 })
                }
                style={{ 'min-width': '220px' }}
              />
              <span style={{ width: '34px', 'text-align': 'right' }}>{Math.round(settings().soundVolume * 100)}%</span>
            </Row>
            <div class="icon-gallery" style={{ 'margin-top': '6px' }}>
              <For each={SOUND_THEMES}>
                {(theme) => (
                  <button
                    class={['icon-card', { active: settings().soundTheme === theme.id }]}
                    onClick={() => {
                      useAppStore.getState().setSettings({ soundTheme: theme.id })
                      void useAppStore.getState().saveSettings()
                      playSound('save', theme.id, 0.5)
                    }}
                    title={theme.basedOn}
                  >
                    <span class="name">{theme.label}</span>
                    <span
                      style={{ 'margin-left': 'auto', 'font-size': '10px', color: 'var(--fg-muted)' }}
                      onClick={(e) => {
                        e.stopPropagation()
                        playSound('complete', theme.id, 0.5)
                      }}
                    >
                      {t('settings.testSound')}
                    </span>
                  </button>
                )}
              </For>
            </div>
            <div class="hint" style={{ 'margin-top': '8px' }}>
              {t('settings.soundsHint')}
            </div>
          </Match>

          <Match when={section() === 'toolchain'}>
            <div class="panel-header">
              <span>{t('settings.toolchainTitle')}</span>
              <span>{t('settings.toolchainPaths')}</span>
            </div>
            <div class="hint" style={{ 'margin-top': 0, 'margin-bottom': '10px' }}>
              {t('settings.toolchainHintLong')}
            </div>
            <For each={TOOLCHAIN_LANGUAGES}>
              {(entry) => (
                <Row label={entry.label} hint={TOOLCHAIN_HINTS[entry.id] ?? entry.hint}>
                  <input
                    type="text"
                    placeholder={entry.placeholder}
                    value={settings().toolchain[entry.id] ?? ''}
                    style={{ 'min-width': '280px' }}
                    onInput={(e) =>
                      useAppStore.getState().setSettings({
                        toolchain: { ...settings().toolchain, [entry.id]: e.currentTarget.value },
                      })
                    }
                  />
                  <button
                    class="icon-btn"
                    title={t('common.browse')}
                    onClick={async () => {
                      const result = await window.api.fs.openDialog({
                        title: t('settings.selectFolder', { name: entry.label }),
                        directory: true,
                      })
                      const folder = result.filePaths[0]
                      if (!folder) return
                      const exe = entry.exe?.replace(/^[\\/]+/, '').replace(/\\/g, '/')
                      const path = exe ? `${folder.replace(/[\\/]+$/, '')}/${exe}` : folder
                      useAppStore.getState().setSettings({
                        toolchain: { ...settings().toolchain, [entry.id]: path },
                      })
                      void useAppStore.getState().saveSettings()
                    }}
                  >
                    …
                  </button>
                </Row>
              )}
            </For>

            <div class="panel-header" style={{ 'margin-top': '16px' }}>
              <span>{t('settings.lspServers')}</span>
              <span>LSP</span>
            </div>
            <div class="hint" style={{ 'margin-top': 0, 'margin-bottom': '10px' }}>
              {t('settings.lspServersHintLong')}
            </div>
            <For each={LSP_LANGUAGES}>
              {(language) => (
                <Row label={language}>
                  <input
                    type="text"
                    placeholder={t('settings.defaultValue')}
                    value={settings().lspServers[language]?.command ?? ''}
                    style={{ 'min-width': '280px' }}
                    onInput={(e) =>
                      useAppStore.getState().setSettings({
                        lspServers: {
                          ...settings().lspServers,
                          [language]: {
                            command: e.currentTarget.value,
                            args: settings().lspServers[language]?.args,
                          },
                        },
                      })
                    }
                  />
                </Row>
              )}
            </For>

            <div class="panel-header" style={{ 'margin-top': '16px' }}>
              <span>{t('panel.files')}</span>
            </div>
            <Row label={t('settings.projectFolder')} hint={t('settings.projectFolderHint')}>
              <input
                type="text"
                placeholder={t('settings.projectFolderPlaceholder')}
                value={settings().projectFolder ?? ''}
                style={{ 'min-width': '280px' }}
                onInput={(e) => useAppStore.getState().setSettings({ projectFolder: e.currentTarget.value || null })}
              />
              <button
                class="icon-btn"
                title={t('common.browse')}
                onClick={async () => {
                  const result = await window.api.fs.openDialog({
                    title: t('settings.selectProjectFolder'),
                    directory: true,
                  })
                  const folder = result.filePaths[0]
                  if (!folder) return
                  useAppStore.getState().setSettings({ projectFolder: folder })
                  void useAppStore.getState().saveSettings()
                }}
              >
                …
              </button>
            </Row>
            <Row label={t('settings.configurationFile')} hint={t('settings.configurationFileHint')}>
              <span class="hint" style={{ 'text-align': 'right' }}>
                {projectFolder()
                  ? `${projectFolder()?.replace(/[\\/]+$/, '')}/${PROJECT_CONFIG_NAME}`
                  : t('settings.noProjectFolder')}
              </span>
              <button
                class="icon-btn"
                title={t('settings.createProjectConfig')}
                onClick={async () => {
                  const folder = projectFolder()
                  if (!folder) return
                  const existing = (await readProjectConfig(folder)) ?? {}
                  await writeProjectConfig(folder, {
                    toolchain: { ...settings().toolchain, ...(existing.toolchain ?? {}) },
                    lsp: { ...settings().lspServers, ...(existing.lsp ?? {}) },
                    terminal: existing.terminal,
                    run: existing.run,
                  })
                  patch({ projectFolder: folder })
                  useAppStore.getState().toast(t('settings.projectConfigWritten'), 'success')
                }}
              >
                {t('common.save')}
              </button>
            </Row>
          </Match>

          <Match when={section() === 'workspace'}>
            <Row label={t('settings.language')} hint={t('settings.languageHint')}>
              <select
                value={settings().language}
                onChange={(e) => {
                  const locale = e.currentTarget.value as LocaleId
                  void setLocale(locale)
                }}
              >
                <For each={LOCALES}>
                  {(locale) => (
                    <option value={locale.id}>
                      {locale.nativeName} — {locale.englishName}
                    </option>
                  )}
                </For>
              </select>
            </Row>
            <Row
              label={t('settings.translationStatus')}
              hint={t('settings.translationProgress', {
                percent: progress().percent,
                done: progress().done,
                total: progress().total,
              })}
            >
              <span class="hint" style={{ 'text-align': 'right' }}>
                {progress().percent}%
              </span>
            </Row>
            <Row label={t('settings.workspace')} hint={t('settings.workspaceHint')}>
              <span class="hint" style={{ 'max-width': '320px', 'text-align': 'right' }}>
                {t('settings.workspaceCoding')}
              </span>
            </Row>
            <Row label={t('settings.mainMenu')} hint={t('settings.mainMenuHint')}>
              <select
                value={settings().mainMenuStyle}
                onChange={(e) => patch({ mainMenuStyle: e.currentTarget.value as never })}
              >
                <option value="hamburger">{t('settings.menuHamburger')}</option>
                <option value="native">{t('settings.menuNative')}</option>
                <option value="both">{t('settings.menuBoth')}</option>
              </select>
            </Row>
            <Row label={t('settings.terminalCloseOnHide')} hint={t('settings.terminalCloseOnHideHint')}>
              <input
                type="checkbox"
                checked={settings().closeOnPanelHide ?? false}
                onChange={(e) => patch({ closeOnPanelHide: e.currentTarget.checked })}
              />
            </Row>
            <div class="hint">
              The native Windows menu bar stays reachable with the <kbd>Alt</kbd> key, exactly like other open-source
              editors. Every command is also available in the command palette (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+
              <kbd>P</kbd>).
            </div>
          </Match>

          <Match when={section() === 'editor'}>
            <Row label={t('settings.lineWrapping')}>
              <input
                type="checkbox"
                checked={settings().lineWrapping}
                onChange={(e) => useAppStore.getState().setSettings({ lineWrapping: e.currentTarget.checked })}
              />
            </Row>
            <Row label={t('settings.showLineNumbers')}>
              <input
                type="checkbox"
                checked={settings().showLineNumbers}
                onChange={(e) => useAppStore.getState().setSettings({ showLineNumbers: e.currentTarget.checked })}
              />
            </Row>
            <Row label={t('settings.direction')}>
              <select
                value={settings().direction}
                onChange={(e) =>
                  useAppStore.getState().setSettings({ direction: e.currentTarget.value as 'ltr' | 'rtl' })
                }
              >
                <option value="ltr">LTR</option>
                <option value="rtl">RTL (Right-to-left)</option>
              </select>
            </Row>
            <Row label={t('settings.gitGutter')} hint={t('settings.gitGutterHint')}>
              <input
                type="checkbox"
                checked={settings().gitGutter}
                onChange={(e) => useAppStore.getState().setSettings({ gitGutter: e.currentTarget.checked })}
              />
            </Row>
            <Row label={t('settings.overwriteMode')}>
              <input
                type="checkbox"
                checked={settings().overwriteMode}
                onChange={(e) => useAppStore.getState().setSettings({ overwriteMode: e.currentTarget.checked })}
              />
            </Row>
            <Row label={t('settings.scrollPastEnd')}>
              <input
                type="checkbox"
                checked={settings().scrollPastEnd}
                onChange={(e) => useAppStore.getState().setSettings({ scrollPastEnd: e.currentTarget.checked })}
              />
            </Row>
            <Row label={t('settings.autosaveInterval')} hint={t('settings.autosaveIntervalHint')}>
              <input
                type="number"
                min={0}
                max={120}
                step={1}
                value={settings().autosaveInterval}
                onInput={(e) =>
                  useAppStore.getState().setSettings({
                    autosaveInterval: Math.max(0, Number(e.currentTarget.value) || 0),
                  })
                }
                style={{ width: '90px' }}
              />
              <span class="hint">min</span>
            </Row>
            <Row label={t('settings.showInvisibles')}>
              <input
                type="checkbox"
                checked={settings().showInvisibles}
                onChange={(e) => useAppStore.getState().setSettings({ showInvisibles: e.currentTarget.checked })}
              />
            </Row>
            <Row label={t('settings.showMinimap')}>
              <input
                type="checkbox"
                checked={settings().showMinimap}
                onChange={(e) => useAppStore.getState().setSettings({ showMinimap: e.currentTarget.checked })}
              />
            </Row>
            <Row label={t('settings.showIndentGuides')}>
              <input
                type="checkbox"
                checked={settings().showIndentGuides}
                onChange={(e) => useAppStore.getState().setSettings({ showIndentGuides: e.currentTarget.checked })}
              />
            </Row>
            <Row label={t('settings.highlightActiveLine')}>
              <input
                type="checkbox"
                checked={settings().highlightActiveLine}
                onChange={(e) => useAppStore.getState().setSettings({ highlightActiveLine: e.currentTarget.checked })}
              />
            </Row>
            <Row label={t('settings.matchBrackets')}>
              <input
                type="checkbox"
                checked={settings().matchBrackets}
                onChange={(e) => useAppStore.getState().setSettings({ matchBrackets: e.currentTarget.checked })}
              />
            </Row>
            <Row label={t('settings.autoCloseBrackets')}>
              <input
                type="checkbox"
                checked={settings().autoCloseBrackets}
                onChange={(e) => useAppStore.getState().setSettings({ autoCloseBrackets: e.currentTarget.checked })}
              />
            </Row>
            <Row label={t('settings.autoIndent')}>
              <input
                type="checkbox"
                checked={settings().autoIndent}
                onChange={(e) => useAppStore.getState().setSettings({ autoIndent: e.currentTarget.checked })}
              />
            </Row>
            <Row label={t('settings.trimTrailingWhitespace')}>
              <input
                type="checkbox"
                checked={settings().trimTrailingWhitespace}
                onChange={(e) =>
                  useAppStore.getState().setSettings({ trimTrailingWhitespace: e.currentTarget.checked })
                }
              />
            </Row>
            <Row label={t('settings.tabSize')}>
              <input
                type="number"
                min={1}
                max={16}
                value={settings().tabSize}
                onInput={(e) => useAppStore.getState().setSettings({ tabSize: Number(e.currentTarget.value) })}
              />
            </Row>
            <Row label={t('settings.insertSpaces')}>
              <input
                type="checkbox"
                checked={settings().insertSpaces}
                onChange={(e) => useAppStore.getState().setSettings({ insertSpaces: e.currentTarget.checked })}
              />
            </Row>
            <Row label={t('settings.spellcheck')}>
              <input
                type="checkbox"
                checked={settings().spellcheck}
                onChange={(e) => useAppStore.getState().setSettings({ spellcheck: e.currentTarget.checked })}
              />
            </Row>
          </Match>

          <Match when={section() === 'files'}>
            <Row label={t('settings.defaultEncoding')}>
              <select
                value={settings().defaultEncoding}
                onChange={(e) => useAppStore.getState().setSettings({ defaultEncoding: e.currentTarget.value })}
              >
                <For each={Object.entries(ENCODING_LABELS).filter(([key]) => key !== 'binary')}>
                  {([key, label]) => <option value={key}>{label}</option>}
                </For>
              </select>
            </Row>
            <Row label={t('settings.defaultEol')}>
              <select
                value={settings().defaultEol}
                onChange={(e) => useAppStore.getState().setSettings({ defaultEol: e.currentTarget.value as never })}
              >
                <For each={Object.entries(EOL_LABELS)}>{([key, label]) => <option value={key}>{label}</option>}</For>
              </select>
            </Row>
            <Row label={t('settings.restoreSession')}>
              <input
                type="checkbox"
                checked={settings().restoreSession}
                onChange={(e) => useAppStore.getState().setSettings({ restoreSession: e.currentTarget.checked })}
              />
            </Row>
            <Row label={t('settings.autosave')}>
              <input
                type="number"
                min={0}
                max={600}
                value={settings().autosaveInterval}
                onInput={(e) => useAppStore.getState().setSettings({ autosaveInterval: Number(e.currentTarget.value) })}
              />
            </Row>
            <Row label={t('settings.defaultLanguage')}>
              <span class="hint" style={{ 'max-width': '320px', 'text-align': 'right' }}>
                {t('settings.defaultLanguageHint')}
              </span>
            </Row>
            <div class="form-row">
              <div>
                <div>{t('settings.resetAll')}</div>
                <div class="hint">{t('settings.resetAllHint')}</div>
              </div>
              <div class="control">
                <button
                  class="icon-btn"
                  onClick={() => {
                    useAppStore.getState().setSettings({ ...DEFAULT_SETTINGS })
                    void useAppStore.getState().saveSettings()
                  }}
                >
                  {t('common.reset')}
                </button>
              </div>
            </div>
          </Match>

          <Match when={section() === 'shortcuts'}>
            <div class="hint" style={{ 'margin-top': 0, 'margin-bottom': '10px' }}>
              {t('settings.keybindingsHintLong')} <code>{keybindingsPath()}</code>
            </div>
            <div class="form-row">
              <div>
                <div>{t('settings.keybindingImportTitle')}</div>
                <div class="hint">{t('settings.keybindingImportHint2')}</div>
              </div>
              <div class="control" style={{ display: 'flex', gap: '6px' }}>
                <input
                  type="text"
                  placeholder='[ { "key": "ctrl+s", "command": "..." } ]'
                  value={importText()}
                  style={{ 'min-width': '280px' }}
                  onInput={(e) => setImportText(e.currentTarget.value)}
                />
                <button
                  class="icon-btn"
                  title={t('common.import')}
                  onClick={() => {
                    const imported = fromVSCode(importText())
                    const names = Object.keys(imported)
                    if (!names.length) {
                      useAppStore.getState().toast(t('settings.keybindingImportFailed'), 'error')
                      return
                    }
                    void readKeybindings().then(async (current) => {
                      const next = { ...current, ...imported }
                      await writeKeybindings(next)
                      setKeybindings(next)
                      useAppStore.getState().toast(t('settings.keybindingImported', { count: names.length }), 'success')
                    })
                  }}
                >
                  {t('common.import')}
                </button>
              </div>
            </div>
            <div class="form-row">
              <div>
                <div>{t('settings.keybindings')}</div>
                <div class="hint">{t('settings.keybindingsChangeHint')}</div>
              </div>
              <div class="control" style={{ 'min-width': '280px', 'max-height': '260px', overflow: 'auto' }}>
                <For each={commandsWithShortcuts}>
                  {(command) => (
                    <div class="keybinding-row">
                      <span class="name" title={command.id}>
                        {tWith(commandKey(command.id), command.title)}
                      </span>
                      <input
                        type="text"
                        class="keybinding-input"
                        value={bindings()[command.id] ?? command.shortcut ?? ''}
                        onInput={(e) => {
                          const next = { ...bindings() }
                          if (e.currentTarget.value.trim()) next[command.id] = e.currentTarget.value.trim()
                          else delete next[command.id]
                          setBindings(next)
                          setKeybindings(next)
                          void writeKeybindings(next)
                        }}
                      />
                    </div>
                  )}
                </For>
              </div>
            </div>
            <table class="kbd-table">
              <tbody>
                <For each={SHORTCUTS}>
                  {([name, keys]) => (
                    <tr>
                      <td>{t(name)}</td>
                      <td>
                        <kbd>{keys}</kbd>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </Match>

          <Match when={section() === 'updates'}>
            <div style={{ display: 'flex', 'flex-direction': 'column', gap: '10px' }}>
              <div class="hint">{t('settings.updatesHint')}</div>
              <button class="panel-button" disabled={updateBusy()} onClick={() => void checkForUpdate()}>
                <Show when={updateBusy()} fallback={t('settings.checkForUpdates')}>
                  {updateStatus()}
                </Show>
              </button>
              <Show when={updateStatus()}>{(status) => <div class="hint">{status()}</div>}</Show>
            </div>
          </Match>
        </Switch>
      </Modal>
    </Show>
  )
}
