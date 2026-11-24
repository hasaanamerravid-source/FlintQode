import { createEffect, createMemo, createSignal, For, Show, untrack, type Accessor } from 'solid-js'
import type { JSX } from '@solidjs/web'
import type { Profile } from '@shared/types'
import { itemsForProfile, sectionsForProfile } from '../core/menuStructure'
import type { MenuItem, MenuSection } from '../core/menuStructure'
import { commandKey, sectionKey, useTWith } from '../core/i18n'

export interface MainMenuProps {
  open: boolean
  onClose: () => void
  profile: Profile
  /** Execute a command by id. */
  onCommand: (id: string, payload?: unknown) => void
  /** Where the panel is anchored (the hamburger button). */
  anchor?: 'left' | 'right'
  className?: string
}

/** Styles for the menu. Plain CSS, scoped to `.main-menu`. */
const MENU_CSS = `
.main-menu {
  position: fixed;
  inset: 0;
  z-index: 1200;
}
.main-menu-panel {
  position: absolute;
  top: 6px;
  min-width: 200px;
  max-width: 340px;
  padding: 5px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  border-radius: 10px;
  border: 1px solid var(--border-strong, #45475a);
  background: var(--bg-elevated, #181825);
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.45);
  color: var(--fg, #cdd6f4);
  font-family: var(--font-ui);
  font-size: 13px;
  outline: none;
  user-select: none;
}
.main-menu-left .main-menu-panel { left: 8px; }
.main-menu-right .main-menu-panel { right: 8px; }
.main-menu-section {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.main-menu-section:hover,
.main-menu-highlight {
  background: var(--bg-active, #34344a);
  color: var(--fg, #cdd6f4);
}
.main-menu-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 5px 10px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--fg-dim, #a6adc8);
  white-space: nowrap;
}
.main-menu-item:hover {
  background: var(--bg-hover, #2b2b3d);
}
.main-menu-item.main-menu-highlight {
  background: var(--bg-active, #34344a);
  color: var(--fg, #cdd6f4);
}
.main-menu-item-disabled {
  opacity: 0.45;
  cursor: default;
}
.main-menu-item-label {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
}
.main-menu-item-shortcut {
  flex: 0 0 auto;
  margin-left: 18px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg-muted, #6b7089);
}
.main-menu-separator {
  height: 1px;
  margin: 4px 8px;
  background: var(--border, #313244);
}
.main-menu-submenu {
  position: absolute;
  left: 100%;
  top: 0;
  min-width: 230px;
  max-height: calc(100vh - 24px);
  overflow-y: auto;
  padding: 5px;
  border-radius: 10px;
  border: 1px solid var(--border-strong, #45475a);
  background: var(--bg-elevated, #181825);
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.45);
  color: var(--fg, #cdd6f4);
  z-index: 1;
}
`

/** True when the entry can be highlighted and executed. */
function isSelectable(item: MenuItem | undefined): item is MenuItem {
  return !!item && !item.separator && !item.disabled
}

/** Index of the first entry that can be highlighted. */
function firstEnabledIndex(items: MenuItem[]): number {
  const index = items.findIndex((item) => isSelectable(item))
  return index >= 0 ? index : 0
}

/** Next entry that can be highlighted, skipping separators and disabled rows. */
function stepIndex(items: MenuItem[], from: number, dir: 1 | -1): number {
  if (!items.length) return 0
  let index = from
  for (let step = 0; step < items.length; step++) {
    index = (index + dir + items.length) % items.length
    if (isSelectable(items[index])) return index
  }
  return from
}

