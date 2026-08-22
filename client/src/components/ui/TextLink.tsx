import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router'
import { FOCUS_RING } from './focusRing'

/**
 * The quiet text link — teal, underlined, never styled to compete with a
 * filled CTA (DESIGN_SYSTEM.md §8). Extracted when the LinkButton review
 * found the pattern hand-copied ~20 times and already forked on every
 * axis: radius (card vs compact), the 44px target (present vs absent),
 * hover (present vs absent), weight — and 11 auth-page copies referenced
 * `text-brand-primary`, a token that DOES NOT EXIST, so they rendered
 * with no colour at all.
 *
 * Three shapes:
 *   default    a standalone action on its own line — carries the 44px
 *              target (min-h-11), text-sm, font-medium
 *   inline     lives INSIDE a sentence, heading, or table cell — inherits
 *              the surrounding size/weight and adds no min-height (a 44px
 *              box mid-sentence would wreck the line)
 *   block      a full-width centred stack entry (the drawer's continue)
 *
 * `tone="ink"` is for links whose text colour is the surrounding ink
 * (frozen product names in order rows) — the underline carries the
 * affordance; hover still answers in teal.
 */
export function textLinkClass(
  options: { inline?: boolean; block?: boolean; tone?: 'brand' | 'ink' } = {},
): string {
  const { inline = false, block = false, tone = 'brand' } = options
  const toneClass =
    tone === 'brand'
      ? 'text-brand-teal hover:text-brand-teal-strong'
      : 'text-text-ink hover:text-brand-teal-strong'
  const shape = block
    ? 'flex min-h-11 w-full items-center justify-center text-sm font-medium'
    : inline
      ? ''
      : 'inline-flex min-h-11 items-center text-sm font-medium'
  return `${FOCUS_RING} rounded-compact underline transition-colors duration-150 ease-standard hover:decoration-2 ${toneClass} ${shape}`
}

type TextLinkProps = {
  to: LinkProps['to']
  children: ReactNode
  inline?: boolean
  block?: boolean
  tone?: 'brand' | 'ink'
  className?: string
} & Omit<ComponentPropsWithoutRef<'a'>, 'href' | 'className' | 'children'>

export function TextLink({
  to,
  children,
  inline,
  block,
  tone,
  className = '',
  ...rest
}: TextLinkProps) {
  // A new-tab link gets noopener automatically (review finding): every
  // future target="_blank" caller is covered here instead of each one
  // remembering rel by hand. A caller-supplied rel still wins via rest.
  const rel = rest.rel ?? (rest.target === '_blank' ? 'noopener noreferrer' : undefined)
  return (
    <Link
      to={to}
      {...rest}
      rel={rel}
      className={`${textLinkClass({ inline, block, tone })} ${className}`}
    >
      {children}
    </Link>
  )
}
