import type { DeliveryMethodName } from './shipping.js'

/**
 * DEC-059 answer 5 — the estimated delivery time, per method.
 *
 * 🔴 STATIC, NEVER COMPUTED. The user's answer is explicit: a fixed range per
 * delivery method. Nothing here reads a calendar, counts holidays, or looks at
 * stock. An estimate that LOOKS calculated is read as a commitment, and this
 * project has no carrier integration to back one.
 *
 * 🔴 ONE DEFINITION, BESIDE `shipping.ts` AND FOR THE SAME REASON. DEC-058
 * forbids retyping ₪30 and ₪249 anywhere else; answer 5 imposes the same rule
 * on these numbers. The checkout screen, the confirmation summary and INV-04's
 * email all quote one order's promise, and three copies of "3–5" is three
 * chances for them to disagree about what the shopper was told.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *
 * 🔴 A VALUE, NOT A SENTENCE, and that is not a stylistic choice. INV-04's
 * email is HEBREW-ONLY (DEC-054 / clause A11-SERVER) while the UI is bilingual,
 * so a module returning `'3–5 ימי עסקים'` would force the English screen to
 * re-derive the numbers from somewhere — which is exactly the drift
 * `purchasability.ts` was written to make unrepresentable. Callers render;
 * this module decides.
 *
 * ⚠️ TWO SHAPES, NOT ONE RANGE, because the two promises are different
 * sentences. Self pickup is *"ready within 2 business days"* — an order waiting
 * to be COLLECTED. Courier and pickup point are *"3–5 business days"* — a
 * delivery ARRIVING. Flattening self pickup into a range would have the client
 * render "0–2 business days", a phrasing nobody decided, and would lose the
 * verb the copy needs in both languages.
 */

export type DeliveryEstimate =
  /** Self pickup: the order is ready to collect within N business days. */
  | { readonly kind: 'ready_within'; readonly businessDays: number }
  /** Courier and pickup point: the delivery arrives between MIN and MAX. */
  | {
      readonly kind: 'delivered_between'
      readonly minBusinessDays: number
      readonly maxBusinessDays: number
    }

/**
 * 🔴 FROZEN, and the freeze is load-bearing rather than tidy. These objects are
 * shared — every call for a given method returns the same instance — so a
 * caller that mutated one would silently change the promise made to every later
 * shopper, with no write to point at and nothing in a diff to notice.
 */
const READY_WITHIN_TWO: DeliveryEstimate = Object.freeze({
  kind: 'ready_within',
  businessDays: 2,
} as const)

const THREE_TO_FIVE: DeliveryEstimate = Object.freeze({
  kind: 'delivered_between',
  minBusinessDays: 3,
  maxBusinessDays: 5,
} as const)

/**
 * ⚠️ A `Record` keyed by the method, NOT a switch with a default. The type makes
 * a missing method a COMPILE error; a default arm would answer a method nobody
 * wrote an estimate for by quietly picking one of the others — and the wrong
 * delivery promise is the kind of defect that reaches a shopper before it
 * reaches a test.
 *
 * 🔴 A PICKUP POINT IS A DELIVERY. It shares the courier range deliberately —
 * goods are transported to a locker or a shop. `shipping.ts` splits the three
 * methods the same way, delivery versus no delivery, and the two modules must
 * not disagree about which is which.
 */
const ESTIMATES: Readonly<Record<DeliveryMethodName, DeliveryEstimate>> = Object.freeze({
  self_pickup: READY_WITHIN_TWO,
  courier: THREE_TO_FIVE,
  pickup_point: THREE_TO_FIVE,
})

export function deliveryEstimate(method: DeliveryMethodName): DeliveryEstimate {
  return ESTIMATES[method]
}