export function MainMenu(props: MainMenuProps): JSX.Element {
  const sections = createMemo(() => sectionsForProfile(props.profile))
  const t = useTWith()
  const [activeSection, setActiveSection] = createSignal(0)
  const [openSection, setOpenSection] = createSignal<number | null>(null)
  const [itemIndex, setItemIndex] = createSignal(0)
  const [nestedId, setNestedId] = createSignal<string | null>(null)

  let panelRef: HTMLDivElement | undefined
  let subRef: HTMLDivElement | undefined
  let nestedRef: HTMLDivElement | undefined
  const sectionRefs: (HTMLButtonElement | null)[] = []
  const itemRefs: (HTMLDivElement | null)[] = []
  const nestedItemRefs: (HTMLDivElement | null)[] = []

  const openSectionData = createMemo<MenuSection | undefined>(() =>
    openSection() === null ? undefined : sections()[openSection()!],
  )
  const openItems = createMemo<MenuItem[]>(() =>
    openSectionData() ? itemsForProfile(openSectionData()!, props.profile) : [],
  )
  const nestedItems = createMemo<MenuItem[]>(() => {
    const parent = openItems().find((item) => item.id === nestedId())
    return parent?.items ?? []
  })

  /* --------------------------- open / reset --------------------------- */

  createEffect(
    () => props.open,
    (open) => {
      if (!open) return
      setActiveSection(0)
      setOpenSection(null)
      setItemIndex(0)
      setNestedId(null)
      const frame = window.requestAnimationFrame(() => panelRef?.focus())
      return () => window.cancelAnimationFrame(frame)
    },
  )

  createEffect(
    () => ({ section: openSection(), count: sections().length }),
    ({ section, count }) => {
      if (section !== null && section >= count) setOpenSection(null)
    },
  )

  /* ----------------------------- measuring ---------------------------- */

  const measure = (section: number | null, nested: string | null, items: MenuItem[]): void => {
    const panel = panelRef
    if (!panel) return
    const base = panel.getBoundingClientRect()
    // Positions are measured layout, not application state: writing them
    // straight to the flyouts avoids relaying the menu signals into another
    // signal and rendering one frame with a stale position.
    if (section !== null) {
      const button = sectionRefs[section]
      if (button && subRef) {
        let top = Math.round(button.getBoundingClientRect().top - base.top)
        // Keep the fly out inside the window.
        const room = window.innerHeight - subRef.offsetHeight - 12 - base.top
        top = Math.max(0, Math.min(top, room))
        subRef.style.top = `${top}px`
      }
    }
    if (nested && nestedRef) {
      const index = items.findIndex((item) => item.id === nested)
      const row = index >= 0 ? itemRefs[index] : null
      if (row) {
        nestedRef.style.top = `${Math.round(row.getBoundingClientRect().top - base.top)}px`
        nestedRef.style.left = `${Math.round(base.width)}px`
      }
    }
  }

  createEffect(
    () => ({ open: props.open, section: openSection(), nested: nestedId(), items: openItems() }),
    ({ section, nested, items }) => measure(section, nested, items),
  )

  createEffect(
    () => props.open,
    (open) => {
      if (!open) return
      // A resize is a snapshot: the tracked effect above already re-measures
      // when the menu state changes, so read the signals untracked here.
      const onResize = (): void => measure(untrack(openSection), untrack(nestedId), untrack(openItems))
      window.addEventListener('resize', onResize)
      return () => window.removeEventListener('resize', onResize)
    },
  )

  /* ------------------------------ actions ----------------------------- */

  const runItem = (item: MenuItem | undefined): void => {
    if (!isSelectable(item)) return
    if (item.items && item.items.length > 0) {
      setNestedId(item.id)
      return
    }
    props.onCommand(item.id)
    props.onClose()
  }

  const openSubmenu = (index: number): void => {
    const section = sections()[index]
    if (!section) return
    const items = itemsForProfile(section, props.profile)
    setActiveSection(index)
    setOpenSection(index)
    setNestedId(null)
    setItemIndex(firstEnabledIndex(items))
  }

  /* ------------------------------ keyboard ---------------------------- */

  const handleKeyDown = (event: KeyboardEvent): void => {
    const key = event.key
    if (key === 'Escape' || key === 'Tab') {
      event.preventDefault()
      event.stopPropagation()
      props.onClose()
      return
    }
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      event.preventDefault()
      const dir = key === 'ArrowDown' ? 1 : -1
      if (openSection() === null) {
        openSubmenu(sections().length ? (dir === 1 ? 0 : sections().length - 1) : 0)
        return
      }
      setItemIndex((current) => stepIndex(openItems(), current, dir))
      setNestedId(null)
      return
    }
    if (key === 'ArrowRight') {
      if (openSection() === null) {
        event.preventDefault()
        openSubmenu(activeSection())
      }
      return
    }
    if (key === 'ArrowLeft') {
      if (openSection() !== null) {
        event.preventDefault()
        setOpenSection(null)
        setNestedId(null)
      }
      return
    }
    if (key === 'Enter') {
      event.preventDefault()
      if (openSection() === null) {
        openSubmenu(activeSection())
        return
      }
      runItem(openItems()[itemIndex()])
    }
  }

  /* ------------------------------ rendering --------------------------- */

  const MenuRow = (props: { item: MenuItem; index: Accessor<number>; nested: boolean }): JSX.Element => {
    const hasChildren = !!props.item.items && props.item.items.length > 0
    // The list is static while the menu is open, so a row keeps its index for
    // the DOM refs and hover handlers. The class binding reads the accessor
    // reactively so the keyboard highlight still follows itemIndex().
    const rowIndex = untrack(() => props.index())
    const setRef = (el: HTMLDivElement): void => {
      if (props.nested) nestedItemRefs[rowIndex] = el
      else itemRefs[rowIndex] = el
    }
    return (
      <Show when={!props.item.separator} fallback={<div class="main-menu-separator" role="separator" />}>
        <div
          ref={setRef}
          role="menuitem"
          aria-disabled={props.item.disabled ? 'true' : undefined}
          class={[
            'main-menu-item',
            {
              'main-menu-highlight': props.index() === itemIndex(),
              'main-menu-item-disabled': props.item.disabled,
            },
          ]}
          onMouseEnter={() => {
            setItemIndex(rowIndex)
            setNestedId(hasChildren ? props.item.id : null)
          }}
          onClick={() => runItem(props.item)}
        >
          <span class="main-menu-item-label">{t(commandKey(props.item.id), props.item.label)}</span>
          <Show when={props.item.shortcut}>
            <span class="main-menu-item-shortcut kbd">{props.item.shortcut}</span>
          </Show>
          <Show when={hasChildren}>
            <span class="main-menu-item-shortcut">›</span>
          </Show>
        </div>
      </Show>
    )
  }

  return (
    <Show when={props.open}>
      <div
        class={['main-menu', `main-menu-${props.anchor}`, props.className]}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) props.onClose()
        }}
      >
        <style {...({ href: 'flintqode-main-menu', precedence: 'flintqode-main-menu' } as Record<string, string>)}>
          {MENU_CSS}
        </style>
        <div
          ref={(el) => {
            panelRef = el
          }}
          class="main-menu-panel"
          role="menubar"
          aria-label="Main menu"
          tabindex={-1}
          onKeyDown={handleKeyDown}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <For each={sections()}>
            {(section, index) => (
              <button
                ref={(el) => {
                  sectionRefs[untrack(() => index())] = el
                }}
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={openSection() === index() ? 'true' : 'false'}
                tabindex={-1}
                class={[
                  'main-menu-section',
                  {
                    'main-menu-highlight':
                      openSection() === index() || (activeSection() === index() && openSection() === null),
                  },
                ]}
                onClick={() => openSubmenu(index())}
                onMouseEnter={() => openSubmenu(index())}
              >
                <span class="main-menu-item-label">{t(sectionKey(section.id), section.label)}</span>
                <span class="main-menu-item-shortcut">›</span>
              </button>
            )}
          </For>

          <Show when={openSectionData()}>
            {(data) => (
              <div
                ref={(el) => {
                  subRef = el
                }}
                class="main-menu-submenu"
                role="menu"
                aria-label={data().label}
              >
                <For each={openItems()}>{(item, index) => <MenuRow item={item} index={index} nested={false} />}</For>
              </div>
            )}
          </Show>

          <Show when={nestedId()}>
            {(id) => (
              <Show when={nestedItems().length > 0}>
                <div
                  ref={(el) => {
                    nestedRef = el
                  }}
                  class="main-menu-submenu"
                  role="menu"
                  aria-label={id()}
                >
                  <For each={nestedItems()}>{(item, index) => <MenuRow item={item} index={index} nested={true} />}</For>
                </div>
              </Show>
            )}
          </Show>
        </div>
      </div>
    </Show>
  )
}
