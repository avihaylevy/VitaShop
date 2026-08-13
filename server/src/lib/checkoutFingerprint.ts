import { createHash } from 'node:crypto'
import type { DeliveryMethodName } from './shipping.js'

/**
 * REQ-F-042's confirmation gate — the fingerprint the token is made of.
 *
 * ```
 * Decided by the user 2026-08-13, from three options: the SERVER-ISSUED TOKEN.
 * ```
 *
 * `/checkout/validate` computes the figures, fingerprints them, and returns
 * both. `/checkout/pay` takes the fingerprint back, RE-DERIVES it from live
 * data, and refuses if the two differ. Anything that moved in between — a
 * price, a stock level that changed a line, the cart itself — changes the
 * digest, so the flow halts and the shopper re-confirms.
 *
 * 🔴 WHY THIS SHAPE AND NOT AN ECHOED PRICE. The rejected alternative had the
 * client send back the prices it displayed. That puts money in a client request
 * body, and §3.4 makes the browser not a source of truth. Here the client holds
 * an opaque digest it cannot read, cannot decompose, and cannot usefully alter.
 *
 * ⚠️ IT IS NOT SIGNED, AND THAT IS DELIBERATE RATHER THAN AN OVERSIGHT. An HMAC
 * would prove the server issued the token; it would not add a guarantee this
 * flow needs. The token is a STATE ASSERTION, not a capability: `/pay` recomputes
 * the digest from the database and compares, so a forged token is only accepted
 * when it happens to equal the CURRENT state — which is to say, when nothing
 * has changed and there was nothing to halt for. A token can therefore only
 * ever assert the truth, and a secret protecting it would protect nothing.
 *
 * 🔴 §8.4 says the guarantee lives in `/pay`'s OWN re-check — *"`/pay`
 * re-verifies independently, so skipping `/validate` cannot bypass it"*
 * (TEST-042 Scenario C). That is the contract this module is built to, and it
 * holds without a secret: the invariant is *you cannot pay for a state that is
 * not the current one*, not *you must have called `/validate`*.
 *
 * ⚠️ It carries NO EXPIRY. Time is not what makes a confirmation stale — a
 * CHANGE is, and a change is exactly what the digest detects. A ten-minute-old
 * token over an unchanged basket is still describing the truth, and expiring it
 * would halt a shopper to show them identical figures.
 */

export type CheckoutLineState = {
  /** The CART LINE's id, so a swap of equal price and quantity still differs. */
  lineId: string
  productId: string
  quantity: number
  /** Canonical two-decimal string, straight from the product row. */
  unitPrice: string
}

export type CheckoutState = {
  /** 🔴 IN THE DIGEST, so one shopper's token cannot confirm another's basket. */
  userId: string
  deliveryMethod: DeliveryMethodName
  shippingCost: string
  totalAmount: string
  lines: readonly CheckoutLineState[]
}

/**
 * 🔴 LENGTH-PREFIXED, NOT DELIMITER-JOINED, and this is the part that is easy to
 * get wrong quietly.
 *
 * Joining fields with a separator lets one field absorb the next: quantity `1`
 * with price `12.00` and quantity `11` with price `2.00` both flatten to
 * `…112.00…`. Two different baskets, two different totals, one digest — and the
 * gate waves the second through carrying the first one's confirmation. Escaping
 * the delimiter fixes that case and leaves the reader to prove no OTHER value
 * can contain it.
 *
 * Prefixing each value with its byte length removes the question instead of
 * answering it: `3:abc` can only ever be parsed one way, whatever `abc` holds.
 * No value can impersonate a boundary, because boundaries are counted rather
 * than looked for.
 */
function field(value: string): string {
  return `${Buffer.byteLength(value, 'utf8')}:${value}`
}

/**
 * 🔴 SORTED BY `lineId`, and the sort prevents a FALSE halt rather than a missed
 * one. The lines arrive in whatever order the query returned, and two reads of
 * an unchanged cart can differ in order alone. Without a canonical order that
 * stops a checkout where nothing moved — the shopper is halted, told something
 * changed, shown the same figures, and given no way forward. A missed change is
 * a bug; a halt nobody can clear is a dead end.
 */
function canonicalLines(lines: readonly CheckoutLineState[]): string {
  return [...lines]
    .sort((a, b) => (a.lineId < b.lineId ? -1 : a.lineId > b.lineId ? 1 : 0))
    .map((line) =>
      [
        field(line.lineId),
        field(line.productId),
        field(String(line.quantity)),
        field(line.unitPrice),
      ].join(''),
    )
    .join('')
}

/**
 * A lowercase hex sha-256 digest of the state.
 *
 * ⚠️ A DIGEST, so nothing readable travels to the browser. A token that embedded
 * the figures would be a second, client-held copy of the money — the very thing
 * choosing this mechanism over an echoed price was meant to avoid.
 */
export function checkoutFingerprint(state: CheckoutState): string {
  const payload = [
    field(state.userId),
    field(state.deliveryMethod),
    field(state.shippingCost),
    field(state.totalAmount),
    field(String(state.lines.length)),
    canonicalLines(state.lines),
  ].join('')

  return createHash('sha256').update(payload, 'utf8').digest('hex')
}
