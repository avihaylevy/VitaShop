import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useCart } from '../../state/CartContext'
import { getCartLines, type CartLineDisplay } from '../../lib/cartDisplay'
import { PriceBlock } from '../catalog/PriceBlock'
import { Button } from '../ui/Button'
import { FOCUS_RING } from '../ui/focusRing'
import type { SupportedLanguage } from '../../i18n'
import { CartItemRow, CART_ROW_ATTRIBUTE } from './CartItemRow'
import { CartOutcomeNotice } from './CartOutcomeNotice'
import { EmptyCart } from './EmptyCart'
import { UndoRow } from './UndoRow'

/** The one removal that can currently be undone. Never a stack. */
type PendingUndo = { slug: string; name: string; quantity: number }

/**
 * Production `/cart` route — MILESTONE-007 Checkpoint G.
 *
 * 🔴 THE CART COMES FROM THE SERVER. This page used to read a browser-memory
 * reducer, compute its own subtotal from stored agorot, and legitimately show
 * an empty cart after a reload. All three are gone: §3.4 puts price, stock and
 * identity on the server, and the client renders what it is told.
 *
 * 🔴 THREE STATES THE PROTOTYPE NEVER HAD TO HANDLE, because browser memory
 * never fails: LOADING, FAILED and (now genuinely) EMPTY. A failed load does
 * NOT render the empty cart — "your cart is empty" would be a claim the client
 * has no standing to make when it could not reach the server at all.
 *
 * 🔴 UNDO IS A REAL REQUEST NOW. It re-adds the removed product at the quantity
 * the server last reported for it. It is therefore subject to the same clamp as
 * any other add, and if stock has gone in the meantime the undo honestly fails
 * or comes back smaller — which the outcome notice states. The prototype's undo
 * could never fail because nothing was ever asked.
 *
 * ⚠️ The restored line lands at the END of the list rather than at its former
 * index: line order is the server's (`orderBy: id`), and a re-added line is a
 * new row. The prototype restored by remembered index; that index no longer
 * exists to honour, and inventing one client-side would be exactly the kind of
 * local truth this checkpoint removed.
 *
 * No `<main>` here — `AppShell` already supplies the one main landmark.
 */
