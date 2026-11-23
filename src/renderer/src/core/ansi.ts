/**
 * Lightweight ANSI/VT100 helpers for the integrated terminal.
 *
 * The terminal is a line-oriented viewer rather than a full emulator, but the
 * shells (and tools such as Gradle) emit colour, cursor and DEC private mode
 * sequences. Without parsing them the raw codes (`\x1b[31m`, `\x1b[?2004h`,
 * `\x1b[200~`, ...) leak into the log as garbled text and missing-glyph
 * boxes. This module turns a chunk of terminal output into styled segments
 * and drops the control sequences that have no visual meaning.
 */

export interface AnsiSegment {
  text: string
  color?: string
  background?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
}

const ANSI_PALETTE = [
  '#000000',
  '#cc0000',
  '#4e9a06',
  '#c4a000',
  '#3465a4',
  '#75507b',
  '#06989a',
  '#d3d7cf',
  '#555753',
  '#ef2929',
  '#8ae234',
  '#fce94f',
  '#729fcf',
  '#ad7fa8',
  '#34e2e2',
  '#eeeeec',
]

function ansi256(code: number): string {
  if (code < 16) return ANSI_PALETTE[code]
  if (code < 232) {
    const index = code - 16
    const r = Math.floor(index / 36)
    const g = Math.floor((index % 36) / 6)
    const b = index % 6
    const channel = (value: number): number => (value === 0 ? 0 : 55 + value * 40)
    return `rgb(${channel(r)}, ${channel(g)}, ${channel(b)})`
  }
  const grey = 8 + (code - 232) * 10
  return `rgb(${grey}, ${grey}, ${grey})`
}

function rgb(r: number, g: number, b: number): string {
  return `rgb(${Math.max(0, Math.min(255, r))}, ${Math.max(0, Math.min(255, g))}, ${Math.max(0, Math.min(255, b))})`
}

/**
 * Parse a string that may contain ANSI escape sequences into styled segments.
 * Control sequences with no visual meaning (cursor movement, erase, DEC private
 * modes such as bracketed paste `2004`, OSC titles) are discarded.
 */
export function parseAnsi(input: string): AnsiSegment[] {
  const segments: AnsiSegment[] = []
  const current: AnsiSegment = { text: '' }
  const push = (): void => {
    if (current.text.length > 0) {
      segments.push({ ...current })
      current.text = ''
    }
  }

  let i = 0
  const length = input.length
  while (i < length) {
    const ch = input.charCodeAt(i)
    // ESC
    if (ch === 0x1b) {
      // CSI: ESC [ ... final byte
      if (input[i + 1] === '[') {
        let j = i + 2
        while (j < length && /[0-9;?]/.test(input[j])) j += 1
        const finalByte = input[j]
        const params = input.slice(i + 2, j)
        if (finalByte === 'm') {
          push()
          const codes = params === '' ? [0] : params.split(';').map((value) => Number(value) || 0)
          let k = 0
          while (k < codes.length) {
            const code = codes[k]
            if (code === 0) {
              current.color = undefined
              current.background = undefined
              current.bold = false
              current.italic = false
              current.underline = false
            } else if (code === 1) {
              current.bold = true
            } else if (code === 3) {
              current.italic = true
            } else if (code === 4) {
              current.underline = true
            } else if (code === 22) {
              current.bold = false
            } else if (code === 23) {
              current.italic = false
            } else if (code === 24) {
              current.underline = false
            } else if (code >= 30 && code <= 37) {
              current.color = ANSI_PALETTE[code - 30]
            } else if (code >= 90 && code <= 97) {
              current.color = ANSI_PALETTE[code - 90 + 8]
            } else if (code >= 40 && code <= 47) {
              current.background = ANSI_PALETTE[code - 40]
            } else if (code >= 100 && code <= 107) {
              current.background = ANSI_PALETTE[code - 100 + 8]
            } else if (code === 39) {
              current.color = undefined
            } else if (code === 49) {
              current.background = undefined
            } else if (code === 38) {
              if (codes[k + 1] === 5) {
                current.color = ansi256(codes[k + 2] ?? 0)
                k += 2
              } else if (codes[k + 1] === 2) {
                current.color = rgb(codes[k + 2] ?? 0, codes[k + 3] ?? 0, codes[k + 4] ?? 0)
                k += 4
              }
            } else if (code === 48) {
              if (codes[k + 1] === 5) {
                current.background = ansi256(codes[k + 2] ?? 0)
                k += 2
              } else if (codes[k + 1] === 2) {
                current.background = rgb(codes[k + 2] ?? 0, codes[k + 3] ?? 0, codes[k + 4] ?? 0)
                k += 4
              }
            }
            k += 1
          }
        }
        // Any other CSI (cursor, erase, DEC private modes, bracketed paste)
        // is discarded.
        i = j + 1
        continue
      }
      // OSC: ESC ] ... BEL or ST
      if (input[i + 1] === ']') {
        let j = i + 2
        while (j < length && input.charCodeAt(j) !== 0x07 && !(input[j] === '\x1b' && input[j + 1] === '\\')) {
          j += 1
        }
        if (input.charCodeAt(j) === 0x07) j += 1
        else if (input[j] === '\x1b') j += 2
        i = j
        continue
      }
      // Other two-byte escapes.
      i += 2
      continue
    }
    // Carriage return is handled by the caller (line splitting); drop stray
    // control characters that have no printable representation.
    if (ch === 0x07 || ch === 0x08 || ch === 0x0b || ch === 0x0c) {
      i += 1
      continue
    }
    current.text += input[i]
    i += 1
  }
  push()
  return segments
}
