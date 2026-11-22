import { useId } from 'react'
import type { JSX } from 'react'
import { useAppStore } from '../store/app'

export interface AppLogoProps {
  size?: number
  className?: string
  /** Draw the mark in a single colour instead of the gradient. */
  monochrome?: boolean
}

/**
 * The FlintQode mark: three round strokes that form a soft "N".
 * Drawn with strokes (not polygons) so it stays smooth at every size.
 */
export function AppLogo({ size = 18, className, monochrome = false }: AppLogoProps): JSX.Element {
  const gradientId = useId()
  const appTheme = useAppStore((s) => s.settings.theme)
  const prefersDark = typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  const dark = appTheme === 'system' ? prefersDark : appTheme === 'dark'

  // Adapt colours to the current theme for better visibility
  const from = monochrome ? 'currentColor' : (dark ? '#5B9BFF' : '#2563eb')
  const to = monochrome ? 'currentColor' : (dark ? '#8A63F2' : '#7c3aed')

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="presentation"
      aria-hidden="true"
      style={{ display: 'inline-block', verticalAlign: '-3px', flex: '0 0 auto' }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
      </defs>
      <g stroke={`url(#${gradientId})`} strokeWidth="3.1" strokeLinecap="round" fill="none">
        <path d="M6.6 5.2V18.8" />
        <path d="M6.6 6.4 17.4 18.4" />
        <path d="M17.4 5.2V18.8" />
      </g>
    </svg>
  )
}