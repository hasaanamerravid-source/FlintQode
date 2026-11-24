import { HighlightStyle } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import type { SyntaxColorKey, SyntaxTheme } from '@shared/types'
import { SYNTAX_THEMES, syntaxTheme } from './syntaxThemes'
import { THEME_PACK, themePackEntry, type ThemePackEntry } from './themePack'

/** The token colours a theme pack entry provides. */
export interface PackTokens {
  keyword: string
  string: string
  comment: string
  number: string
  function: string
  type: string
  tag: string
  property: string
  operator: string
  constant: string
  variable: string
  punctuation: string
  heading: string
  emphasis: string
  strong: string
  link: string
  invalid: string
}

export interface ResolvedTheme {
  id: string
  label: string
  group: string
  dark: boolean
  /** Where the palette comes from. */
  basedOn: string
  editor: ThemePackEntry['editor']
  style: HighlightStyle
  tokens: PackTokens
  source: 'pack' | 'builtin'
}

/** Token colours offered in the settings, in display order. */
export const SYNTAX_COLOR_KEYS: SyntaxColorKey[] = [
  'keyword',
  'string',
  'comment',
  'number',
  'function',
  'type',
  'tag',
  'property',
  'operator',
  'constant',
  'variable',
  'punctuation',
  'heading',
  'emphasis',
  'strong',
  'link',
  'invalid',
]

const HEX_COLOR = /^#[0-9a-f]{3,8}$/i

/** The effective token colours of a theme, before user overrides. */
export function syntaxTokens(id: string): PackTokens {
  const resolved = resolveTheme(id)
  if (resolved.source === 'pack') return resolved.tokens
  const p = syntaxTheme(id as SyntaxTheme).palette
  return {
    keyword: p.keyword,
    string: p.string,
    comment: p.comment,
    number: p.number,
    function: p.function,
    type: p.type,
    tag: p.tagName,
    property: p.property,
    operator: p.operator,
    constant: p.constant,
    variable: p.variable,
    punctuation: p.punctuation,
    heading: p.heading,
    emphasis: p.emphasis,
    strong: p.strong,
    link: p.link,
    invalid: p.invalid,
  }
}

/** Whether the app theme is dark ("system" follows the OS preference). */
export function settingsAreDark(theme?: string): boolean {
  if (theme === 'dark') return true
  if (theme === 'light') return false
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * Pick the syntax theme that fits the editor surface.
 *
 * In "theme" mode the editor paints its own background, so the chosen theme is
 * used as-is. In "app" mode the editor borrows the window colours, which means
 * a light palette on a dark window (or the reverse) would be unreadable; pair
 * the palette with the window instead of showing invisible text.
 */
export function editorTheme(settings: {
  syntaxTheme: string
  editorBackground: 'app' | 'theme'
  theme?: string
}): ResolvedTheme {
  const chosen = resolveTheme(settings.syntaxTheme)
  if (settings.editorBackground !== 'app') return chosen
  const dark = settingsAreDark(settings.theme)
  if (chosen.dark === dark) return chosen
  return resolveTheme(dark ? 'darcula' : 'intellij-light')
}

/**
 * The highlight style to use in the editor. With no overrides the theme's own
 * (more detailed) style is kept; once the user changes a token colour the
 * style is rebuilt from the effective palette so the change is immediate.
 */
export function syntaxStyle(id: string, overrides: Partial<Record<SyntaxColorKey, string>> = {}): HighlightStyle {
  const theme = resolveTheme(id)
  const tokens = { ...syntaxTokens(id) }
  let changed = false
  for (const key of SYNTAX_COLOR_KEYS) {
    const value = overrides[key]
    if (value && HEX_COLOR.test(value)) {
      tokens[key] = value
      changed = true
    }
  }
  return changed ? buildPackStyle(tokens) : theme.style
}

/** Build a CodeMirror highlight style from a compact token palette. */
export function buildPackStyle(tokens: PackTokens): HighlightStyle {
  return HighlightStyle.define([
    { tag: t.keyword, color: tokens.keyword },
    { tag: t.controlKeyword, color: tokens.keyword, fontWeight: 'bold' },
    { tag: t.operatorKeyword, color: tokens.keyword },
    { tag: t.definitionKeyword, color: tokens.keyword, fontWeight: 'bold' },
    { tag: t.modifier, color: tokens.keyword },
    { tag: t.operator, color: tokens.operator },
    { tag: t.constant(t.name), color: tokens.constant },
    { tag: [t.bool, t.null, t.atom, t.self], color: tokens.constant },
    { tag: [t.number, t.integer, t.float], color: tokens.number },
    { tag: [t.string, t.special(t.string)], color: tokens.string },
    { tag: [t.regexp, t.escape, t.character], color: tokens.string },
    { tag: [t.comment, t.lineComment, t.blockComment], color: tokens.comment, fontStyle: 'italic' },
    { tag: [t.docComment, t.docString], color: tokens.comment, fontStyle: 'italic' },
    { tag: [t.tagName, t.angleBracket], color: tokens.tag },
    { tag: [t.attributeName, t.attributeValue], color: tokens.property },
    { tag: [t.propertyName], color: tokens.property },
    { tag: [t.typeName, t.className, t.namespace], color: tokens.type },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: tokens.function },
    { tag: [t.macroName], color: tokens.function },
    { tag: [t.labelName], color: tokens.property },
    { tag: [t.variableName, t.local(t.variableName)], color: tokens.variable },
    { tag: [t.definition(t.variableName)], color: tokens.variable },
    { tag: [t.punctuation, t.separator, t.bracket, t.paren, t.brace, t.squareBracket], color: tokens.punctuation },
    { tag: [t.heading, t.heading1, t.heading2, t.heading3], color: tokens.heading, fontWeight: 'bold' },
    { tag: t.emphasis, color: tokens.emphasis, fontStyle: 'italic' },
    { tag: t.strong, color: tokens.strong, fontWeight: 'bold' },
    { tag: [t.link, t.url], color: tokens.link, textDecoration: 'underline' },
    { tag: t.monospace, color: tokens.string },
    { tag: t.quote, color: tokens.comment, fontStyle: 'italic' },
    { tag: t.list, color: tokens.keyword },
    { tag: t.invalid, color: tokens.invalid, textDecoration: 'underline wavy' },
  ])
}

