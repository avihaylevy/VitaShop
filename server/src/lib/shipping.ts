/**
 * DEC-058 — shipping. ₪30 flat, FREE when the qualifying total reaches ₪249.
 *
 * 🔴 ONE DEFINITION OF THE TWO NUMBERS, and this is it. DEC-058 says
 * MILESTONE-008's order totals inherit them and that checkout must not
 * re-derive them, or the cart and the order can disagree about money. Import
 * from here; never retype `30` or `249` anywhere else.
 *
 * 🔴 §3.4 — THIS RUNS SERVER-SIDE ONLY. The client renders what it is told and
 * computes no money of its own. That is why the DTO carries the basis, the
 * threshold and the remaining amount as finished strings rather than leaving
 * the browser to subtract two numbers.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *
 * 🔴 THE QUALIFYING TOTAL IS THE **ACTIVE** LINES, NOT THE DISPLAYED SUBTOTAL.
 * Decided by the user 2026-08-12, and the reasoning is recorded because the
 * literal reading of DEC-058 ("the subtotal") is the tempting wrong one:
 *
 *   C3 keeps a WITHDRAWN line visible, struck through, and blocking checkout.
 *   It therefore contributes to the DISPLAYED subtotal. If it also counted
 *   toward free shipping, a cart of ₪200 real goods plus a ₪60 withdrawn line
 *   would promise FREE SHIPPING on an order that cannot be placed — and the
 *   promise REVERSES: the shopper removes the blocked line because the cart
 *   demands it, ₪260 becomes ₪200, and free becomes ₪30. They did the only
 *   thing available to them and the price went up.
 *
 *   🔴 Free shipping is a promise about an ORDER. A cart holding a withdrawn
 *   line cannot become one, so the figure must describe the order that can
 *   actually be placed.
 *
 * ⚠️ THE EMPTY CART FOLLOWS FROM THE SAME RULE and is not a separate case: no
 * lines means nothing to ship, so there is no charge. `subtotal < 249 -> ₪30`
 * only reads as correct if the rule is about NUMBERS; it is about DELIVERIES.
 *
 * ⚠️ NOT DECIDED, and deliberately not inferred here: VAT, and whether ₪30
 * varies by delivery method or region. `TBD` — see ISSUE-001/DEC-058. Nothing
 * in this module assumes an answer to either.
 */

/** Integer agorot throughout — the ₪249 boundary must not ride on a float. */
export const SHIPPING_FLAT_RATE_AGOROT = 3_000
export const FREE_SHIPPING_THRESHOLD_AGOROT = 24_900

export type ShippingDto = {
  /**
   * 🔴 The total the threshold is measured against — ACTIVE lines only, which
   * is why it can differ from `subtotal`. The UI must SAY so: two unexplained
   * numbers on one screen read as a bug.
   */
  basis: string
  /** '30.00', or '0.00' when free or when there is nothing to ship. */
  cost: string
  isFree: boolean
  /** Exposed so the UI states the rule without hardcoding the number. */
  threshold: string
  /** How much more qualifying spend earns free shipping. '0.00' when moot. */
  remainingForFree: string
  /**
   * 🔴 False for an empty cart AND for a cart whose every line is withdrawn.
   * The UI shows no shipping figure at all in that state — not ₪0, not ₪30.
   */
  hasShippableLines: boolean
}

/** Money string ('94.90') to integer agorot, without a float round-trip error. */
export function toAgorot(money: string): number {
  return Math.round(Number(money) * 100)
}

function toMoney(agorot: number): string {
  return (agorot / 100).toFixed(2)
}

/**
 * @param basisAgorot total of the ACTIVE lines
 * @param hasShippableLines whether any active line exists at all
 */
export function computeShipping(basisAgorot: number, hasShippableLines: boolean): ShippingDto {
  const threshold = toMoney(FREE_SHIPPING_THRESHOLD_AGOROT)

  // Nothing to ship: no charge, and no free-shipping promise either — there is
  // no order for one to be about.
  if (!hasShippableLines) {
    return {
      basis: '0.00',
      cost: '0.00',
      isFree: false,
      threshold,
      remainingForFree: '0.00',
      hasShippableLines: false,
    }
  }

  // 🔴 `>=`. DEC-058 says "₪249 or more", so EXACTLY ₪249 is free. An off-by-one
  // here charges ₪30 to the shopper who hit the number precisely.
  const isFree = basisAgorot >= FREE_SHIPPING_THRESHOLD_AGOROT

  return {
    basis: toMoney(basisAgorot),
    cost: isFree ? '0.00' : toMoney(SHIPPING_FLAT_RATE_AGOROT),
    isFree,
    threshold,
    remainingForFree: isFree ? '0.00' : toMoney(FREE_SHIPPING_THRESHOLD_AGOROT - basisAgorot),
    hasShippableLines: true,
  }
}
