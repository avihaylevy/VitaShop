import { getApiBaseUrl } from './apiBaseUrl.js'
import {
  DELIVERY_METHOD_NAMES,
  UNPURCHASABLE_REASONS,
  type CheckoutBlockedLine,
  type CheckoutQuote,
  type CheckoutQuoteLine,
  type CheckoutQuoteResult,
  type PaymentResult,
  type PaymentSuccess,
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

/**
 * 🔴 EVERY FIELD THE SUMMARY RENDERS. `Array.isArray` alone was not validation:
 * a line missing `lineTotal` reached `PriceBlock`, `Number(undefined)` produced
 * NaN, and the shopper saw ₪NaN in the figure they were about to be charged. A
 * line missing `id` produced duplicate React keys. `cartApi.ts`'s `isCartLine`
 * set this precedent for exactly this reason.
 */
function isQuoteLine(value: unknown): value is CheckoutQuoteLine {
  if (!isPlainObject(value)) return false
  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.slug === 'string' &&
    typeof value.nameHe === 'string' &&
    typeof value.nameEn === 'string' &&
    typeof value.brandName === 'string' &&
    typeof value.quantity === 'number' &&
    Number.isInteger(value.quantity) &&
    value.quantity > 0 &&
    isMoney(value.unitPrice) &&
    isMoney(value.lineTotal)
  )
}

