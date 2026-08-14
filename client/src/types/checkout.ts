/**
 * MILESTONE-008 Checkpoint F2a — the checkout quote, as the browser sees it.
 *
 * 🔴 EVERY FIGURE HERE IS THE SERVER'S. The client displays `basis`, the
 * shipping cost and `totalAmount`; it never adds them up, and it never
 * recomputes one from the others. §3.4, and the same rule that removed the
 * browser-memory cart at MILESTONE-007 Checkpoint G.
 *
 * Mirrors `server/src/lib/checkoutService.ts`'s `CheckoutQuote`. The client
 * cannot import across the package boundary, so `checkoutApi.test.ts` reads
 * the server's `DELIVERY_METHODS` off disk and fails if the two lists drift —
 * the same guard `orderStatus.test.ts` uses.
 */

export type DeliveryMethodName = 'self_pickup' | 'courier' | 'pickup_point'

export const DELIVERY_METHOD_NAMES: readonly DeliveryMethodName[] = [
  'self_pickup',
  'courier',
  'pickup_point',
]

/** §8.7 — self pickup is ready within N days; the other two arrive in a range. */
export type DeliveryEstimate =
  | { kind: 'ready_within'; businessDays: number }
  | { kind: 'delivered_between'; minBusinessDays: number; maxBusinessDays: number }

export type CheckoutShipping = {
  cost: string
  isFree: boolean
  threshold: string
  basis: string
  hasShippableLines: boolean
  noDeliveryRequired: boolean
}

export type CheckoutQuoteLine = {
  id: string
  slug: string
  nameHe: string
  nameEn: string
  brandName: string
  quantity: number
  unitPrice: string
  lineTotal: string
}

export type CheckoutQuote = {
  lines: readonly CheckoutQuoteLine[]
  /** The purchasable total the free-shipping threshold is measured on. */
  basis: string
  shipping: CheckoutShipping
  /** 🔴 basis + shipping, server-computed. What the shopper confirms. */
  totalAmount: string
  deliveryMethod: DeliveryMethodName
  estimate: DeliveryEstimate
  /**
   * 🔴 DEC-060 — OPAQUE, and it must go back to `/checkout/pay` UNCHANGED.
   * It digests the exact figures above; `/pay` re-derives it from live data
   * and halts if anything moved. A client that regenerates, trims or "cleans"
   * this value defeats the gate rather than passing it.
   */
  fingerprint: string
}

/**
 * 🔴 QUOTED FROM `server/src/lib/purchasability.ts`, NOT INVENTED HERE.
 *
 * ⚠️ THIS LIST WAS WRONG ON ARRIVAL and shipped in `7e0b1a8`: it read
 * `INACTIVE | OUT_OF_STOCK | SHORT_STOCK`, pattern-matched from `cartApi.ts`'s
 * merge report rather than from the module that feeds this route. The
 * transport filtered every blocked line whose reason it did not recognise, so
 * a withdrawn or sold-out line arrived as an EMPTY list and the screen
 * rendered "these products cannot be bought right now" above nothing —
 * ISSUE-080's dead end, reproduced one screen later by the very code whose
 * comments claim to close it. `SHORT_STOCK` matched by coincidence, which is
 * why nothing looked broken.
 *
 * The list is guarded against the server by a `?raw` read in
 * `checkoutApi.test.ts`, exactly as `DELIVERY_METHOD_NAMES` is. The lesson is
 * that a drift guard covers the list it names and nothing else.
 */
export const UNPURCHASABLE_REASONS = ['WITHDRAWN', 'SOLD_OUT', 'SHORT_STOCK'] as const

export type UnpurchasableReason = (typeof UNPURCHASABLE_REASONS)[number]

/** A line the order cannot include, named so the screen can say WHICH. */
export type CheckoutBlockedLine = {
  lineId: string
  slug: string
  why: UnpurchasableReason
  /** 🔴 0 unless SHORT_STOCK — the server says so explicitly. */
  available: number
}

