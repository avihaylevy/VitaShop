import { useCallback, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { useCart } from '../../state/CartContext'
import { toCartLineDisplay, type CartLineDisplay } from '../../lib/cartDisplay'
import type { SupportedLanguage } from '../../i18n'
import { PriceBlock } from '../catalog/PriceBlock'
import { CenterDialog } from '../ui/CenterDialog'
import { LinkButton } from '../ui/LinkButton'
import { Button } from '../ui/Button'
import { CartItemRow } from './CartItemRow'
import { useCartOutcomeMessage } from './CartOutcomeNotice'
import { isPlainNavigationClick } from '../../lib/agentConversation'

type CartDrawerProps = {
  /** Owned by the caller (useAddToCart). */
  open: boolean
  onClose: () => void
  /**
   * The exact control that should regain focus on close — populated by the
   * caller at the FIRST successful add that opened the drawer (DEC-047-A,
   * R1). This component only accepts and forwards it; it never resolves or
   * assigns a target itself.
   */
  returnFocusRef: RefObject<HTMLElement | null>
  /**
   * DEC-112 (1+2) — true on the surfaces where useAddToCart opens the
   * drawer, which is always in response to a confirmed ADD: the title
   * reads "נוסף לעגלה" so the panel presents as the add's confirmation,
   * not as a second cart. The header's browse-opened instance keeps the
   * cart title (that one IS a glance at the cart).
   */
  openedByAdd?: boolean
}

/**
 * DEC-073 — the compact panel; DEC-096 drew the drawer/page split;
 * DEC-112 (2026-08-27) SHARPENS it after the user asked what the point
 * of having both even is: the drawer is "KEEP SHOPPING" — confirm an
 * add, fix a quantity, remove a mistake, without leaving the catalog —
 * and the PAGE is "review before checkout", the only home of full line
 * detail (package/unit price/stock badge), club savings + join, the
 * shipping cost + free-shipping progress bar, and undo. The drawer's
 * rows render CartItemRow's `compact` variant and its only money line
 * is the subtotal.
 *
 * 🔴 WHAT CHANGED AND WHAT DID NOT:
 *   · it shows THE WHOLE CART, not the one line just added, with the same
 *     `CartItemRow` the cart page uses — DESIGN_SYSTEM.md §8's "one item-row
 *     structure, used for every line" (the compact prop omits page-only
 *     detail, it does not fork the structure). Steppers and removal call
 *     the same server endpoints; §3.4 stands, no client quantity math.
 *   · D1 STANDS: the caller opens it only on a server-confirmed add, never
 *     optimistically — and per DEC-073 only on the FIRST add of a session.
 *   · D5 STANDS: no live region in here. A focused dialog announces itself;
 *     the outcome message renders as ordinary text (see
 *     `useCartOutcomeMessage`'s own note).
 *   · the ONLY money values are the SERVER's line totals and subtotal. No
 *     shipping/threshold rows — those remain the page's (DEC-047 D3 kept
 *     for everything but editing).
 *
 * ⚠️ NO UNDO ROW HERE, deliberately. Undo is the page's machinery
 * (UndoRow + its focus-restoration choreography); a removal in the drawer is
 * stated by the drawer's OWN removal notice (which also receives focus —
 * `messageFor` deliberately says nothing for removals), and the page remains
 * the place to recover it. Duplicating the undo would duplicate the exact
 * choreography ISSUE-105 existed to stop being copied.
 *
 * 🔴 AN EMPTY CART DOES NOT SLAM THE DOOR. Removing the last line keeps the
 * panel open and says the cart is empty — closing a dialog the shopper is
 * interacting with is the unmount-on-success family
 * (.claude/rules/browser-verification.md), and the close button is mounted
 * either way.
 */
export function CartDrawer({ open, onClose, returnFocusRef, openedByAdd = false }: CartDrawerProps) {
  const { t, i18n } = useTranslation('cart')
  const language = i18n.language as SupportedLanguage
  const { cart, outcome, failure, pending, setLineQuantity } = useCart()

  /** Close only on the plain left-click that navigates THIS tab — a
   *  modified click opens a new tab and must not yank the drawer. */
  const closeOnPlainClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (isPlainNavigationClick(event)) onClose()
    },
    [onClose],
  )

  // Read live from the SERVER's cart on every render — no copied lines, so a
  // clamp, a removal or a concurrent change is reflected immediately.
  const lines = cart.items.map((item) => toCartLineDisplay(item, language))

  /*
   * 🔴 THE SUBJECT IS RESOLVED TO A NAME (review finding). The catalogue's
   * adds arrive with the SLUG as their subject (`useAddToCart` has only the
   * slug), so the first clamp a shopper ever saw would have read "Only 2 of
   * altman-probiotic-intense-30 are in stock" — the exact defect two other
   * files record from a browser pass. The drawer has the lines in hand:
   * a subject matching a line's slug renders that line's name; anything else
   * (already a name, from this drawer's own steppers) passes through.
   */
  const subjectName =
    outcome !== null
      ? (lines.find((line) => line.slug === outcome.subject)?.name ?? outcome.subject)
      : undefined
  const outcomeMessage = useCartOutcomeMessage(outcome, subjectName)

  const handleIncrement = useCallback(
    (line: CartLineDisplay) => {
      void setLineQuantity(line.id, line.name, line.quantity + 1)
    },
    [setLineQuantity],
  )
  const handleDecrement = useCallback(
    (line: CartLineDisplay) => {
      void setLineQuantity(line.id, line.name, line.quantity - 1)
    },
    [setLineQuantity],
  )
  // DEC-112 third pass (the user: "remove the remove button from the cart
  // drawer") — REMOVAL IS PAGE-ONLY AGAIN, restoring DEC-096's original
  // split and superseding the lecturer-list reversal of 2026-08-23.
  // CartItemRow's contract already models it: an absent onRemove renders
  // no removal control. A blocked line's warning still shows here; the
  // page (one tap below) is where it is resolved, beside UndoRow.

  /*
   * Review finding (this diff): useAddToCart also RE-OPENS the drawer on a
   * clamped / refused-at-max add — the §7.16 rule — and on that path
   * NOTHING was added. "Added to cart" over an outcome line saying the
   * quantity didn't change is exactly the silent-loss contradiction the
   * re-open exists to prevent, so the confirmation title is gated on the
   * outcome actually being a clean take, not on the open path alone.
   */
  const addTook =
    outcome === null ||
    !(outcome.clampedByStock || outcome.clampedByCap || outcome.alreadyAtMaximum || outcome.unchanged)

  return (
    // The user's call (2026-08-16): a centered compact dialog, not the
    // edge drawer. Everything inside is untouched — DEC-073's editing
    // panel contract lives in the content, not the frame.
    <CenterDialog
      open={open}
      onClose={onClose}
      title={t(openedByAdd && addTook ? 'drawer.titleAdded' : 'drawer.title')}
      returnFocusRef={returnFocusRef}
    >
      {/*
        DEC-112, second pass (the user, on sight: "two scrolling bars…
        still looks like a duplicated cart"). ONE scroller: this wrapper
        caps itself just under the panel's own ceiling, every section but
        the list is shrink-0, and the LIST alone shrinks and scrolls
        (min-h-0 + overflow-y-auto). The Modal body therefore never
        overflows, so its own scrollbar never appears — the fixed 45dvh
        list cap that double-scrolled is gone.
        ⚠️ The calc is COUPLED to two upstream numbers: CenterDialog's
        max-h-[85dvh] panel cap and Modal's ~69px header row (py-3 +
        size-11 close + hairline). 72px covers the header with margin —
        but NOT Modal's optional `description` paragraph (rendered
        outside the scrolling body) and not a title long enough to wrap:
        either silently brings the double scrollbar back. Do not pass
        `description` to this CenterDialog without revisiting the calc.
        `max-h-full` would be the clean form, but the body's flex-derived
        height is indefinite to percentage resolution in Chromium, so the
        cap silently never applied (measured live: the body scrolled, the
        list did not). The durable fix is Modal-level (a flex-column body
        so consumers need only min-h-0) — recorded as ISSUE-191; the
        SECOND dialog needing an internal scroller triggers it, not a
        second copy of this calc.
      */}
      <div className="flex max-h-[calc(85dvh-72px)] flex-col gap-4 p-4">
        {lines.length === 0 ? (
          <p className="shrink-0 text-sm text-text-muted">{t('drawer.empty')}</p>
        ) : (
          /*
           * DEC-112 — rows render COMPACT here (name + line total +
           * stepper + remove; see CartItemRow's compact contract): the
           * page is where full line detail lives, and the visible
           * difference between the two surfaces is the differentiation
           * the user asked for. overscroll-contain keeps a wheel at the
           * list's end from scrolling the page behind the scrim.
           */
          <div className="flex min-h-0 flex-col divide-y divide-border-hairline overflow-y-auto overscroll-contain">
            {lines.map((line) => (
              <CartItemRow
                key={line.id}
                line={line}
                busy={pending}
                compact
                onIncrement={handleIncrement}
                onDecrement={handleDecrement}
              />
            ))}
          </div>
        )}

        {/*
          🔴 STILL A CONFIRMATION as well as an editor: if the server clamped
          an add — to stock or the per-line cap — the panel says so. "Added to
          cart" over a clamp the shopper cannot see is the silent loss §7.16
          forbids.
        */}
        {outcomeMessage && <p className="shrink-0 text-sm text-text-muted">{outcomeMessage}</p>}

        {/*
          🔴 A FAILED mutation is SAID, not left as a control that visibly
          did nothing (review finding). Ordinary text, not role="alert" — D5
          forbids a live region in here, and the shopper is already focused
          inside the dialog where the text appears.
        */}
        {failure && (
          <p className="shrink-0 text-sm text-state-error">
            {failure.kind === 'network' ? t('state.errorOffline') : t('state.actionFailed')}
          </p>
        )}

        {lines.length > 0 && (
          <>
            {/*
              🔴 The SERVER's subtotal, read from CartContext, never
              re-derived. Shipping/threshold rows stay on the page (DEC-047
              D3 for everything except editing).
            */}
            {/*
              DEC-112 second pass: the club savings figure LEFT the glance
              too (ClubSavingsRow is page-only now) — the drawer's only
              money line is the subtotal, and everything club-related
              reads on the page beside the join link that acts on it.
            */}
            <p className="flex shrink-0 flex-wrap items-baseline gap-2">
              <span className="text-sm text-text-muted">{t('subtotal.label')}</span>
              <PriceBlock price={cart.subtotal} />
            </p>

            {/*
              DEC-073's "checkout path". ⚠️ HIDDEN while a line blocks
              checkout, exactly like the page's entry (ISSUE-104): the reason
              is explained beside the offending row, `hasBlockingLine` is the
              SERVER's flag, and offering a control checkout would refuse just
              sends the shopper somewhere to be told no.
            */}
            {/* Why there is no checkout button, when there is none — the
                page says this too (review finding: an absent control with no
                explanation is a dead end). Ordinary text, not an alert (D5). */}
            {/*
              Review finding (this diff): with removal now page-only, the
              shared blocked.message told the shopper to "remove them" in
              the one surface that cannot — the drawer variant points at
              the cart page, where the controls actually are.
            */}
            {cart.hasBlockingLine && (
              <p className="shrink-0 text-sm text-state-error">{t('blocked.messageDrawer')}</p>
            )}
            {!cart.hasBlockingLine && (
              /* LinkButton = Button's clothes from one source (the recorded
                 cousin cleanup; both hand-copies here had drifted). The
                 close is DECLINED on modified clicks — a ctrl/cmd/middle
                 click opens checkout in a new tab and must not yank the
                 drawer the shopper kept open (the LinkButton contract).
                 className shrinks the height a notch at md+ (the user,
                 live: three full-44px bars stacked read oversized in this
                 compact dialog) — mobile keeps the 44px floor. */
              <LinkButton
                to="/checkout"
                block
                onClick={closeOnPlainClick}
                className="shrink-0 md:min-h-10"
              >
                {t('page.checkoutCta')}
              </LinkButton>
            )}
          </>
        )}

        {/*
          Area 3 (UI refresh) — the user's call, twice now: first "buttons,
          not underlines" for these two, then "design them better" once
          they saw two identical full-width bordered bars. Side by side
          (half width each) reads as one secondary pair rather than two
          more competing CTAs; `ghost` keeps them visibly quieter than the
          filled checkout button above.

          Review findings (this diff), all three fixed by this shape:
          · flex + flex-1 instead of grid-cols-2 — one child fills the
            row alone in the empty state, so the lines.length condition
            appears ONCE, not twice (className + child);
          · the Button gets `wrap` — its default h-11 whitespace-nowrap
            let "Continue shopping" paint past a ~124px half-cell at
            320px, exactly the width the matrix mandates;
          · items-stretch (flex default) + min-h on BOTH controls — the
            counted go-to-cart label can wrap to two lines, and a fixed
            h-9 sibling would pin at 36px beside it; matching min-h lets
            the pair grow together.
        */}
        <div className="flex shrink-0 items-stretch gap-2">
          {lines.length > 0 && (
            /*
              DEC-112 (2) — the exit carries the cart-wide item COUNT (the
              server's totalQuantity, same figure as the header badge): the
              link reads as the door to the full cart's depth, not a
              duplicate view of this panel.
            */
            <LinkButton
              to="/cart"
              variant="ghost"
              block
              onClick={closeOnPlainClick}
              className="flex-1 md:min-h-9"
            >
              {t('drawer.goToCartCount', { count: cart.totalQuantity })}
            </LinkButton>
          )}
          <Button type="button" variant="ghost" wrap onClick={onClose} className="flex-1 md:min-h-9">
            {t('drawer.continue')}
          </Button>
        </div>
      </div>
    </CenterDialog>
  )
}
