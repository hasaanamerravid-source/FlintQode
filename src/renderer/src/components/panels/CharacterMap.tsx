import { createEffect, createMemo, createSignal, For, onSettled, Show } from 'solid-js'
import type { JSX } from '@solidjs/web'

export interface CharacterMapProps {
  /** Called with the character when the user picks one. */
  onInsert?: (char: string) => void
  onClose?: () => void
}

interface CharItem {
  char: string
  code: number
}

interface CharGroupDef {
  id: string
  name: string
  items: CharItem[]
}

/** Build the items of a code point range. */
function fromRange(start: number, end: number): CharItem[] {
  const out: CharItem[] = []
  for (let code = start; code <= end; code += 1) {
    out.push({ char: String.fromCodePoint(code), code })
  }
  return out
}

/** A hand picked set of emoji. */
const EMOJI_CODES = [
  0x1f600, 0x1f601, 0x1f602, 0x1f603, 0x1f604, 0x1f605, 0x1f606, 0x1f607, 0x1f608, 0x1f609, 0x1f60a, 0x1f60b, 0x1f60d,
  0x1f60e, 0x1f612, 0x1f613, 0x1f614, 0x1f615, 0x1f618, 0x1f61a, 0x1f61b, 0x1f61c, 0x1f61d, 0x1f622, 0x1f623, 0x1f625,
  0x1f628, 0x1f62d, 0x1f630, 0x1f631, 0x1f634, 0x1f644, 0x1f64f, 0x1f680, 0x1f6a2, 0x1f4a1, 0x1f4a9, 0x1f4aa, 0x1f4c8,
  0x1f525, 0x2764, 0x1f44d, 0x1f44e, 0x1f44f, 0x1f440, 0x1f3af, 0x1f308, 0x1f31f, 0x1f31e, 0x2600, 0x2601, 0x26a0,
  0x2714, 0x2716, 0x1f984, 0x1f409, 0x1f40d, 0x1f680, 0x1f6a5, 0x1f573,
]

const GROUPS: CharGroupDef[] = [
  { id: 'basic-latin', name: 'Basic Latin', items: fromRange(0x0020, 0x007e) },
  { id: 'latin-1', name: 'Latin-1 Supplement', items: fromRange(0x00a0, 0x00ff) },
  { id: 'punctuation', name: 'Punctuation', items: fromRange(0x2000, 0x206f) },
  { id: 'arrows', name: 'Arrows', items: fromRange(0x2190, 0x21ff) },
  { id: 'math', name: 'Math Operators', items: fromRange(0x2200, 0x22ff) },
  { id: 'box', name: 'Box Drawing', items: fromRange(0x2500, 0x257f) },
  { id: 'greek', name: 'Greek', items: fromRange(0x0370, 0x03ff) },
  { id: 'cyrillic', name: 'Cyrillic', items: fromRange(0x0400, 0x04ff) },
  { id: 'currency', name: 'Currency', items: fromRange(0x20a0, 0x20bf) },
  { id: 'emoji', name: 'Emoji', items: EMOJI_CODES.map((code) => ({ char: String.fromCodePoint(code), code })) },
]

/** Format a code point the way Unicode does. */
function formatCode(code: number): string {
  return `U+${code.toString(16).toUpperCase().padStart(4, '0')}`
}

/**
 * Styles for the parts the application stylesheet does not cover. The grid and the
 * cells use the shared `.charmap-grid` / `.charmap-cell` classes.
 */
