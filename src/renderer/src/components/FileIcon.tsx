import type { JSX } from 'react'
import { useAppStore } from '../store/app'
import { ICON_SHAPES, iconKindFor, type IconKind } from '../core/iconShapes'
import { iconTheme } from '../core/iconThemes'

/** Relative luminance of an RGB triple (WCAG definition). */
function rgbLuminance(r: number, g: number, b: number): number {
  const channel = (value: number): number => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** Contrast ratio between two relative luminances. */
function contrastRatio(first: number, second: number): number {
  const light = Math.max(first, second)
  const dark = Math.min(first, second)
  return (light + 0.05) / (dark + 0.05)
}

/** Expand `#rgb` / `#rrggbb` (ignoring alpha) into its channels. */
function parseHex(hex: string): [number, number, number] {
  const value = hex.replace('#', '').trim()
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value
  return [
    Number.parseInt(full.slice(0, 2), 16) || 0,
    Number.parseInt(full.slice(2, 4), 16) || 0,
    Number.parseInt(full.slice(4, 6), 16) || 0,
  ]
}

/**
 * Keep an icon colour readable on the current background.
 *
 * Icon themes ship colours picked for one background; in the other theme
 * light greys on white (or near-black greens on black) disappear. Blend the
 * colour toward the background's opposite until the WCAG AA contrast ratio is
 * met, which preserves the hue and only changes its brightness.
 */
function adaptColor(hex: string, dark: boolean): string {
  if (!/^#[0-9a-f]{3,8}$/i.test(hex)) return hex
  let [r, g, b] = parseHex(hex)
  const background = dark ? rgbLuminance(15, 17, 21) : rgbLuminance(251, 252, 254)
  const target = dark ? 255 : 0
  let luminance = rgbLuminance(r, g, b)
  for (let step = 0; step < 24 && contrastRatio(luminance, background) < 4.5; step += 1) {
    r = Math.round(r + (target - r) * 0.12)
    g = Math.round(g + (target - g) * 0.12)
    b = Math.round(b + (target - b) * 0.12)
    luminance = rgbLuminance(r, g, b)
  }
  const toHex = (n: number): string => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

export interface FileIconProps {
  /** File or folder name. */
  name: string
  isDirectory?: boolean
  /** Icon theme id (see core/iconThemes.ts). */
  theme?: string
  size?: number
  className?: string
}

/** Renders the file type icon of the active icon theme. */
export function FileIcon({
  name,
  isDirectory = false,
  theme = 'seti',
  size = 15,
  className,
}: FileIconProps): JSX.Element | null {
  const appTheme = useAppStore((s) => s.settings.theme)
  const prefersDark = typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  const dark = appTheme === 'system' ? prefersDark : appTheme === 'dark'

  const pack = iconTheme(theme)
  const kind: IconKind = iconKindFor(name, isDirectory)
  const path = pack.shapes?.[kind] ?? ICON_SHAPES[kind]
  if (!path) return null
  if (theme === 'none') return null
  const rawColor = pack.monochrome ? 'currentColor' : (pack.colors[kind] ?? 'currentColor')
  const color = rawColor === 'currentColor' ? rawColor : adaptColor(rawColor, dark)
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={{ color, flex: '0 0 auto', display: 'inline-block', verticalAlign: '-2px' }}
      aria-hidden="true"
    >
      <path d={path} fill="currentColor" />
    </svg>
  )
}
