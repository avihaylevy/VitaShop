import type { ComponentPropsWithoutRef, MouseEvent, ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router'
import { FOCUS_RING } from './focusRing'
import { ArrowForwardIcon } from '../icons'
import { VARIANT_CLASS } from './Button'

type LinkButtonProps = {
  to: LinkProps['to']
  children: ReactNode
  /**
   * Only the variants a NAVIGATION can honestly wear — `danger` stays
   * Button-only (a destructive action is never a link). `ghost` joined
   * when AccountMenu's register CTA turned out to be a hand-copied ghost
   * string sitting beside its converted sibling (review finding).
   */
  variant?: 'primary' | 'secondary' | 'ghost'
  /** 'hero' is the home/about CTA scale; 'base' matches Button. */
  size?: 'base' | 'hero'
  /**
   * Block-level, full-width — for stacked CTAs in a BLOCK container
   * (AccountMenu's dropdown). An inline-flex box there sits on a line box
   * and adds descender leading under itself, breaking the stack rhythm
   * (review finding); flex items are blockified anyway, so drawers can
   * use it too for the same visual with clearer intent.
   */
  block?: boolean
  className?: string
  /**
   * Side work riding the navigation. Never preventDefault — the Link still
   * navigates; this only lets the host clean up. The event is forwarded so
   * the host can decline on MODIFIED clicks (ctrl/cmd/shift/middle open a
   * new tab without navigating THIS one — review finding: an unconditional
   * close ran anyway and yanked the surface the user meant to keep). Pair
   * with `lib/agentConversation.ts`'s `isPlainNavigationClick`.
   */
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void
  // The rest of the anchor surface, the Badge/Button/Input precedent: a
  // closed prop list taxed every new attribute three lines (a bespoke
  // `role?: string` was the first — and its bare string type let a typo'd
  // role compile while silently dropping the entry from AccountMenu's
  // arrow-key ring). `role` now arrives TYPED via React's own AriaRole.
} & Omit<ComponentPropsWithoutRef<'a'>, 'href' | 'className' | 'onClick' | 'children'>

/**
 * A react-router Link wearing Button's clothes — navigation is a link,
 * never a button pretending (the HomePage rule), but a primary CTA must
 * still LOOK like every other primary action. Draws from Button's own
 * VARIANT_CLASS so a token change reaches both. Extracted when the
 * ISSUE-119/125 review found the hero-CTA class string hand-copied across
 * two pages, already drifted from Button's values.
 *
 * 🔴 min-h, never a fixed height — a label that wraps at 320px must grow
 * the box, not overflow a hard 44px (review finding: the adopted call
 * sites all carried `min-h-11` and the first extraction dropped it).
 */
export function LinkButton({
  to,
  children,
  variant = 'primary',
  size = 'base',
  block = false,
  className = '',
  onClick,
  ...rest
}: LinkButtonProps) {
  return (
    <Link
      to={to}
      onClick={onClick}
      {...rest}
      className={`${FOCUS_RING} ${
        block ? 'flex w-full' : 'inline-flex'
      } items-center justify-center rounded-card font-medium transition-colors duration-150 ease-standard ${
        /* The lecturer-fixes list (2026-08-23, second round — the first
           lift+shadow pass read as "hasn't changed"): the hero CTA is now
           unmistakably its own control. A teal GRADIENT (both stops are
           the existing brand tokens — no new colour), semibold, wider, a
           brand shadow, a built-in forward ARROW that slides on hover, and
           a motion-safe lift; reduced motion keeps colour/shadow only. */
        size === 'hero'
          ? 'group min-h-12 gap-2.5 bg-gradient-to-r from-brand-teal to-brand-teal-strong px-8 text-base font-semibold shadow-[0_3px_14px_rgba(21,112,106,0.35)] transition-[box-shadow,filter] hover:brightness-110 hover:shadow-[0_8px_24px_rgba(21,112,106,0.45)] motion-safe:transition-[box-shadow,filter,transform] motion-safe:hover:-translate-y-1 motion-safe:active:translate-y-0 motion-safe:active:scale-[0.97]'
          : 'min-h-11 px-4 text-sm'
      } ${VARIANT_CLASS[variant]} ${className}`}
    >
      {children}
      {size === 'hero' && (
        <span
          aria-hidden="true"
          // Points "onward" in both directions; slides further on hover.
          className="inline-flex rtl:-scale-x-100 motion-safe:transition-transform motion-safe:duration-200 motion-safe:group-hover:translate-x-1 motion-safe:group-hover:rtl:-translate-x-1"
        >
          <ArrowForwardIcon width={18} height={18} />
        </span>
      )}
    </Link>
  )
}
