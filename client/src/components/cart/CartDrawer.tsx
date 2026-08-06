import { useEffect, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useCart } from '../../state/CartContext'
import { getCartLineDisplay } from '../../lib/cartDisplay'
import { minorToPriceString } from '../../lib/money'
import { PriceBlock } from '../catalog/PriceBlock'
import { Drawer } from '../ui/Drawer'
import { FOCUS_RING } from '../ui/focusRing'
import { CartDrawerLine } from './CartDrawerLine'

type CartDrawerProps = {
  /** Owned by the caller. See the closed<->open invariant note below. */
  open: boolean
  /** Which cart line to show. The caller is expected to keep this in lock
   * step with `open` (`drawerSlug === null` iff closed), but this component
   * does not trust that from the outside — see the missing-line branch. */
  slug: string | null
  onClose: () => void
  /**
   * The exact control that should regain focus on close — Slice 8
   * Checkpoint C's responsibility to populate and to keep pointed at the
   * FIRST successful add that opened the drawer (DEC-047-A, R1). This
   * component only accepts and forwards it; it never resolves or assigns a
   * target itself.
   */
  returnFocusRef: RefObject<HTMLElement | null>
}

/**
 * Add-to-cart confirmation — Slice 8 (technical/SLICE_8_PLAN.md, `Accepted`).
 *
 * DESIGN_SYSTEM.md §8: confirmation only, never cart management. `/cart`
 * stays the only surface for quantity editing, removal, undo and checkout —
 * none of those exist here, structurally, not merely hidden.
 *
 * 🔴 Renders the existing `Drawer` exactly as built. No focus trap, no
 * Escape handling, no scrim/inert/scroll-lock code and no focus-restoration
 * logic live in this file — all four §8 obligations are inherited from
 * `Modal` via `Drawer`, unchanged.
 *
 * 🔴 No live region anywhere in this component (DEC-047 D5). A focused
 * dialog announces itself through its role and accessible name; the
 * catalogue's existing `role="status"` confirmation is untouched and
 * unrelated to this component.
 *
 * 🔴 Checkpoint B only: nothing in the application renders this component
 * yet. It is written to the exact contract Checkpoint C will integrate
 * against, so no lifecycle question is left for that checkpoint to invent.
 */
export function CartDrawer({ open, slug, onClose, returnFocusRef }: CartDrawerProps) {
  const { t } = useTranslation('cart')
  const { items, subtotalMinor } = useCart()

  // Read live, never a copied/cached line — a replacement add (D8) or any
  // cart change is reflected on the very next render, with no local state
  // of its own to go stale.
  const item = slug !== null ? items.find((candidate) => candidate.slug === slug) : undefined
  const line = item ? getCartLineDisplay(item) : undefined

  /**
   * 🔴 Missing-line lifecycle (mandatory contract). Fires only post-commit,
   * never during render. Closed guard (`!open`) keeps it silent for every
   * ordinary closed render, including the very first one before any add has
   * ever happened. The `line` guard keeps it silent whenever a genuine line
   * exists. Once both conditions clear, it asks the caller to close — the
   * caller's `onClose` is expected to have a stable identity (Checkpoint
   * C), so this effect does not re-enter on every unrelated render, and a
   * second call after the caller has already gone to `open === false` is a
   * no-op the guard itself prevents from ever firing twice.
   *
   * No local copy of cart state is kept to detect this — `line` is derived
   * fresh from `CartContext.items` on every render, exactly like everywhere
   * else in this component. Registered unconditionally, before any early
   * return below, so the Rules of Hooks hold regardless of which branch the
   * render takes.
   */
  useEffect(() => {
    if (!open) return
    if (line !== undefined) return
    onClose()
  }, [open, line, onClose])

  /**
   * 🔴 Missing-line render guard — the correction this checkpoint adds.
   *
   * `Drawer` always hands `Modal` a LITERAL `open={true}` for as long as
   * `Drawer` itself stays mounted (see Drawer.tsx: `<Modal {...modalProps}
   * open ...>`) — that literal, not a derived "effective open", is what
   * keeps the panel rendering through the exit slide. Folding the
   * missing-line case into a derived `open` prop on `Drawer` therefore does
   * NOT stop Modal's title and close button from rendering: only `children`
   * was conditional, so the chrome would render — with `{line && (...)}`
   * having gone empty — for the length of Drawer's exit transition. That is
   * the exact defect this guard removes.
   *
   * Returning null OUTRIGHT here — after every hook above has already been
   * registered — unmounts `Drawer` synchronously instead. `Drawer`/`Modal`
   * therefore never render at all in this state: no title, no close button,
   * no empty content for a single frame. This is deliberately NOT the
   * normal exit transition; a missing line while `open` is still true is an
   * invalid caller state being corrected, not an ordinary close, so
   * skipping the slide here is correct. `Modal`'s own effect cleanups
   * (scroll lock, inert, focus trap, return focus) still run on this
   * unmount exactly as they do on any other Modal unmount — nothing here
   * bypasses them.
   */
  if (open && line === undefined) {
    return null
  }

  return (
    <Drawer open={open} onClose={onClose} title={t('drawer.title')} returnFocusRef={returnFocusRef}>
      {line && (
        <div className="flex flex-col gap-4 p-4">
          <CartDrawerLine line={line} />

          {/*
            🔴 The ONLY money value in this drawer — the cart's own
            subtotalMinor selector, read directly from CartContext, never
            re-derived. Same honest snapshot label /cart uses (DEC-047 D2).
            No shipping, tax, discount, threshold or grand total (D3) —
            those rows are absent, not hidden behind a placeholder.
          */}
          <p className="flex flex-wrap items-baseline gap-2 border-t border-border-hairline pt-4">
            <span className="text-sm text-text-muted">{t('subtotal.label')}</span>
            <PriceBlock price={minorToPriceString(subtotalMinor)} />
          </p>

          {/* Primary action — a semantic link, per DEC-047 D6's rule that
              the header cart control (not this one) owns /cart navigation
              behaviour in general; this is the drawer's own dedicated
              action. */}
          <Link
            to="/cart"
            className={`${FOCUS_RING} flex min-h-11 items-center justify-center rounded-card bg-brand-teal px-4 text-sm font-medium text-white transition-colors duration-150 ease-standard hover:bg-brand-teal-strong`}
          >
            {t('drawer.goToCart')}
          </Link>

          {/* Quiet close action — a semantic button, distinct from the link
              above and from CartPage's page.backToCatalog (DEC-047, §6). */}
          <button
            type="button"
            onClick={onClose}
            className={`${FOCUS_RING} flex min-h-11 items-center justify-center rounded-compact text-sm font-medium text-brand-teal underline`}
          >
            {t('drawer.continue')}
          </button>
        </div>
      )}
    </Drawer>
  )
}
