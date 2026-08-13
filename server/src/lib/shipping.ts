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
 * 🔴 THE QUALIFYING TOTAL IS THE **PURCHASABLE** LINES, NOT THE DISPLAYED
 * SUBTOTAL. Decided by the user 2026-08-12, and the reasoning is recorded
 * because the literal reading of DEC-058 ("the subtotal") is the tempting wrong
 * one:
 *
 * ⚠️ "PURCHASABLE" WIDENED TWICE, and the widening is the lesson. It began as
 * "active", which let a SOLD-OUT line buy free shipping (ISSUE-076); it then
 * became "active and in stock", which still let a cart of 3 against a stock of
 * 1 do the same. It is now **active AND stocked to the quantity asked for** —
 * the rule `orderService` actually enforces. 🔴 A cart rule that merely
 * RESEMBLES checkout's promises something checkout will refuse.
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
   * 🔴 The total the threshold is measured against — PURCHASABLE lines only
   * (active AND stocked to the quantity asked for), which
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
   * 🔴 False for an empty cart AND for a cart with no PURCHASABLE line — which
   * since 2026-08-13 means inactive **or** short of the quantity asked for, not
   * merely withdrawn. The UI shows no shipping figure at all in that state —
   * not ₪0, not ₪30.
   */
  hasShippableLines: boolean
  /**
   * 🔴 TRUE ONLY FOR SELF PICKUP — nothing is being delivered, so the
   * free-shipping threshold is MOOT rather than unmet.
   *
   * ⚠️ IT EXISTS TO MAKE A RENDERING BUG IMPOSSIBLE RATHER THAN UNLIKELY. The
   * cart renders "add ₪X more for free shipping" whenever the basis equals the
   * subtotal and `isFree` is false — and self pickup returns exactly that, with
   * `remainingForFree: '0.00'`, so the screen would read "add ₪0.00 more to get
   * free shipping". It is unreachable today only because the cart hardcodes the
   * courier default, and it goes live the moment checkout feeds a real method
   * into the same renderer. A flag the UI can branch on is safe by
   * construction; a coincidence is not.
   */
  noDeliveryRequired: boolean
}

/** Money string ('94.90') to integer agorot, without a float round-trip error. */
export function toAgorot(money: string): number {
  return Math.round(Number(money) * 100)
}

function toMoney(agorot: number): string {
  return (agorot / 100).toFixed(2)
}

/**
 * 🔴 DEC-058 AS AMENDED 2026-08-12 — the delivery method changes the answer.
 *
 * REQ-F-040 §4.5.1 mandates three methods and DEC-058 set one flat rate, which
 * is a spec-vs-decision conflict rather than a gap. The user's answer:
 *
 *   self pickup     ₪0 ALWAYS — nothing is shipped, so there is nothing to
 *                   charge for, and the ₪249 threshold is MOOT rather than
 *                   unmet. It is the same reasoning that makes an empty cart
 *                   ₪0: the rule is about DELIVERIES, not about numbers.
 *   courier         ₪30, free when the basis reaches ₪249
 *   pickup point    ₪30, free when the basis reaches ₪249
 *
 * ⚠️ A PICKUP POINT IS STILL A DELIVERY — goods are transported to a locker or
 * a shop. Only SELF pickup is free. Two values, not three; the split is
 * delivery-versus-no-delivery, not a rate card.
 */
export type DeliveryMethodName = 'self_pickup' | 'courier' | 'pickup_point'

/**
 * The same three, as values — so a caller can CHECK a client-supplied string
 * rather than trusting it. A type alone is erased at runtime.
 */
export const DELIVERY_METHODS: readonly DeliveryMethodName[] = [
  'self_pickup',
  'courier',
  'pickup_point',
]

/**
 * @param basisAgorot total of the PURCHASABLE lines
 * @param hasShippableLines whether any purchasable line exists at all
 * @param method the chosen delivery method. ⚠️ Defaults to `courier` because
 *   the CART has no method yet — one is chosen at checkout — and the cart page
 *   must keep showing the ₪30 it shows today. Checkout ALWAYS passes it
 *   explicitly; the default is for the pre-checkout surfaces only.
 */
export function computeShipping(
  basisAgorot: number,
  hasShippableLines: boolean,
  method: DeliveryMethodName = 'courier',
): ShippingDto {
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
      // 🔴 STILL DERIVED FROM THE METHOD, even here. Hardcoding `false` made
      // the flag LIE in the one state it was added to describe: a self-pickup
      // order whose last line just became unpurchasable would report that
      // delivery is required for an order that has none.
      noDeliveryRequired: method === 'self_pickup',
    }
  }

  // 🔴 SELF PICKUP: ₪0, and `isFree` is FALSE. Free shipping is a PROMOTION
  // earned by spending ₪249; a pickup order has no delivery to discount, so
  // reporting it as "free shipping" would tell the shopper they earned
  // something they did not. The cost is zero because nothing is shipped.
  // ⚠️ `remainingForFree` is 0.00 for the same reason — the threshold is MOOT
  // here, and offering "spend ₪X more for free shipping" to someone collecting
  // their own order is an offer that means nothing.
  if (method === 'self_pickup') {
    return {
      basis: toMoney(basisAgorot),
      cost: '0.00',
      isFree: false,
      threshold,
      remainingForFree: '0.00',
      hasShippableLines: true,
      noDeliveryRequired: true,
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
    noDeliveryRequired: false,
  }
}