/**
 * 🔴 THE FAILURES ARE NOT ONE "ERROR". REQ-F-042's halt (`blocked`) is a
 * different screen from an empty cart, which is different again from being
 * signed out mid-checkout. Collapsing them would produce the dead end
 * ISSUE-080 recorded on the cart page: a banner that says something is wrong
 * without saying what to do about it.
 */
export type CheckoutQuoteFailure =
  | { kind: 'blocked'; lines: readonly CheckoutBlockedLine[] }
  | { kind: 'emptyCart' }
  | { kind: 'unauthenticated' }
  /**
   * 🔴 REQ-F-031 / DEC-067 — the account exists and is signed in, but has not
   * verified its email, so it may not COMPLETE an order. Its own kind because
   * the shopper's next action is neither "sign in" nor "retry": it is to open
   * the verification mail.
   */
  | { kind: 'emailNotVerified' }
  /**
   * 🔴 ITS OWN KIND, because the generic failure's UI is a Retry button and
   * retrying a 429 immediately re-hits the limiter. The one branch closes the
   * loop.
   */
  | { kind: 'rateLimited' }
  | { kind: 'server' }
  | { kind: 'offline' }

export type CheckoutQuoteResult =
  | { ok: true; quote: CheckoutQuote }
  | { ok: false; failure: CheckoutQuoteFailure }

/**
 * MILESTONE-008 Checkpoint F2c — what `POST /api/checkout/pay` can answer.
 *
 * 🔴 ELEVEN OUTCOMES, AND THE SPLIT IS THE WHOLE DESIGN. §8.12 records ONE
 * defect shape appearing FOUR times in Checkpoint D: *a later step failed and
 * the shopper was told the order failed — for an order that EXISTS*. Every
 * one of those was a distinct server answer flattened into "it didn't work".
 *
 * The two that must never be flattened:
 *
 *   `succeeded` with `replayed: true` — the order was already placed and this
 *   was a retry. It is a CONFIRMATION, not an error.
 *   `orderCancelled` — an order exists under this key and was cancelled. It
 *   carries the order number precisely so the screen can say WHICH.
 */
export type PaymentSuccess = {
  orderId: string
  orderNumber: string
  totalAmount: string
  shippingCost: string
  /** True when this key had already produced an order — a retry, not a new buy. */
  replayed: boolean
  estimate: DeliveryEstimate
  /**
   * Present only on the step-0 replay path, where the server reports the
   * STORED status. Absent on a fresh order, which is `pending_payment` moving
   * to `paid` inside the same request.
   */
  status?: string
}

export type PaymentFailure =
  /** 402 — REQ-F-045: no order, stock untouched, cart preserved. */
  | { kind: 'declined' }
  /**
   * 409 CHECKOUT_CHANGED — DEC-060's gate refusing. 🔴 IT CARRIES THE NEW
   * QUOTE: REQ-F-042 requires the updated figures to be shown and confirmed
   * again, so the screen re-renders rather than guessing what moved.
   */
  | { kind: 'changed'; quote: CheckoutQuote }
  /** 409 — an order exists under this key and was CANCELLED. Not a failure to buy. */
  | { kind: 'orderCancelled'; orderNumber: string }
  | { kind: 'blocked'; lines: readonly CheckoutBlockedLine[] }
  | { kind: 'emptyCart' }
  /** 400 ADDRESS_REQUIRED / ADDRESS_NOT_ALLOWED — a malformed payload, not a halt. */
  | { kind: 'addressRejected'; reason: 'ADDRESS_REQUIRED' | 'ADDRESS_NOT_ALLOWED' }
  /**
   * 400 for FINGERPRINT_REQUIRED, INVALID_IDEMPOTENCY_KEY,
   * INVALID_PAYMENT_OUTCOME, INVALID_DELIVERY_METHOD. 🔴 A BUG IN THIS CLIENT,
   * not something a shopper can act on — the screen says so rather than
   * inventing advice.
   */
  | { kind: 'invalidRequest'; code: string }
  | { kind: 'emailNotVerified' }
  | { kind: 'unauthenticated' }
  | { kind: 'rateLimited' }
  | { kind: 'server' }
  | { kind: 'offline' }

export type PaymentResult =
  | { ok: true; order: PaymentSuccess }
  | { ok: false; failure: PaymentFailure }
