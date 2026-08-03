import type { ComponentPropsWithoutRef } from 'react'

type BadgeVariant = 'commerce' | 'error' | 'lowstock' | 'oos'
type BadgeShape = 'label' | 'count'

/**
 * DESIGN_SYSTEM.md §1: "error is never filled, commerce is always filled" —
 * commerce is the only white-on-fill token. Error/low-stock/out-of-stock
 * are text (+ neutral surface) treatments, never a filled state colour.
 */
const VARIANT_CLASS: Record<BadgeVariant, string> = {
  commerce: 'bg-state-commerce text-white',
  error: 'bg-well text-state-error border border-state-error',
  lowstock: 'bg-surface-sunken text-state-lowstock',
  oos: 'bg-surface-sunken text-state-oos',
}

/**
 * DESIGN_SYSTEM §3: the full circle (--r-full) is reserved for status dots
 * and count badges, never for arbitrary text labels. "label" (sale,
 * low-stock, out-of-stock...) uses the shared compact radius instead —
 * a full pill around variable-length Hebrew text looks unrelated to the
 * rest of the shape system. "count" (cart/favourites counters) keeps the
 * circle since it is, structurally, a count badge.
 */
const SHAPE_CLASS: Record<BadgeShape, string> = {
  label: 'rounded-compact px-2 py-0.5 text-xs leading-snug whitespace-nowrap',
  count: 'min-w-5 h-5 justify-center px-1 rounded-round text-[11px] leading-none',
}

type BadgeProps = {
  variant: BadgeVariant
  shape?: BadgeShape
} & ComponentPropsWithoutRef<'span'>

/** Commerce/state signal only — never used to carry category tone (DESIGN_SYSTEM.md §1). */
export function Badge({ variant, shape = 'label', children, className = '', ...rest }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center font-medium ${SHAPE_CLASS[shape]} ${VARIANT_CLASS[variant]} ${className}`}
      {...rest}
    >
      {children}
    </span>
  )
}
