import type { ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router'
import { FOCUS_RING } from './focusRing'
import { VARIANT_CLASS } from './Button'

type LinkButtonProps = {
  to: LinkProps['to']
  children: ReactNode
  /** Only the variants a NAVIGATION can honestly wear. */
  variant?: 'primary' | 'secondary'
  /** 'hero' is the home/about CTA scale; 'base' matches Button. */
  size?: 'base' | 'hero'
  className?: string
}

/**
 * A react-router Link wearing Button's clothes — navigation is a link,
 * never a button pretending (the HomePage rule), but a primary CTA must
 * still LOOK like every other primary action. Draws from Button's own
 * VARIANT_CLASS so a token change reaches both. Extracted when the
 * ISSUE-119/125 review found the hero-CTA class string hand-copied across
 * two pages, already drifted from Button's values.
 */
export function LinkButton({
  to,
  children,
  variant = 'primary',
  size = 'base',
  className = '',
}: LinkButtonProps) {
  return (
    <Link
      to={to}
      className={`${FOCUS_RING} inline-flex items-center justify-center rounded-card font-medium transition-colors duration-150 ease-standard ${
        size === 'hero' ? 'h-12 px-6 text-base' : 'h-11 px-4 text-sm'
      } ${VARIANT_CLASS[variant]} ${className}`}
    >
      {children}
    </Link>
  )
}
