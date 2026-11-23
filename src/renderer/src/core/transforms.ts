/**
 * Pure text transforms.
 *
 * Every function in this module takes plain text and returns plain text. Nothing here
 * touches the DOM, CodeMirror or the file system, which keeps the transforms easy to
 * unit test and safe to call from a command handler.
 *
 * Line endings of the input are preserved: a CRLF document stays CRLF after a
 * transform, and a trailing newline is kept where it makes sense.
 */

/** A line separator recognised by the transforms. */
type Eol = '\n' | '\r\n' | '\r'

const LINE_SPLIT = /\r\n|\n|\r/
const TRAILING_EOL = /(?:\r\n|\n|\r)$/

interface SplitText {
  eol: Eol
  lines: string[]
  /** True when the original text ended with a line separator. */
  trailing: boolean
}

/** Guess the dominant line ending of a text. */
function detectEol(text: string): Eol {
  const crlf = (text.match(/\r\n/g) ?? []).length
  const lf = (text.match(/\n/g) ?? []).length - crlf
  const cr = (text.match(/\r/g) ?? []).length - crlf
  if (crlf > 0 && crlf >= lf && crlf >= cr) return '\r\n'
  if (cr > 0 && cr > lf) return '\r'
  return '\n'
}

/** Split a text into lines, remembering the line ending and a trailing separator. */
function splitLines(text: string): SplitText {
  if (text === '') return { eol: '\n', lines: [], trailing: false }
  const eol = detectEol(text)
  const match = TRAILING_EOL.exec(text)
  const trailing = match !== null
  const body = trailing ? text.slice(0, text.length - match[0].length) : text
  return { eol, lines: body.split(LINE_SPLIT), trailing }
}

/** Re-assemble lines with the given line ending. */
function assemble(lines: string[], eol: Eol, trailing: boolean): string {
  if (!lines.length) return ''
  return lines.join(eol) + (trailing ? eol : '')
}

/**
 * Sort the lines of a text.
 *
 * The comparison is a plain lexicographic one so the result is stable and does not
 * depend on the machine locale.
 */
export function sortLines(text: string, desc = false): string {
  const { eol, lines, trailing } = splitLines(text)
  const sorted = [...lines].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  if (desc) sorted.reverse()
  return assemble(sorted, eol, trailing)
}

/** Remove duplicated lines, keeping the first occurrence of each one. */
export function removeDuplicateLines(text: string): string {
  const { eol, lines, trailing } = splitLines(text)
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of lines) {
    if (seen.has(line)) continue
    seen.add(line)
    out.push(line)
  }
  return assemble(out, eol, trailing)
}

/** Remove lines that contain nothing but whitespace. */
export function removeBlankLines(text: string): string {
  const { eol, lines, trailing } = splitLines(text)
  const out = lines.filter((line) => line.trim().length > 0)
  return assemble(out, eol, trailing)
}

/** Strip trailing spaces and tabs from every line. */
export function trimTrailingWhitespace(text: string): string {
  const { eol, lines, trailing } = splitLines(text)
  const out = lines.map((line) => line.replace(/[ \t\f\v\u00A0]+$/, ''))
  return assemble(out, eol, trailing)
}

/**
 * Join every line into a single line.
 *
 * Each line is trimmed and the lines are separated by a single space, so the result
 * reads as one continuous sentence.
 */
export function joinLines(text: string): string {
  const { lines } = splitLines(text)
  return lines.map((line) => line.trim()).join(' ')
}

/** Capitalise the first cased character of a text. */
function capitalizeFirst(text: string): string {
  const index = text.search(/\p{L}/u)
  if (index === -1) return text
  return text.slice(0, index) + text.charAt(index).toUpperCase() + text.slice(index + 1)
}

/** Flip the case of every cased character. */
function toggleCase(text: string): string {
  let out = ''
  for (const ch of text) {
    const lower = ch.toLowerCase()
    const upper = ch.toUpperCase()
    if (lower === upper) out += ch
    else if (ch === lower) out += upper
    else out += lower
  }
  return out
}

/**
 * Change the case of a text.
 *
 * - `upper` / `lower` simply transform the whole text.
 * - `title` capitalises the first letter of every word and lowercases the rest of it.
 * - `sentence` capitalises the first letter of the text.
 * - `toggle` flips the case of every character.
 */
export function changeCase(text: string, mode: 'upper' | 'lower' | 'title' | 'sentence' | 'toggle'): string {
  switch (mode) {
    case 'upper':
      return text.toUpperCase()
    case 'lower':
      return text.toLowerCase()
    case 'title':
      return text.replace(
        /(^|[^\p{L}\p{N}])(\p{L}[\p{L}\p{M}]*)/gu,
        (_match, prefix: string, word: string) => prefix + word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
      )
    case 'sentence':
      return capitalizeFirst(text)
    case 'toggle':
      return toggleCase(text)
    default:
      return text
  }
}

