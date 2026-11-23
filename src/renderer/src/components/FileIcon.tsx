import type { JSX } from 'react'
import { useAppStore } from '../store/app'
import { ICON_SHAPES, iconKindFor, type IconKind } from '../core/iconShapes'
import { iconTheme } from '../core/iconThemes'

/** Compute the luminance of a hex colour (0 = black, 1 = white). */
function luminance(hex: string): number {
  const value = hex.replace('#', '').trim()
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value
  const num = Number.parseInt(full.slice(0, 6) || '000000', 16)
  if (Number.isNaN(num)) return 0.5
  const r = ((num >> 16) & 255) / 255
  const g = ((num >> 8) & 255) / 255
  const b = (num & 255) / 255
  const channel = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** Darken or lighten a hex colour so it stays readable on the current theme. */
function adaptColor(hex: string, dark: boolean): string {
  if (!/^#[0-9a-f]{3,8}$/i.test(hex)) return hex
  const value = hex.replace('#', '').trim()
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value
  let r = Number.parseInt(full.slice(0, 2), 16) || 0
  let g = Number.parseInt(full.slice(2, 4), 16) || 0
  let b = Number.parseInt(full.slice(4, 6), 16) || 0

  // In light mode, make very light colours darker.
  // In dark mode, make very dark colours lighter.
  if (dark) {
    const lum = luminance(hex)
    if (lum < 0.15) {
      const factor = 0.4
      r = Math.round(r + (255 - r) * factor)
      g = Math.round(g + (255 - g) * factor)
      b = Math.round(b + (255 - b) * factor)
    }
  } else {
    const lum = luminance(hex)
    if (lum > 0.85) {
      const factor = 0.35
      r = Math.round(r * (1 - factor))
      g = Math.round(g * (1 - factor))
      b = Math.round(b * (1 - factor))
    }
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
