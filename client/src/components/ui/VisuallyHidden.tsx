import type { ComponentPropsWithoutRef, ElementType } from 'react'

type VisuallyHiddenProps<T extends ElementType> = {
  as?: T
} & ComponentPropsWithoutRef<T>

/**
 * The `.sr` pattern (UI_IMPLEMENTATION_PLAN.md §2): content present for
 * assistive technology and, when `focusable`, revealed on keyboard focus —
 * used for the skip link, which must be invisible at rest but land in the
 * normal tab sequence and become visible the moment it receives focus.
 */
export function VisuallyHidden<T extends ElementType = 'span'>({
  as,
  className = '',
  focusable = false,
  ...rest
}: VisuallyHiddenProps<T> & { focusable?: boolean }) {
  const Tag = as ?? 'span'
  const base = focusable ? 'sr-only sr-only-focusable' : 'sr-only'

  return <Tag className={`${base} ${className}`} {...rest} />
}