/**
 * Display names for the colour themes.
 *
 * Several palettes originate from other projects. The credit stays in the
 * `basedOn` field, but the name the user sees is our own - FlintQode is not a
 * product of any of them.
 */
export const THEME_DISPLAY_NAMES: Record<string, string> = {
  material: 'Surface Dark',
  'material-darker': 'Surface Deeper',
  'material-palenight': 'Surface Soft',
  'material-lighter': 'Surface Light',
  'github-dark': 'Slate Dark',
  'github-light': 'Slate Light',
  'atom-dark': 'Onyx Dark',
  'atom-light': 'Onyx Light',
  'one-dark': 'Carbon Dark',
  nord: 'Frost',
  sublime: 'Vellum',
  darcula: 'FlintQode Dark',
  'intellij-light': 'FlintQode Light',
}

/** The name shown in the settings for a theme id. */
export function themeDisplayName(id: string, fallback: string): string {
  return THEME_DISPLAY_NAMES[id] ?? fallback
}

/** Resolve any theme id (pack first, then the built-in ones). */
export function resolveTheme(id: string): ResolvedTheme {
  const pack = themePackEntry(id)
  if (pack) {
    return {
      id: pack.id,
      label: themeDisplayName(pack.id, pack.label),
      group: pack.group,
      dark: pack.dark,
      basedOn: pack.basedOn,
      editor: pack.editor,
      style: buildPackStyle(pack.tokens),
      tokens: pack.tokens,
      source: 'pack',
    }
  }
  const builtin = SYNTAX_THEMES.find((theme) => theme.id === id) ?? syntaxTheme('darcula')
  const tokens: PackTokens = {
    keyword: '#cf8e6d',
    string: '#6a8759',
    comment: '#808080',
    number: '#2aacb8',
    function: '#ffc66d',
    type: '#56a8f5',
    tag: '#e06c75',
    property: '#c792ea',
    operator: '#89ddff',
    constant: '#f78c6c',
    variable: '#a9b7c6',
    punctuation: '#a9b7c6',
    heading: '#89b4fa',
    emphasis: '#a9b7c6',
    strong: '#ffc66d',
    link: '#89b4fa',
    invalid: '#ff5370',
  }
  return {
    id: builtin.id,
    label: themeDisplayName(builtin.id, builtin.label),
    group: builtin.dark ? 'Dark' : 'Light',
    dark: builtin.dark,
    basedOn: builtin.description,
    editor: builtin.editor,
    style: builtin.style,
    tokens,
    source: 'builtin',
  }
}

/** All themes (pack + built-in) for the settings gallery. */
export function allThemes(): { id: string; label: string; group: string; dark: boolean }[] {
  const pack = THEME_PACK.map((theme) => ({
    id: theme.id,
    label: themeDisplayName(theme.id, theme.label),
    group: theme.group,
    dark: theme.dark,
  }))
  const builtin = SYNTAX_THEMES.filter((theme) => !themePackEntry(theme.id)).map((theme) => ({
    id: theme.id,
    label: themeDisplayName(theme.id, theme.label),
    group: theme.dark ? 'Dark' : 'Light',
    dark: theme.dark,
  }))
  const all = [...builtin, ...pack]
  // Drop built-ins whose name is already taken by a pack theme.
  const seen = new Set(all.map((theme) => theme.label.toLowerCase()))
  return all.filter((theme, index) => {
    if (index < builtin.length) {
      return (
        !seen.has(theme.label.toLowerCase()) ||
        all.filter((t) => t.label.toLowerCase() === theme.label.toLowerCase()).length === 1
      )
    }
    return true
  })
}

/** Themes grouped for the gallery. */
export function themeGroups(): { group: string; themes: { id: string; label: string; dark: boolean }[] }[] {
  const groups = new Map<string, { id: string; label: string; dark: boolean }[]>()
  for (const theme of allThemes()) {
    const list = groups.get(theme.group) ?? []
    list.push({ id: theme.id, label: theme.label, dark: theme.dark })
    groups.set(theme.group, list)
  }
  return [...groups.entries()].map(([group, themes]) => ({ group, themes }))
}
