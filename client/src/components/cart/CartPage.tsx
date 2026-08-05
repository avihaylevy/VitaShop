import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useCart } from '../../state/CartContext'
import type { CartItem } from '../../types/cart'
import { getCartLines } from '../../lib/cartDisplay'
import { minorToPriceString } from '../../lib/money'
import { PriceBlock } from '../catalog/PriceBlock'
import { FOCUS_RING } from '../ui/focusRing'
import { CartItemRow, CART_ROW_ATTRIBUTE } from './CartItemRow'
import { EmptyCart } from './EmptyCart'
import { UndoRow } from './UndoRow'

/** The one removal that can currently be undone. Never a stack. */
type PendingUndo = { item: CartItem; index: number }

/**
 * Production `/cart` route — Slice 7b (technical/SLICE_7B_PLAN.md, Accepted).
 *
 * DESIGN_SYSTEM.md §8: the full page is the primary and only cart-management
 * surface. `CartDrawer` remains Slice 8 and no drawer behaviour appears here.
 *
 * 🔴 Reads cart state exclusively from `CartContext` — no local copy, no
 * mirrored counts. The Header badge, the count summary and the subtotal
 * therefore cannot disagree: all three derive from the same reducer state.
 *
 * 🔴 Sends no request and touches no storage. The cart is memory-only
 * (DEC-044), so a full reload legitimately shows the empty state — and takes
 * any pending undo with it.
 *
 * No `<main>` here — `AppShell` already supplies the one main landmark.
 */
export function CartPage() {
  const { t } = useTranslation('cart')
  const { items, incrementItem, decrementItem, removeItem, restoreItem, totalQuantity, subtotalMinor } = useCart()

  /**
   * 🔴 Local to this page, by decision. One pending undo, no stack, no timer,
   * no storage, no server state. Navigating away unmounts the page and the
   * opportunity goes with it, which is why returning to /cart can never show
   * a stale UndoRow.
   */
  const [pendingUndo, setPendingUndo] = useState<PendingUndo | null>(null)
  /** Set only by a successful undo, so focus lands in the restored row. */
  const [pendingRestoreFocus, setPendingRestoreFocus] = useState<string | null>(null)
  const undoRowRef = useRef<HTMLDivElement | null>(null)

  const lines = getCartLines(items)

  const handleRemove = useCallback(
    (slug: string) => {
      const index = items.findIndex((item) => item.slug === slug)
      if (index === -1) {
        return
      }
      // The snapshot is captured BEFORE the dispatch, from committed state:
      // after the removal the line is gone and its index is unknowable.
      setPendingUndo({ item: items[index], index })
      removeItem(slug)
    },
    [items, removeItem],
  )

  /**
   * 🔴 Any other cart mutation invalidates the pending undo. Once quantities
   * have moved, restoring a line at a remembered index is no longer the same
   * operation the shopper asked to reverse, and an undo that quietly does
   * something else is worse than no undo. A second removal replaces the
   * opportunity rather than stacking it.
   */
  const handleIncrement = useCallback(
    (slug: string) => {
      setPendingUndo(null)
      incrementItem(slug)
    },
    [incrementItem],
  )

  const handleDecrement = useCallback(
    (slug: string) => {
      setPendingUndo(null)
      decrementItem(slug)
    },
    [decrementItem],
  )

  const handleUndo = useCallback(() => {
    if (!pendingUndo) {
      return
    }
    restoreItem(pendingUndo.item, pendingUndo.index)
    setPendingRestoreFocus(pendingUndo.item.slug)
    setPendingUndo(null)
  }, [pendingUndo, restoreItem])

  // 🔴 Focus moves only after the commit that puts the Undo button in the DOM
  // — an effect, never during render, and never on a timeout. DESIGN_SYSTEM.md
  // §11: "After remove, focus moves to the undo control." It runs for pointer
  // and keyboard removals alike, as the accepted design states.
  useEffect(() => {
    if (pendingUndo) {
      // Exactly one button lives inside the UndoRow, and the search is scoped
      // to that element — no page-wide selector, no translated-text query.
      undoRowRef.current?.querySelector('button')?.focus()
    }
  }, [pendingUndo])

  // After a successful undo, focus lands on the restored row's first enabled
  // control (decrement, else increment, else remove — the row's DOM order).
  // The row is found by its own slug-bound attribute, never by translated text
  // and never by a selector that could match another row.
  useEffect(() => {
    if (!pendingRestoreFocus) {
      return
    }
    const row = document.querySelector(`[${CART_ROW_ATTRIBUTE}="${CSS.escape(pendingRestoreFocus)}"]`)
    const target = row?.querySelector<HTMLButtonElement>('button:not([disabled])')
    target?.focus()
    setPendingRestoreFocus(null)
  }, [pendingRestoreFocus])

  return (
    <div className="px-7 py-8">
      <h1 className="text-2xl font-semibold text-text-ink">{t('page.title')}</h1>

      {/*
        Rendered outside the empty/populated branch on purpose: removing the
        last line must stay reversible, so EmptyCart and the UndoRow coexist
        rather than the undo vanishing with the list.
      */}
      {pendingUndo && (
        <UndoRow productName={pendingUndo.item.name} onUndo={handleUndo} rowRef={undoRowRef} />
      )}

      {lines.length === 0 ? (
        <EmptyCart />
      ) : (
        <>
          {/*
            Plain text, deliberately not a live region: the quantity stepper's
            own aria-live is the single announcement mechanism for quantity
            (DESIGN_SYSTEM.md §8), and a second page-level region would
            double-announce every change. Counts total UNITS, matching the
            Header badge exactly — never distinct lines.
          */}
          <p className="mt-2 text-sm text-text-muted">{t('page.summary', { count: totalQuantity })}</p>

          <ul className="mt-6">
            {lines.map((line) => (
              // The divider lives here, on the list item, so the final row
              // carries none — and `CartItemRow` needs no `isLast` prop.
              <li key={line.slug} className="border-b border-border-hairline last:border-b-0">
                <CartItemRow
                  line={line}
                  onIncrement={handleIncrement}
                  onDecrement={handleDecrement}
                  onRemove={handleRemove}
                />
              </li>
            ))}
          </ul>

          {/*
            🔴 Interim subtotal (DEC-045 as extended by the approved Slice 7b
            plan). The value is the reducer's own `subtotalMinor` selector,
            rendered through minorToPriceString -> PriceBlock -> formatPrice,
            so there is exactly ONE money calculation on this page and no
            float arithmetic anywhere. CartPage never re-derives it from the
            rows. The label states plainly that these are the prices captured
            at add time; a server-authoritative total supersedes it the moment
            a cart API exists. No shipping, tax, discount, threshold, grand
            total or checkout — none of them has an approved value yet.
          */}
          <p className="mt-6 flex flex-wrap items-baseline gap-2 border-t border-border-hairline pt-4">
            <span className="text-sm text-text-muted">{t('subtotal.label')}</span>
            <PriceBlock price={minorToPriceString(subtotalMinor)} />
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
    </div>
  )
}
