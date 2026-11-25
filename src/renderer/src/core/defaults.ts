import type { DiagnosticRuleConfig, DiagnosticRuleId, DiagnosticSettings, Eol, Settings } from '@shared/types'
import { DEFAULT_APPEARANCE } from './appearance'

/**
 * Built-in diagnostics. Every familiar check stays on, but the 120-character
 * warning that v1.4.7 removed is off unless the user asks for it.
 */
export const DEFAULT_DIAGNOSTICS: DiagnosticSettings = {
  rules: {
    syntax: { enabled: true },
    json: { enabled: true },
    java: { enabled: true },
    todo: { enabled: true },
    whitespace: { enabled: true },
    indentation: { enabled: true },
    eof: { enabled: true },
    lineLength: { enabled: false, limit: 120 },
  },
  languages: {},
}

/**
 * Merge stored diagnostic settings with the defaults, one rule at a time. An
 * older settings file (or a partially written one) must never leave a rule
 * without an `enabled` value.
 */
export function mergeDiagnostics(stored: DiagnosticSettings | undefined): DiagnosticSettings {
  const rules: DiagnosticSettings['rules'] = { ...DEFAULT_DIAGNOSTICS.rules }
  for (const rule of Object.keys(rules) as DiagnosticRuleId[]) {
    rules[rule] = { ...rules[rule], ...(stored?.rules?.[rule] ?? {}) }
  }
  const languages: DiagnosticSettings['languages'] = {}
  for (const [language, overrides] of Object.entries(stored?.languages ?? {})) {
    const merged: Partial<Record<DiagnosticRuleId, DiagnosticRuleConfig>> = {}
    for (const [rule, config] of Object.entries(overrides ?? {})) {
      if (config && typeof config === 'object') {
        merged[rule as DiagnosticRuleId] = { ...(rules[rule as DiagnosticRuleId] ?? {}), ...config }
      }
    }
    languages[language] = merged
  }
  return { rules, languages }
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  language: 'en',
  editorBackground: 'app',
  iconTheme: 'seti',
  toolchain: {},
  lspServers: {},
  projectFolder: null,
  soundTheme: 'subtle',
  soundVolume: 0.4,
  soundsEnabled: false,
  lowMemory: false,
  powerSave: false,
  closeOnPanelHide: false,
  uiScale: 1,
  minimalToolbar: false,
  softwareRendering: false,
  profile: 'coding',
  mainMenuStyle: 'hamburger',
  syntaxTheme: 'intellij-light',
  syntaxColors: {},
  appearance: { ...DEFAULT_APPEARANCE },
  fontFamily: '"Cascadia Code", "JetBrains Mono", "SF Mono", ui-monospace, Menlo, monospace',
  fontSize: 14,
  fontWeight: 400,
  fontStyle: 'normal',
  lineHeight: 1.55,
  letterSpacing: 0,
  fontLigatures: false,
  editorForeground: '',
  editorBackgroundColor: '',
  editorCaretColor: '',
  editorSelectionColor: '',
  tabSize: 4,
  insertSpaces: true,
  lineWrapping: true,
  scrollPastEnd: false,
  overwriteMode: false,
  showLineNumbers: true,
  showInvisibles: false,
  showMinimap: false,
  showIndentGuides: true,
  highlightActiveLine: true,
  matchBrackets: true,
  autoCloseBrackets: true,
  autoIndent: true,
  formatOnSave: false,
  trimTrailingWhitespace: false,
  defaultEncoding: 'utf8',
  defaultEol: '\r\n',
  restoreSession: true,
  autosaveInterval: 0,
  spellcheck: false,
  minimapWidth: 120,
  showStatusBar: true,
  showSidebar: true,
  sidebarWidth: 280,
  recentFiles: [],
  plugins: [],
  direction: 'ltr',
  gitGutter: true,
  diagnostics: DEFAULT_DIAGNOSTICS,
}

export const ENCODING_LABELS: Record<string, string> = {
  utf8: 'UTF-8',
  'utf8-bom': 'UTF-8 with BOM',
  'utf16-le': 'UTF-16 LE',
  'utf16-be': 'UTF-16 BE',
  'windows-1252': 'Western (ANSI)',
  'windows-1250': 'Central European (ANSI)',
  'windows-1251': 'Cyrillic (ANSI)',
  'windows-1252 ': 'Western (ANSI)',
  'windows-1253': 'Greek (ANSI)',
  'windows-1254': 'Turkish (ANSI)',
  'windows-1255': 'Hebrew (ANSI)',
  'windows-1256': 'Arabic (ANSI)',
  'windows-874': 'Thai (ANSI)',
  shift_jis: 'Japanese (Shift-JIS)',
  'euc-jp': 'Japanese (EUC-JP)',
  gbk: 'Chinese Simplified (GBK)',
  big5: 'Chinese Traditional (Big5)',
  'euc-kr': 'Korean (EUC-KR)',
  cp437: 'OEM 437',
  'iso-8859-1': 'ISO 8859-1',
  'iso-8859-2': 'ISO 8859-2',
  'iso-8859-15': 'ISO 8859-15',
  binary: 'Binary',
}

export const EOL_LABELS: Record<Eol, string> = {
  '\n': 'LF (Unix)',
  '\r\n': 'CRLF (Windows)',
  '\r': 'CR (Mac)',
}

export const FILE_FILTERS = [
  { name: 'All Files', extensions: ['*'] },
  { name: 'Text Documents', extensions: ['txt', 'log', 'ini', 'cfg', 'conf'] },
  { name: 'Markdown', extensions: ['md', 'markdown', 'mdx'] },
  {
    name: 'Code',
    extensions: [
      'js',
      'jsx',
      'ts',
      'tsx',
      'json',
      'html',
      'css',
      'scss',
      'py',
      'java',
      'c',
      'h',
      'cpp',
      'cs',
      'rs',
      'go',
      'php',
      'sql',
      'sh',
      'ps1',
      'bat',
      'rb',
      'lua',
      'xml',
      'yaml',
      'yml',
      'toml',
    ],
  },
]