function isQuote(value: unknown): value is CheckoutQuote {
  if (!isPlainObject(value)) return false
  if (!Array.isArray(value.lines) || !value.lines.every(isQuoteLine)) return false
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
      // 🔴 The server's own names — see UNPURCHASABLE_REASONS. Hand-writing
      // this union is what dropped WITHDRAWN and SOLD_OUT on the floor.
      (UNPURCHASABLE_REASONS as readonly unknown[]).includes(line.why) &&
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

  // 🔴 429 IS NOT A SERVER ERROR. The generic failure's UI is a Retry button,
  // and retrying a rate limit immediately re-hits it — a loop the shopper
  // drives by doing exactly what the screen asks.
  if (status === 429) return { ok: false, failure: { kind: 'rateLimited' } }

  const code = errorCodeOf(body)

  // 🔴 403 EMAIL_NOT_VERIFIED — DEC-067's gate. Folding it into the generic
  // server failure would show a Retry button for a state no retry can clear.
  //
  // ⚠️ THE STATUS IS CHECKED TOO, unlike the first version. `requireVerified
  // Shopper` is the only emitter and always pairs the code with 403, so there
  // was no reachable misbehaviour — but the comment said "403" while the code
  // agreed to trust any status that carried the string, which is the kind of
  // gap that stops being theoretical the day a second emitter appears.
  if (status === 403 && code === 'EMAIL_NOT_VERIFIED') {
    return { ok: false, failure: { kind: 'emailNotVerified' } }
  }
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

/** The success payload, validated — it is the receipt for money. */
function isPaymentSuccess(value: unknown): value is PaymentSuccess {
  if (!isPlainObject(value)) return false
  return (
    typeof value.orderId === 'string' &&
    // 🔴 THE ORDER NUMBER IS THE ONE THING THE SHOPPER KEEPS. A confirmation
    // without it is a screen that says "done" and leaves them nothing to quote
    // back — worse than an error, because it looks like success.
    typeof value.orderNumber === 'string' &&
    value.orderNumber.length > 0 &&
    isMoney(value.totalAmount) &&
    isMoney(value.shippingCost) &&
    typeof value.replayed === 'boolean' &&
    isEstimate(value.estimate)
  )
}

export type PayInput = {
  fingerprint: string
  deliveryMethod: DeliveryMethodName
  /** 🔴 `null` for self pickup — the server answers ADDRESS_NOT_ALLOWED otherwise. */
  address: { line1: string; city: string; zipCode: string | null } | null
  /**
   * 🔴 STABLE ACROSS RETRIES OF THE SAME ATTEMPT, and that is the entire point
   * of INV-05. A key regenerated per attempt turns one order into two.
   */
  idempotencyKey: string
  /** REQ-F-043 requires BOTH outcomes to be triggerable. */
  simulatedOutcome: 'success' | 'failure'
  /**
   * 🔴 ISSUE-093 — OPT-IN, DEFAULT OFF. The address is already stored on the
   * order (INV-02); this asks the server to index it against the SHOPPER so a
   * returning one need not retype it. Sending it unasked would hand someone
   * who shipped a one-off gift that address as their default.
   */
  saveAddress: boolean
}

/**
 * REQ-F-043's payment, and DEC-060's gate closing on it.
 *
 * 🔴 THE FINGERPRINT GOES BACK UNCHANGED. It is the quote the shopper was
 * SHOWN; the server re-derives its own from live data and refuses a mismatch.
 * Regenerating, trimming or omitting it defeats the gate rather than passing.
 */
export async function payForCheckout(input: PayInput): Promise<PaymentResult> {
  const base = getApiBaseUrl()
  if (!base.ok) return { ok: false, failure: { kind: 'offline' } }

  let status: number
  let body: unknown
  try {
    const response = await fetch(`${base.value}/api/checkout/pay`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fingerprint: input.fingerprint,
        deliveryMethod: input.deliveryMethod,
        // 🔴 OMITTED, not sent as null-ish, when there is no address: the
        // server asks `addressProblem` whether one is USABLE, and self pickup
        // carrying `{line1:'',city:''}` is refused as ADDRESS_NOT_ALLOWED.
        ...(input.address ? { address: input.address } : {}),
        idempotencyKey: input.idempotencyKey,
        simulatedOutcome: input.simulatedOutcome,
        saveAddress: input.saveAddress,
      }),
    })
    status = response.status
    try {
      body = await response.json()
    } catch {
      body = null
    }
  } catch {
    /*
     * 🔴 A DROPPED CONNECTION IS THE MOST DANGEROUS ANSWER HERE, because the
     * order may exist. The caller must RETRY WITH THE SAME KEY — the server
     * answers step 0 from the stored order and returns the confirmation. This
     * is why `offline` is not merged into `server`.
     */
    return { ok: false, failure: { kind: 'offline' } }
  }

  if (status === 200 || status === 201) {
    if (!isPaymentSuccess(body)) return { ok: false, failure: { kind: 'server' } }
    const success: PaymentSuccess = {
      orderId: body.orderId as string,
      orderNumber: body.orderNumber as string,
      totalAmount: body.totalAmount as string,
      shippingCost: body.shippingCost as string,
      replayed: body.replayed as boolean,
      estimate: body.estimate as PaymentSuccess['estimate'],
      // 🔴 Only when the server actually sent one — the step-0 replay path
      // reports the STORED status and the fresh-order path does not.
      ...(typeof (body as Record<string, unknown>).status === 'string'
        ? { status: (body as Record<string, unknown>).status as string }
        : {}),
    }
    /*
     * 🔴 A REPLAY IS NOT ALWAYS A CONFIRMATION. The server reports the STORED
     * status, and a cancelled order arrives here as 409 — but a `delivered` or
     * `shipped` one arrives as 200. Rendering it as "your order is placed" is
     * true; rendering it as "we just took your money" is not, so the status
     * travels to the screen rather than being dropped.
     */
    return { ok: true, order: success }
  }

  const code = errorCodeOf(body)

  if (status === 401) return { ok: false, failure: { kind: 'unauthenticated' } }
  if (status === 403 && code === 'EMAIL_NOT_VERIFIED') {
    return { ok: false, failure: { kind: 'emailNotVerified' } }
  }
  if (status === 429) return { ok: false, failure: { kind: 'rateLimited' } }
  // 🔴 402 IS ITS OWN ANSWER — REQ-F-045. No order was created, stock is
  // untouched and the cart survives, so the shopper may simply try again.
  if (status === 402) return { ok: false, failure: { kind: 'declined' } }

  if (code === 'ORDER_CANCELLED') {
    /*
     * ⚠️ `null` WHEN IT IS MISSING, not `''`. An empty string interpolated
     * into the copy renders "Order  was cancelled", which a shopper reads as
     * a rendering fault — and this same file refuses a SUCCESS whose order
     * number is blank on the grounds that a nameless receipt is worse than an
     * error. The screen carries a sentence for the unnamed case rather than
     * the rule being applied in opposite directions here.
     */
    const raw = isPlainObject(body) ? body.orderNumber : undefined
    const orderNumber = typeof raw === 'string' && raw.length > 0 ? raw : null
    return { ok: false, failure: { kind: 'orderCancelled', orderNumber } }
  }

  if (code === 'CHECKOUT_CHANGED') {
    // ⚠️ The refusal carries the NEW quote. Without it the screen would have to
    // re-request and race the same gate again.
    const quote = isPlainObject(body) ? body.quote : null
    if (isQuote(quote)) return { ok: false, failure: { kind: 'changed', quote } }
    return { ok: false, failure: { kind: 'server' } }
  }

  if (code === 'UNPURCHASABLE_LINE') {
    return { ok: false, failure: { kind: 'blocked', lines: blockedLinesOf(body) } }
  }
  if (code === 'EMPTY_CART') return { ok: false, failure: { kind: 'emptyCart' } }

  if (code === 'ADDRESS_REQUIRED' || code === 'ADDRESS_NOT_ALLOWED') {
    return { ok: false, failure: { kind: 'addressRejected', reason: code } }
  }

  if (
    code === 'FINGERPRINT_REQUIRED' ||
    code === 'INVALID_IDEMPOTENCY_KEY' ||
    code === 'INVALID_PAYMENT_OUTCOME' ||
    code === 'INVALID_DELIVERY_METHOD'
  ) {
    return { ok: false, failure: { kind: 'invalidRequest', code } }
  }

  return { ok: false, failure: { kind: 'server' } }
}
