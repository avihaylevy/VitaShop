/**
 * MILESTONE-007 Checkpoint C — the quantity clamp.
 *
 * 🔴 §3.4: the client may send anything; the SERVER decides what the line
 * becomes. Nothing here trusts the request.
 *
 * §7.9 C2 (user, 2026-08-12): a per-line cap of **10**, clamped FURTHER by
 * available stock. The effective maximum is `min(10, stock)`.
 *
 * 🔴 THE CART CLAMPS, IT DOES NOT RESERVE. Stock is decremented atomically at
 * order creation (INV-01), which belongs to MILESTONE-008. Nothing in this
 * module or its callers may write `Product.stock`.
 */

/** §7.9 C2. Stock alone would let one guest cart a 3-unit product's entire supply. */
export const CART_LINE_MAX = 10

export type QuantityRejection =
  | 'NOT_AN_INTEGER'
  | 'NOT_POSITIVE'
  | 'OUT_OF_STOCK'
  /** 🔴 A stock value that is not a whole number. See `clampCartQuantity`. */
  | 'INVALID_STOCK'

export type ClampResult =
  | { ok: true; quantity: number; clampedByCap: boolean; clampedByStock: boolean }
  | { ok: false; reason: QuantityRejection }

/**
 * Validates a client-supplied quantity. 🔴 Rejects rather than coerces:
 * `"3"`, `3.5`, `0` and `-1` are all caller errors, and silently turning them
 * into 3 or 1 would hide a broken client.
 */
export function parseRequestedQuantity(raw: unknown): number | QuantityRejection {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 'NOT_AN_INTEGER'
  if (!Number.isInteger(raw)) return 'NOT_AN_INTEGER'
  if (raw <= 0) return 'NOT_POSITIVE'
  return raw
}

/**
 * Applies BOTH bounds and reports which one bound.
 *
 * 🔴 Reporting `clampedByCap` / `clampedByStock` separately is not decoration:
 * a response that silently returns a smaller number than was asked for is a
 * lie the UI cannot render, and a one-sided clamp is the failure shape this
 * project has eight recorded instances of. The flags are what make the two
 * bounds independently testable.
 */
export function clampCartQuantity(requested: number, stock: number): ClampResult {
  // 🔴 THIS MODULE'S PREMISE IS THAT IT TRUSTS NOTHING — and it trusted `stock`.
  // `NaN <= 0` is FALSE, so a NaN stock fell straight through the guard below,
  // `Math.min(10, NaN)` returned NaN, and the caller got
  // `{ ok: true, quantity: NaN }` — which serialises to `null` and reaches the
  // client as a cart line with no quantity. No throw, success-shaped, exactly
  // the failure family this project keeps recording. Same class as the
  // empty-string guard in `guestSession.ts`.
  if (!Number.isInteger(stock)) return { ok: false, reason: 'INVALID_STOCK' }
  if (stock <= 0) return { ok: false, reason: 'OUT_OF_STOCK' }

  const effectiveMax = Math.min(CART_LINE_MAX, stock)
  const quantity = Math.min(requested, effectiveMax)

  return {
    ok: true,
    quantity,
    clampedByCap: requested > CART_LINE_MAX,
    clampedByStock: requested > stock,
  }
}

/**
 * Adding the same product twice SUMS, and 🔴 THE SUM IS CLAMPED — a cap
 * enforced per-request rather than per-line is not a cap. Ten requests of one
 * unit each must not produce a line of ten when stock is three.
 */
export function clampAddition(existing: number, requested: number, stock: number): ClampResult {
  return clampCartQuantity(existing + requested, stock)
}