const STYLES = `
.cm-root { display: flex; flex-direction: column; min-width: 0; height: 100%; }
.cm-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border, #313244);
}
.cm-search { flex: 1 1 auto; min-width: 140px; }
.cm-count { color: var(--fg-muted, #8b8b9b); white-space: nowrap; }
.cm-btn {
  padding: 3px 10px;
  border: 1px solid var(--border, #313244);
  border-radius: var(--radius, 4px);
  color: var(--fg-dim, #a6adc8);
  white-space: nowrap;
}
.cm-btn:hover { background: var(--bg-hover, rgba(137, 180, 250, 0.12)); color: var(--fg, #cdd6f4); }
.cm-body { flex: 1 1 auto; overflow: auto; padding: 4px 8px 16px; outline: none; }
.cm-group { margin-bottom: 6px; }
.cm-group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  text-align: left;
  font-weight: 600;
  color: inherit;
  border-bottom: 1px solid var(--border, #2e2e3e);
  padding: 4px 2px;
}
.cm-marker { width: 1em; color: var(--fg-muted, #8b8b9b); }
.cm-grid { padding: 4px 0; }
.cm-cell { position: relative; user-select: none; }
.cm-cell.cm-selected { border-color: var(--accent, #89b4fa); box-shadow: inset 0 0 0 1px var(--accent, #89b4fa); }
.cm-copy {
  position: absolute;
  top: 1px;
  right: 1px;
  padding: 0 2px;
  font-size: 9px;
  line-height: 1;
  color: var(--fg-muted, #8b8b9b);
  border-radius: 2px;
  opacity: 0;
}
.cm-cell:hover .cm-copy { opacity: 1; }
.cm-copy:hover { color: var(--accent, #89b4fa); }
.cm-empty { padding: 12px; color: var(--fg-muted, #8b8b9b); }
`

