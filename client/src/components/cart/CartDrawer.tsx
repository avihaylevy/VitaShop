import { useCallback, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { useCart } from '../../state/CartContext'
import { toCartLineDisplay, type CartLineDisplay } from '../../lib/cartDisplay'
import type { SupportedLanguage } from '../../i18n'
import { PriceBlock } from '../catalog/PriceBlock'
import { CenterDialog } from '../ui/CenterDialog'
import { FOCUS_RING } from '../ui/focusRing'
import { LinkButton } from '../ui/LinkButton'
import { CartItemRow } from './CartItemRow'
import { useCartOutcomeMessage } from './CartOutcomeNotice'
import { isPlainNavigationClick } from '../../lib/agentConversation'
import { ClubSavingsRow } from './ClubSavingsRow'

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
}

/**
 * DEC-073 — the compact panel; DEC-096 (2026-08-21, the user going with the
 * recommended split for ISSUE-166) narrows it to a QUICK GLANCE: the whole
 * cart with quantity steppers, subtotal, and the two exits (checkout · the
 * full cart page). REMOVAL moved to the page alone — that is where UndoRow
 * and its recovery choreography live, and the split is the drawer/page
 * differentiation the user asked to decide.
 *
 * 🔴 WHAT CHANGED AND WHAT DID NOT:
 *   · it shows THE WHOLE CART, not the one line just added, with the same
 *     `CartItemRow` the cart page uses — DESIGN_SYSTEM.md §8's "one item-row
 *     structure, used for every line", finally applied here too. Steppers
 *     and removal call the same server endpoints; §3.4 stands, no client
 *     quantity math.
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
export function CartDrawer({ open, onClose, returnFocusRef }: CartDrawerProps) {
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

  return (
    // The user's call (2026-08-16): a centered compact dialog, not the
    // edge drawer. Everything inside is untouched — DEC-073's editing
    // panel contract lives in the content, not the frame.
    <CenterDialog open={open} onClose={onClose} title={t('drawer.title')} returnFocusRef={returnFocusRef}>
      <div className="flex flex-col gap-4 p-4">
        {lines.length === 0 ? (
          <p className="text-sm text-text-muted">{t('drawer.empty')}</p>
        ) : (
          <div className="flex flex-col divide-y divide-border-hairline">
            {lines.map((line) => (
              <CartItemRow
                key={line.id}
                line={line}
                busy={pending}
                onIncrement={handleIncrement}
                onDecrement={handleDecrement}
                // DEC-096: no removal in the quick glance — the page owns it.
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
        {outcomeMessage && <p className="text-sm text-text-muted">{outcomeMessage}</p>}

        {/*
          🔴 A FAILED mutation is SAID, not left as a control that visibly
          did nothing (review finding). Ordinary text, not role="alert" — D5
          forbids a live region in here, and the shopper is already focused
          inside the dialog where the text appears.
        */}
        {failure && (
          <p className="text-sm text-state-error">
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
            {/* DEC-096: the club HINT copy stays on the page; the glance
                keeps only the figures (ClubSavingsRow below). */}
            {/* The seventh list, item 2 — the shared row; ClubSavingsRow
                owns the gate and the member/join reading. */}
            <ClubSavingsRow cart={cart} />
            <p className="flex flex-wrap items-baseline gap-2">
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
            {cart.hasBlockingLine && (
              <p className="text-sm text-state-error">{t('blocked.message')}</p>
            )}
            {!cart.hasBlockingLine && (
              /* LinkButton = Button's clothes from one source (the recorded
                 cousin cleanup; both hand-copies here had drifted). The
                 close is DECLINED on modified clicks — a ctrl/cmd/middle
                 click opens checkout in a new tab and must not yank the
                 drawer the shopper kept open (the LinkButton contract). */
              <LinkButton to="/checkout" block onClick={closeOnPlainClick}>
                {t('page.checkoutCta')}
              </LinkButton>
            )}

            {/* The full cart page — shipping detail, undo, the wider layout. */}
            <LinkButton to="/cart" variant="secondary" block onClick={closeOnPlainClick}>
              {t('drawer.goToCart')}
            </LinkButton>
          </>
        )}

        {/* Quiet close action — mounted in EVERY state, empty cart included. */}
        <button
          type="button"
          onClick={onClose}
          className={`${FOCUS_RING} flex min-h-11 items-center justify-center rounded-compact text-sm font-medium text-brand-teal underline transition-colors duration-150 ease-standard hover:text-brand-teal-strong hover:decoration-2`}
        >
          {t('drawer.continue')}
        </button>
      </div>
    </CenterDialog>
  )
}
