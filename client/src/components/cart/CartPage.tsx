import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useCart } from '../../state/CartContext'
import { getCartLines, type CartLineDisplay } from '../../lib/cartDisplay'
import { PriceBlock } from '../catalog/PriceBlock'
import { formatPrice } from '../../lib/formatPrice'
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
  /** One money-formatting path for the whole app — DESIGN_SYSTEM §2. */
  const money = (value: string) => formatPrice(value, language)

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
      <h1 className="heading-page">{t('page.title')}</h1>

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
                🔴 Every figure below is the SERVER's, recomputed from live
                product rows on every response. The client renders money and
                never derives it — it does not compare the basis to the
                threshold, does not subtract to find the remainder, and does
                not decide whether shipping is free (§3.4).

                Still absent, deliberately: VAT and any grand total. Both are
                `TBD` (DEC-058), and a placeholder would read as a real number.
              */}
              <div className="mt-6 flex flex-col gap-2 border-t border-border-hairline pt-4">
                <p className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm text-text-muted">{t('subtotal.label')}</span>
                  <PriceBlock price={cart.subtotal} />
                </p>

                {/*
                  🔴 DEC-058. Shown ONLY when something is actually shippable —
                  an empty cart, or one whose every line is withdrawn, gets no
                  shipping row at all. Not ₪0, not "free": free shipping is a
                  promise about an ORDER, and there is no order for one to be
                  about.
                */}
                {cart.shipping.hasShippableLines && (
                  <>
                    <p className="flex flex-wrap items-baseline gap-2">
                      <span className="text-sm text-text-muted">{t('shipping.label')}</span>
                      {cart.shipping.isFree ? (
                        // `state-commerce`, not a new "success" token: the
                        // design system reserves it for discount labels, and a
                        // free-shipping label is one. Inventing a colour would
                        // be a design decision, and those are gated.
                        <span className="text-sm font-medium text-state-commerce">
                          {t('shipping.free')}
                        </span>
                      ) : (
                        <PriceBlock price={cart.shipping.cost} />
                      )}
                    </p>

                    {/*
                      🔴 THE BASIS IS STATED, and this is a requirement rather
                      than a nicety. When a withdrawn line is in the cart the
                      screen shows a subtotal of one figure while shipping is
                      measured against a smaller one, and an unexplained gap
                      between two numbers on one screen reads as a bug.

                      The sentence therefore names WHICH total the threshold
                      measures whenever the two differ, and states the plain
                      rule when they do not.
                    */}
                    {/*
                      🔴 Money is formatted by `formatPrice` — Intl only, never
                      by hand (DESIGN_SYSTEM §2 / DEC-035). The first version of
                      these strings hand-wrote "₪{{amount}}", which put the
                      shekel sign on the wrong side of the number in Hebrew and
                      bypassed the single formatting path the whole site uses.
                    */}
                    <p className="text-xs text-text-muted">
                      {/*
                        🔴 THE THRESHOLD IS MOOT WHEN NOTHING IS DELIVERED, and
                        this branch is what makes that true rather than merely
                        stated. Self pickup returns basis === subtotal with
                        isFree false and remainingForFree '0.00', so without it
                        the very next line renders "add ₪0.00 more to get free
                        shipping" to someone collecting their own order.
                        ⚠️ It is unreachable today only because the cart has no
                        method picker and the server defaults to courier — which
                        is exactly the coincidence the flag exists to stop
                        relying on. Checkpoint F feeds a real method in here.
                      */}
                      {cart.shipping.noDeliveryRequired
                        ? t('shipping.noDelivery')
                        : cart.shipping.basis === cart.subtotal
                        ? cart.shipping.isFree
                          ? t('shipping.qualified', { threshold: money(cart.shipping.threshold) })
                          : t('shipping.remaining', {
                              amount: money(cart.shipping.remainingForFree),
                              threshold: money(cart.shipping.threshold),
                            })
                        : // 🔴 The two figures DISAGREE, so the basis is named —
                          // whether or not shipping came out free. A cart that
                          // says "qualifies" beside a larger subtotal is the
                          // same unexplained gap as one that says "add ₪X".
                          cart.shipping.isFree
                          ? t('shipping.qualifiedExcludingUnavailable', {
                              threshold: money(cart.shipping.threshold),
                              basis: money(cart.shipping.basis),
                            })
                          : t('shipping.remainingExcludingUnavailable', {
                              amount: money(cart.shipping.remainingForFree),
                              threshold: money(cart.shipping.threshold),
                              basis: money(cart.shipping.basis),
                            })}
                    </p>
                  </>
                )}
              </div>

              {/*
                🔴 ISSUE-104 — THE WAY IN TO CHECKOUT, ABSENT SINCE F2c.
                `/checkout` shipped four checkpoints ago and NOTHING IN THIS
                CLIENT LINKED TO IT: a grep found the string only in comments.
                The screen worked, the flow behind it was tested end to end, and
                the only way in was to type the URL — while the commit that
                shipped it, and STATUS.md, both claimed a shopper could place an
                order by clicking. The USER found it in a browser in minutes.

                ⚠️ HIDDEN WHILE A LINE BLOCKS CHECKOUT, not disabled. The cart
                already explains the reason beside the offending row (C3 above),
                and `hasBlockingLine` is the SERVER's flag — the client never
                re-derives it. Offering a control the checkout screen would
                refuse just sends the shopper somewhere to be told no.
              */}
              {!cart.hasBlockingLine && (
                <p className="mt-6">
                  <Link
                    to="/checkout"
                    className={`${FOCUS_RING} inline-flex min-h-11 items-center justify-center rounded-card border border-transparent bg-brand-teal px-4 text-sm font-medium text-white transition-colors duration-150 ease-standard hover:bg-brand-teal-strong`}
                  >
                    {t('page.checkoutCta')}
                  </Link>
                </p>
              )}

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