export function CharacterMap(props: CharacterMapProps): JSX.Element {
  const [query, setQuery] = createSignal('')
  const [collapsed, setCollapsed] = createSignal<Set<string>>(new Set())
  const [selected, setSelected] = createSignal(0)
  const [columns, setColumns] = createSignal(12)
  const [copied, setCopied] = createSignal<string | null>(null)
  let bodyRef: HTMLDivElement | undefined
  let searchRef: HTMLInputElement | undefined
  let copyTimer: ReturnType<typeof setTimeout> | null = null

  const needle = createMemo(() => query().trim().toLowerCase())

  const groups = createMemo(() => {
    if (!needle()) return GROUPS
    return GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        const code = formatCode(item.code)
        return (
          item.char.toLowerCase().includes(needle()) ||
          code.toLowerCase().includes(needle()) ||
          code.slice(2).toLowerCase().includes(needle())
        )
      }),
    })).filter((group) => group.items.length > 0)
  })

  const isOpen = (id: string): boolean => (needle() ? true : !collapsed().has(id))

  /** All characters of the visible groups, in the order they are painted. */
  const visible = createMemo(() => {
    const out: CharItem[] = []
    for (const group of groups()) {
      if (!isOpen(group.id)) continue
      for (const item of group.items) out.push(item)
    }
    return out
  })

  /** Position of every character inside the visible list. */
  const indexOf = createMemo(() => {
    const map = new Map<CharItem, number>()
    visible().forEach((item, index) => map.set(item, index))
    return map
  })

  const toggleGroup = (id: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const insert = (char: string): void => {
    props.onInsert?.(char)
  }

  const copy = async (char: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(char)
      setCopied(char)
      if (copyTimer) clearTimeout(copyTimer)
      copyTimer = setTimeout(() => setCopied(null), 900)
    } catch (err) {
      console.error('[flintqode] could not copy the character:', err)
    }
  }

  // Measure how many characters fit in one row so the arrow keys can navigate.
  createEffect(
    () => ({ count: visible().length, needle: needle() }),
    () => {
      const body = bodyRef
      if (!body) return
      const measure = (): void => {
        const grid = body.querySelector<HTMLElement>('.charmap-grid')
        if (!grid) {
          setColumns(1)
          return
        }
        const cells = Array.from(grid.querySelectorAll<HTMLElement>('.charmap-cell'))
        if (!cells.length) {
          setColumns(1)
          return
        }
        const top = cells[0].offsetTop
        let count = 0
        for (const cell of cells) {
          if (cell.offsetTop !== top) break
          count += 1
        }
        setColumns(Math.max(1, count))
      }
      measure()
      if (typeof ResizeObserver === 'undefined') return
      const observer = new ResizeObserver(() => requestAnimationFrame(measure))
      observer.observe(body)
      return () => observer.disconnect()
    },
  )

  // Keep the selection inside the visible range.
  createEffect(
    () => ({ selected: selected(), count: visible().length }),
    ({ selected: current, count }) => {
      if (current >= count) setSelected(Math.max(0, count - 1))
    },
  )

  // Scroll the selected character into view.
  createEffect(
    () => selected(),
    (index) => {
      const body = bodyRef
      if (!body) return
      const cell = body.querySelector<HTMLElement>(`[data-index="${index}"]`)
      cell?.scrollIntoView({ block: 'nearest' })
    },
  )

  onSettled(() => () => {
    if (copyTimer) clearTimeout(copyTimer)
  })

  const move = (delta: number): void => {
    const count = visible().length
    if (!count) return
    setSelected((prev) => {
      const next = prev + delta
      if (next < 0) return 0
      if (next >= count) return count - 1
      return next
    })
  }

  const handleKeyDown = (event: KeyboardEvent): void => {
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault()
        move(1)
        break
      case 'ArrowLeft':
        event.preventDefault()
        move(-1)
        break
      case 'ArrowDown':
        event.preventDefault()
        move(columns())
        break
      case 'ArrowUp':
        event.preventDefault()
        move(-columns())
        break
      case 'Home':
        event.preventDefault()
        setSelected(0)
        break
      case 'End':
        event.preventDefault()
        setSelected(Math.max(0, visible().length - 1))
        break
      case 'Enter': {
        event.preventDefault()
        const item = visible()[selected()]
        if (item) insert(item.char)
        break
      }
      case 'Escape':
        event.preventDefault()
        if (query()) setQuery('')
        else searchRef?.blur()
        break
      default:
        break
    }
  }

  return (
    <div class="cm-root">
      <style>{STYLES}</style>
      <div class="cm-header">
        <input
          ref={(el) => (searchRef = el)}
          class="cm-search"
          type="text"
          value={query()}
          placeholder="Search characters or code points (e.g. arrow, U+2190)"
          onInput={(event) => {
            setQuery(event.currentTarget.value)
            setSelected(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setQuery('')
              return
            }
            // Up and down navigate the grid while the search box keeps the focus.
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              move(columns())
              return
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              move(-columns())
              return
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              const item = visible()[selected()]
              if (item) insert(item.char)
            }
          }}
        />
        <span class="cm-count">
          {visible().length} character{visible().length === 1 ? '' : 's'}
        </span>
        <Show when={copied()}>{(value) => <span class="cm-count">Copied {value()}</span>}</Show>
        <Show when={props.onClose}>
          <button type="button" class="cm-btn" onClick={() => props.onClose?.()} title="Close">
            ✕
          </button>
        </Show>
      </div>

      <div class="cm-body" ref={(el) => (bodyRef = el)} tabindex={0} onKeyDown={handleKeyDown}>
        <Show when={groups().length === 0}>
          <div class="cm-empty">No character matches “{query()}”.</div>
        </Show>

        <For each={groups()}>
          {(group) => {
            const open = isOpen(group.id)
            return (
              <section class="cm-group">
                <button
                  type="button"
                  class="cm-group-head"
                  onClick={() => toggleGroup(group.id)}
                  aria-expanded={open ? 'true' : 'false'}
                >
                  <span class="cm-marker">{open ? '▾' : '▸'}</span>
                  <span>{group.name}</span>
                  <span class="cm-count">({group.items.length})</span>
                </button>
                <Show when={open}>
                  <div class="charmap-grid cm-grid">
                    <For each={group.items}>
                      {(item) => {
                        const flatIndex = indexOf().get(item) ?? -1
                        return (
                          <div
                            class={['charmap-cell', 'cm-cell', { 'cm-selected': flatIndex === selected() }]}
                            data-index={flatIndex}
                            role="button"
                            tabindex={-1}
                            title={`${item.char}  ${formatCode(item.code)}`}
                            onClick={() => insert(item.char)}
                          >
                            <span class="glyph">{item.char}</span>
                            <span class="code">{formatCode(item.code)}</span>
                            <button
                              type="button"
                              class="cm-copy"
                              title="Copy to clipboard"
                              onClick={(event) => {
                                event.stopPropagation()
                                void copy(item.char)
                              }}
                            >
                              ⧉
                            </button>
                          </div>
                        )
                      }}
                    </For>
                  </div>
                </Show>
              </section>
            )
          }}
        </For>
      </div>
    </div>
  )
}