/**
 * Prefix every line with its line number.
 *
 * Numbers are right aligned so they line up in the gutter, and separated from the
 * line content by a tab. `removeLineNumbers` undoes this transformation.
 */
export function insertLineNumbers(text: string, startAt = 1): string {
  const { eol, lines, trailing } = splitLines(text)
  if (!lines.length) return ''
  const start = Number.isFinite(startAt) ? Math.trunc(startAt) : 1
  const width = String(start + lines.length - 1).length
  const out = lines.map((line, index) => {
    const number = String(start + index).padStart(width, ' ')
    return `${number}\t${line}`
  })
  return assemble(out, eol, trailing)
}

/**
 * Strip a leading line number from every line.
 *
 * Accepts `<number><tab>`, `<number><space>` and the padded variant produced by
 * `insertLineNumbers` (`<spaces><number><tab>`).
 */
export function removeLineNumbers(text: string): string {
  const { eol, lines, trailing } = splitLines(text)
  const out = lines.map((line) => line.replace(/^[ \t]*\d+[ \t]/, ''))
  return assemble(out, eol, trailing)
}

/** Escape a string so it can be embedded in a regular expression. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Build a matcher for a literal needle.
 *
 * Returns `null` for an empty needle so callers can bail out early.
 */
function buildMatcher(needle: string, caseSensitive: boolean, wholeWord: boolean): RegExp | null {
  if (!needle) return null
  const body = escapeRegExp(needle)
  const pattern = wholeWord ? `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])` : body
  return new RegExp(pattern, caseSensitive ? 'gu' : 'giu')
}

/**
 * Count how often a literal string occurs in a text.
 *
 * Matches do not overlap. With `wholeWord` the match must not be surrounded by
 * letters, digits or underscores.
 */
export function countOccurrences(text: string, needle: string, caseSensitive = true, wholeWord = false): number {
  const matcher = buildMatcher(needle, caseSensitive, wholeWord)
  if (!matcher) return 0
  let count = 0
  let match = matcher.exec(text)
  while (match !== null) {
    count += 1
    match = matcher.exec(text)
  }
  return count
}

/** Offsets of the first character of every line. */
function lineStarts(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (char === '\n') {
      starts.push(i + 1)
    } else if (char === '\r') {
      if (text[i + 1] === '\n') i += 1
      starts.push(i + 1)
    }
  }
  return starts
}

/** Index of the line that owns the given offset. */
function lineIndexAt(starts: number[], offset: number): number {
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (starts[mid] <= offset) low = mid
    else high = mid - 1
  }
  return low
}

/**
 * Locate every occurrence of a literal string in a text.
 *
 * Line and column numbers are 1-based, `length` is the length of the matched text.
 */
export function highlightMatches(
  text: string,
  needle: string,
  caseSensitive = true,
): { line: number; col: number; length: number }[] {
  const matcher = buildMatcher(needle, caseSensitive, false)
  if (!matcher) return []
  const starts = lineStarts(text)
  const out: { line: number; col: number; length: number }[] = []
  let match = matcher.exec(text)
  while (match !== null) {
    const index = match.index
    const line = lineIndexAt(starts, index)
    out.push({ line: line + 1, col: index - starts[line] + 1, length: match[0].length })
    match = matcher.exec(text)
  }
  return out
}

/** Sort lines case-insensitively (a stable, locale-independent comparison). */
export function sortLinesCaseInsensitive(text: string, desc = false): string {
  const { eol, lines, trailing } = splitLines(text)
  const sorted = [...lines].sort((a, b) => {
    const left = a.toLowerCase()
    const right = b.toLowerCase()
    return left < right ? -1 : left > right ? 1 : 0
  })
  if (desc) sorted.reverse()
  return assemble(sorted, eol, trailing)
}

/** Reverse the order of the lines. */
export function reverseLines(text: string): string {
  const { eol, lines, trailing } = splitLines(text)
  return assemble([...lines].reverse(), eol, trailing)
}

/**
 * Sort the lines of a text by their length.
 *
 * Lines of equal length keep their original relative order (stable sort). `desc`
 * reverses the result so the longest lines come first.
 */
export function sortLinesByLength(text: string, desc = false): string {
  const { eol, lines, trailing } = splitLines(text)
  const indexed = lines.map((line, index) => ({ line, index }))
  indexed.sort((a, b) => a.line.length - b.line.length || a.index - b.index)
  if (desc) indexed.reverse()
  return assemble(
    indexed.map((entry) => entry.line),
    eol,
    trailing,
  )
}