export function CartPage() {
  const { t, i18n } = useTranslation('cart')
  const language = i18n.language as SupportedLanguage
  const { status, cart, failure, outcome, pending, setLineQuantity, removeLine, addItem, refresh, dismissOutcome } =
    useCart()

  const [pendingUndo, setPendingUndo] = useState<PendingUndo | null>(null)
  /** Set only by a successful undo, so focus lands in the restored row. */
  const [pendingRestoreFocus, setPendingRestoreFocus] = useState<string | null>(null)
  const undoRowRef = useRef<HTMLDivElement | null>(null)

  const lines = getCartLines(cart, language)

  const handleRemove = useCallback(
    (line: CartLineDisplay) => {
      // Captured BEFORE the request: once it succeeds the line is gone and its
      // quantity is unknowable.
      const snapshot = { slug: line.slug, name: line.name, quantity: line.quantity }
      void removeLine(line.id, line.name).then((ok) => {
        // 🔴 The undo is offered ONLY on a confirmed removal. Offering it after
        // a failed request would invite the shopper to "undo" something that
        // never happened, which would then ADD a line they never asked for.
        setPendingUndo(ok ? snapshot : null)
      })
    },
    [removeLine],
  )

  /**
   * 🔴 Any other cart mutation invalidates the pending undo. Once quantities
   * have moved, restoring a line is no longer the same operation the shopper
   * asked to reverse. A second removal replaces the opportunity rather than
   * stacking it.
   */
  const handleIncrement = useCallback(
    (line: CartLineDisplay) => {
      setPendingUndo(null)
      void setLineQuantity(line.id, line.name, line.quantity + 1)
    },
    [setLineQuantity],
  )

  const handleDecrement = useCallback(
    (line: CartLineDisplay) => {
      setPendingUndo(null)
      void setLineQuantity(line.id, line.name, line.quantity - 1)
    },
    [setLineQuantity],
  )

  const handleUndo = useCallback(() => {
    if (!pendingUndo) return
    const { slug, name, quantity } = pendingUndo
    setPendingUndo(null)
    void addItem(slug, quantity, name).then((ok) => {
      if (ok) setPendingRestoreFocus(slug)
    })
  }, [pendingUndo, addItem])

  // 🔴 Focus moves only after the commit that puts the Undo button in the DOM
  // — an effect, never during render, and never on a timeout.
  useEffect(() => {
    if (pendingUndo) {
      undoRowRef.current?.querySelector('button')?.focus()
    }
  }, [pendingUndo])

  // After a successful undo, focus lands on the restored row's first enabled
  // control. The row is found by its own slug-bound attribute, never by
  // translated text and never by a selector that could match another row.
  useEffect(() => {
    if (!pendingRestoreFocus) return
    const row = document.querySelector(`[${CART_ROW_ATTRIBUTE}="${CSS.escape(pendingRestoreFocus)}"]`)
    row?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus()
    setPendingRestoreFocus(null)
  }, [pendingRestoreFocus])

  // A cart the shopper navigated back to may be stale — another tab, or a login
  // that merged a guest cart into it. Clearing the last outcome on unmount
  // stops a message about a change made minutes ago from greeting them.
  useEffect(() => dismissOutcome, [dismissOutcome])

  return (
    <div className="px-7 py-8">
      <h1 className="text-2xl font-semibold text-text-ink">{t('page.title')}</h1>

      {/*
        🔴 LOADING AND FAILED ARE REAL, RENDERED STATES. The state layer this
        page replaced could not produce either, so neither had ever been drawn.
      */}
      {status === 'loading' && (
        <p role="status" className="mt-6 text-sm text-text-muted">
          {t('state.loading')}
        </p>
      )}

      {status === 'error' && (
        <div role="alert" className="mt-6 flex flex-col items-start gap-3">
          <p className="text-sm text-state-error">
            {failure?.kind === 'network' ? t('state.errorOffline') : t('state.error')}
          </p>
          <Button variant="secondary" onClick={() => void refresh()}>
            {t('state.retry')}
          </Button>
        </div>
      )}

      {status === 'ready' && (
        <>
          {/*
            Rendered outside the empty/populated branch on purpose: removing the
            last line must stay reversible, so EmptyCart and the UndoRow coexist
            rather than the undo vanishing with the list.
          */}
          {pendingUndo && (
            <UndoRow productName={pendingUndo.name} onUndo={handleUndo} rowRef={undoRowRef} />
          )}

          {/*
            🔴 A mutation can fail while a cart is already on screen. The cart
            stays — nothing changed server-side — and the failure is stated
            rather than left as a control that visibly did nothing.
          */}
          {failure && (
            <p role="alert" className="mt-4 text-sm text-state-error">
              {failure.kind === 'network' ? t('state.errorOffline') : t('state.actionFailed')}
            </p>
          )}

          {/*
            🔴 The subject is the product NAME, passed by the handlers above —
            never the slug. The browser pass caught this reporting
            "altman-probiotic-intense-30 was removed from the cart": after a
            removal the line is gone, so a name resolved FROM THE CART is
            unresolvable exactly when it is needed.
          */}
          <CartOutcomeNotice outcome={outcome} />

          {lines.length === 0 ? (
            <EmptyCart />
          ) : (
            <>
              {/*
                Plain text, deliberately not a live region: the quantity
                stepper's own aria-live is the single announcement mechanism for
                quantity, and a second page-level region would double-announce
                every change. Counts total UNITS, matching the Header badge
                exactly — never distinct lines. The count is the SERVER's.
              */}
              <p className="mt-2 text-sm text-text-muted">
                {t('page.summary', { count: cart.totalQuantity })}
              </p>

              <ul className="mt-6">
                {lines.map((line) => (
                  // Keyed by the LINE id, not the slug: the id is what the
                  // server addresses, and it is what survives a re-add.
                  <li key={line.id} className="border-b border-border-hairline last:border-b-0">
                    <CartItemRow
                      line={line}
                      busy={pending}
                      onIncrement={handleIncrement}
                      onDecrement={handleDecrement}
                      onRemove={handleRemove}
                    />
                  </li>
                ))}
              </ul>

              {/*
                🔴 C3 — checkout is BLOCKED while any line's product is
                inactive, and the block is stated in words next to the reason.
                `hasBlockingLine` is the SERVER's flag; the client does not
                re-derive it from the rows, so the two can never disagree.
              */}
              {cart.hasBlockingLine && (
                <p role="alert" className="mt-6 text-sm font-medium text-state-error">
                  {t('blocked.message')}
                </p>
              )}

              {/*
                🔴 The subtotal is the SERVER's, recomputed from live product
                rows on every response. It used to be a client-side sum over
                prices captured at add time, with a label admitting as much —
                that label is gone because the caveat it carried is gone. Still
                no shipping, tax, discount, threshold, grand total or checkout:
                none of them has an approved value yet.
              */}
              <p className="mt-6 flex flex-wrap items-baseline gap-2 border-t border-border-hairline pt-4">
                <span className="text-sm text-text-muted">{t('subtotal.label')}</span>
                <PriceBlock price={cart.subtotal} />
              </p>

              {/* Quiet link, never styled to compete (DESIGN_SYSTEM.md §8). */}
              <p className="mt-6">
                <Link
                  to="/catalog"
                  className={`${FOCUS_RING} inline-flex min-h-11 items-center rounded-compact text-sm font-medium text-brand-teal underline`}
                >
                  {t('page.backToCatalog')}
                </Link>
              </p>
            </>
          )}
        </>
      )}
    </div>
  )
}
