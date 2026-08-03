import { cloneElement, isValidElement, type ReactElement } from 'react'

type IconProps = {
  children: ReactElement
  size?: number
  className?: string
}

/**
 * Decorative-only wrapper around an inline SVG. The accessible name for
 * whatever control hosts the icon comes from that control's own
 * aria-label — the icon itself is always aria-hidden (DESIGN_SYSTEM.md §12).
 */
export function Icon({ children, size = 20, className = '' }: IconProps) {
  const svg = isValidElement<{ width?: number; height?: number }>(children)
    ? cloneElement(children, { width: size, height: size })
    : children

  return (
    <span aria-hidden="true" className={`inline-flex shrink-0 ${className}`}>
      {svg}
    </span>
  )
}