/** Shuffle the lines (Fisher–Yates, good enough for lists and test data). */
export function shuffleLines(text: string): string {
  const { eol, lines, trailing } = splitLines(text)
  const out = [...lines]
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1))
    ;[out[index], out[swap]] = [out[swap], out[index]]
  }
  return assemble(out, eol, trailing)
}

/** Split a text into words, splitting camelCase and separators as well. */
export function wordsOf(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
}

/** Convert the text into a programming case. */
export function convertCase(text: string, mode: 'camel' | 'pascal' | 'snake' | 'kebab' | 'constant' | 'dot'): string {
  // Per-line conversion keeps the line structure of a selection intact.
  return text
    .split('\n')
    .map((line) => {
      const words = wordsOf(line)
      if (!words.length) return line
      switch (mode) {
        case 'camel':
          return (
            words[0].toLowerCase() +
            words
              .slice(1)
              .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
              .join('')
          )
        case 'pascal':
          return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join('')
        case 'snake':
          return words.map((word) => word.toLowerCase()).join('_')
        case 'kebab':
          return words.map((word) => word.toLowerCase()).join('-')
        case 'constant':
          return words.map((word) => word.toUpperCase()).join('_')
        case 'dot':
          return words.map((word) => word.toLowerCase()).join('.')
        default:
          return line
      }
    })
    .join('\n')
}

/** Base64 encode UTF-8 text (works outside the browser too). */
export function base64Encode(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** Base64 decode into UTF-8 text. Throws on invalid input. */
export function base64Decode(text: string): string {
  const binary = atob(text.trim())
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** MIME base64, used by the data URL helpers. */
export function dataUrlEncode(text: string, mime = 'text/plain'): string {
  return `data:${mime};base64,${base64Encode(text)}`
}

/** Format JSON with two spaces. Throws on invalid JSON. */
export function formatJson(text: string, indent = 2): string {
  return JSON.stringify(JSON.parse(text), null, indent)
}

/** Minify JSON. Throws on invalid JSON. */
export function minifyJson(text: string): string {
  return JSON.stringify(JSON.parse(text))
}

/**
 * A small, forgiving XML / HTML indenter.
 *
 * It is not a full parser: it re-indents the tags of a well-formed document,
 * which is exactly what the "Format XML/HTML" command needs. Elements that
 * cannot contain children (br, img, input, …) are kept on one line.
 */
export function formatXml(text: string): string {
  const VOID = new Set([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr',
    '!doctype',
    '?xml',
  ])
  const source = text.replace(/>\s+</g, '><').trim()
  const tokens = source.match(/<[^>]+>|[^<]+/g) ?? []
  const lines: string[] = []
  let depth = 0
  const indent = (level: number): string => '  '.repeat(Math.max(0, level))
  for (const raw of tokens) {
    const token = raw.trim()
    if (!token) continue
    if (token.startsWith('</')) {
      depth -= 1
      lines.push(indent(depth) + token)
      continue
    }
    if (token.startsWith('<!--') || token.startsWith('<!')) {
      lines.push(indent(depth) + token)
      continue
    }
    if (token.startsWith('<')) {
      const name = token
        .replace(/^<\??\/?/, '')
        .split(/[\s/>]/)[0]
        .toLowerCase()
      const selfClosing = token.endsWith('/>') || VOID.has(name)
      lines.push(indent(depth) + token)
      if (!selfClosing) depth += 1
      continue
    }
    lines.push(indent(depth) + token)
  }
  return lines.join('\n')
}

/** URL encode a whole selection (component-wise, so `/` survives only when it should). */
export function urlEncode(text: string): string {
  return encodeURIComponent(text)
}

/** URL decode a whole selection. Throws on malformed input. */
export function urlDecode(text: string): string {
  return decodeURIComponent(text)
}

/** Escape the characters that would be interpreted as HTML. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Turn HTML entities into their characters. Unknown entities are kept. */
export function unescapeHtml(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&nbsp;/g, '\u00a0')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

/** A v4 UUID, falling back to a Math.random version when crypto is missing. */
export function makeUuid(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch {
    /* fall through */
  }
  const bytes = new Uint8Array(16)
  for (let index = 0; index < 16; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Transpose the characters around the cursor (`Ctrl+T` in Emacs and Notepad++).
 * At the end of a line the last two characters are swapped instead.
 */
export function transposeChars(line: string, column: number): { text: string; column: number } {
  if (line.length < 2) return { text: line, column }
  if (column <= 0) return { text: line, column }
  if (column >= line.length) {
    const chars = [...line]
    ;[chars[chars.length - 2], chars[chars.length - 1]] = [chars[chars.length - 1], chars[chars.length - 2]]
    return { text: chars.join(''), column: chars.length }
  }
  const chars = [...line]
  const left = chars[column - 1]
  chars[column - 1] = chars[column]
  chars[column] = left
  return { text: chars.join(''), column: column + 1 }
}
