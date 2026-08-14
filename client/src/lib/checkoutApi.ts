import { getApiBaseUrl } from './apiBaseUrl.js'
import {
  DELIVERY_METHOD_NAMES,
  type CheckoutBlockedLine,
  type CheckoutQuote,
  type CheckoutQuoteResult,
  type DeliveryEstimate,
  type DeliveryMethodName,
} from '../types/checkout.js'

/**
 * MILESTONE-008 Checkpoint F2a — the checkout transport.
 *
 * 🔴 `credentials: 'include'`, like `cartApi.ts`: checkout is
 * AUTHENTICATED-ONLY (§8.2) and the session lives in an HttpOnly cookie that
 * is cross-origin in development. Without it every call looks anonymous and
 * the screen would report "sign in" to a shopper who already has.
 *
 * 🔴 THE RESPONSE IS VALIDATED, NOT CAST — `cartApi.ts`'s precedent, and the
 * reason is stronger here: this payload is the figure the shopper is about to
 * be charged, plus the DEC-060 fingerprint that gates the charge. A malformed
 * response is a FAILURE, never a half-rendered checkout.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Canonical two-decimal money — the same predicate the cart transport uses. */
function isMoney(value: unknown): value is string {
  return typeof value === 'string' && /^\d+\.\d{2}$/.test(value)
}

export function isDeliveryMethodName(value: unknown): value is DeliveryMethodName {
  return typeof value === 'string' && (DELIVERY_METHOD_NAMES as readonly string[]).includes(value)
}

function isEstimate(value: unknown): value is DeliveryEstimate {
  if (!isPlainObject(value)) return false
  if (value.kind === 'ready_within') return typeof value.businessDays === 'number'
  if (value.kind === 'delivered_between') {
    return typeof value.minBusinessDays === 'number' && typeof value.maxBusinessDays === 'number'
  }
  return false
}

function isQuote(value: unknown): value is CheckoutQuote {
  if (!isPlainObject(value)) return false
  if (!Array.isArray(value.lines)) return false
  if (!isMoney(value.basis) || !isMoney(value.totalAmount)) return false
  if (!isDeliveryMethodName(value.deliveryMethod)) return false
  if (!isEstimate(value.estimate)) return false
  // 🔴 A quote without a fingerprint is unusable: `/pay` refuses anything that
  // does not carry one back, so rendering such a quote would present a
  // confirm button that can only fail.
  if (typeof value.fingerprint !== 'string' || value.fingerprint.length === 0) return false
  const shipping = value.shipping
  if (!isPlainObject(shipping)) return false
  return (
    isMoney(shipping.cost) &&
    isMoney(shipping.threshold) &&
    isMoney(shipping.basis) &&
    typeof shipping.isFree === 'boolean' &&
    typeof shipping.hasShippableLines === 'boolean' &&
    typeof shipping.noDeliveryRequired === 'boolean'
  )
}

function blockedLinesOf(body: unknown): readonly CheckoutBlockedLine[] {
  if (!isPlainObject(body) || !isPlainObject(body.error) || !Array.isArray(body.error.lines)) {
    return []
  }
  return body.error.lines.filter((line): line is CheckoutBlockedLine => {
    if (!isPlainObject(line)) return false
    return (
      typeof line.lineId === 'string' &&
      typeof line.slug === 'string' &&
      (line.why === 'INACTIVE' || line.why === 'OUT_OF_STOCK' || line.why === 'SHORT_STOCK') &&
      typeof line.available === 'number'
    )
  })
}

function errorCodeOf(body: unknown): string | undefined {
  if (!isPlainObject(body) || !isPlainObject(body.error)) return undefined
  return typeof body.error.code === 'string' ? body.error.code : undefined
}

/**
 * REQ-F-042's re-check. It creates nothing, so the screen may call it whenever
 * the shopper changes the delivery method.
 */
export async function requestCheckoutQuote(
  deliveryMethod: DeliveryMethodName,
): Promise<CheckoutQuoteResult> {
  const base = getApiBaseUrl()
  if (!base.ok) return { ok: false, failure: { kind: 'offline' } }

  let status: number
  let body: unknown
  try {
    const response = await fetch(`${base.value}/api/checkout/validate`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deliveryMethod }),
    })
    status = response.status
    try {
      body = await response.json()
    } catch {
      body = null
    }
  } catch {
    // 🔴 A network failure is NOT a server error and must not read as one: the
    // shopper's next action is different (check the connection, retry) and
    // nothing about their cart is known to be wrong.
    return { ok: false, failure: { kind: 'offline' } }
  }

  if (status === 200) {
    return isQuote(body) ? { ok: true, quote: body } : { ok: false, failure: { kind: 'server' } }
  }

  // 🔴 401 IS ITS OWN OUTCOME. Checkout is authenticated-only, and a session
  // that expired mid-checkout must send the shopper to sign in — not show them
  // a generic failure beside a basket they can still see.
  if (status === 401) return { ok: false, failure: { kind: 'unauthenticated' } }

  const code = errorCodeOf(body)
  // 409, never 400, for both of these — the request was well formed and the
  // WORLD moved. The server's own comment says so; the client agrees rather
  // than inventing a second opinion.
  if (code === 'UNPURCHASABLE_LINE') {
    return { ok: false, failure: { kind: 'blocked', lines: blockedLinesOf(body) } }
  }
  if (code === 'EMPTY_CART') return { ok: false, failure: { kind: 'emptyCart' } }

  // INVALID_DELIVERY_METHOD lands here deliberately. The screen only ever
  // sends one of the three, so reaching it means this build and the server
  // disagree about the list — a bug to report, not a state to explain to a
  // shopper.
  return { ok: false, failure: { kind: 'server' } }
}
