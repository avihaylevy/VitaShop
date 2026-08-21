import { getApiBaseUrl } from './apiBaseUrl.js'
import { isOrderStatusName } from './orderStatus.js'
import type {
  CancelOrderResult,
  OrderDetail,
  OrderDetailResult,
  OrderHistoryItem,
  OrderHistoryResult,
  OrderHistoryRow,
} from '../types/orderHistory.js'

/**
 * MILESTONE-008 Checkpoint G2 — the shopper's own orders, REQ-F-050.
 *
 * 🔴 VALIDATED, NOT CAST, like every other transport here. A malformed row
 * would otherwise reach a shopper-facing list as ₪NaN or as a raw wire status
 * with no label — both of which this milestone has shipped once and had caught
 * in review.
 *
 * 🔴 "NO SUCH ORDER" AND "NOT YOURS" ARRIVE AS ONE ANSWER AND STAY ONE ANSWER.
 * DEC-070 made them byte-identical on the server precisely so the pair cannot
 * be diffed; a client that split them into two messages would rebuild that
 * oracle in the UI, where it is just as readable.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Money is a fixed string on the wire — never a number, never a float. */
function isMoney(value: unknown): value is string {
  return typeof value === 'string' && /^\d+\.\d{2}$/.test(value)
}

function isItem(value: unknown): value is OrderHistoryItem {
  if (!isPlainObject(value)) return false
  return (
    typeof value.productId === 'string' &&
    typeof value.slug === 'string' &&
    // 🔴 BOTH names, or neither. One name means the line renders in whichever
    // language the server picked, forever — INV-02's freeze is bilingual and
    // the client depends on that to toggle language without a request.
    typeof value.nameHe === 'string' &&
    typeof value.nameEn === 'string' &&
    typeof value.quantity === 'number' &&
    isMoney(value.unitPrice)
  )
}

function isRow(value: unknown): value is OrderHistoryRow {
  if (!isPlainObject(value)) return false
  if (!Array.isArray(value.items)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.orderNumber === 'string' &&
    value.orderNumber.length > 0 &&
    typeof value.createdAt === 'string' &&
    // An unknown status has no label key, so it would render as a raw wire
    // string in front of a shopper.
    isOrderStatusName(value.status) &&
    // The server-decided cancel offer — without it the page would need its
    // own copy of the statuses and the 10-day window (the drift the
    // hundred-second review removed).
    typeof value.cancellable === 'boolean' &&
    isMoney(value.totalAmount) &&
    isMoney(value.shippingCost) &&
    typeof value.deliveryMethod === 'string' &&
    value.items.every(isItem)
  )
}

function isAddress(value: unknown): value is OrderDetail['shippingAddress'] {
  // 🔴 NULL IS VALID AND MEANS SELF PICKUP — not "missing", and not an address
  // of blanks. The server sends null for exactly that case.
  if (value === null) return true
  if (!isPlainObject(value)) return false
  return (
    typeof value.line1 === 'string' &&
    typeof value.city === 'string' &&
    (value.zipCode === null || typeof value.zipCode === 'string')
  )
}

function errorCodeOf(body: unknown): string | undefined {
  if (!isPlainObject(body) || !isPlainObject(body.error)) return undefined
  return typeof body.error.code === 'string' ? body.error.code : undefined
}

async function call(
  path: string,
  method: 'GET' | 'POST' = 'GET',
): Promise<{ status: number; body: unknown } | null> {
  const base = getApiBaseUrl()
  if (!base.ok) return null
  try {
    const response = await fetch(`${base.value}${path}`, { method, credentials: 'include' })
    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      body = null
    }
    return { status: response.status, body }
  } catch {
    // A dropped connection is not a server fault, and the two need different
    // copy: one says try again, the other says something is wrong with us.
    return null
  }
}

export async function requestOrderHistory(): Promise<OrderHistoryResult> {
  const raw = await call('/api/orders')
  if (raw === null) return { ok: false, failure: { kind: 'offline' } }

  if (raw.status === 401) return { ok: false, failure: { kind: 'unauthenticated' } }
  // Waiting fixes a 429; a Retry button that re-hits it does not.
  if (raw.status === 429) return { ok: false, failure: { kind: 'rateLimited' } }
  if (raw.status !== 200) return { ok: false, failure: { kind: 'unavailable' } }

  const body = raw.body
  if (!isPlainObject(body) || !Array.isArray(body.orders)) {
    return { ok: false, failure: { kind: 'unavailable' } }
  }
  if (!body.orders.every(isRow)) return { ok: false, failure: { kind: 'unavailable' } }

  return { ok: true, orders: body.orders as OrderHistoryRow[] }
}

export async function requestOrder(orderId: string): Promise<OrderDetailResult> {
  const raw = await call(`/api/orders/${encodeURIComponent(orderId)}`)
  if (raw === null) return { ok: false, failure: { kind: 'offline' } }

  if (raw.status === 401) return { ok: false, failure: { kind: 'unauthenticated' } }
  if (raw.status === 404) return { ok: false, failure: { kind: 'notFound' } }
  if (raw.status === 429) return { ok: false, failure: { kind: 'rateLimited' } }
  if (raw.status !== 200) return { ok: false, failure: { kind: 'unavailable' } }

  const body = raw.body
  if (!isPlainObject(body)) return { ok: false, failure: { kind: 'unavailable' } }

  // ⚠️ The two detail-only fields are read BEFORE `isRow` narrows `body` to the
  // shared row type — after narrowing they are not on it, and reaching for them
  // through a cast would defeat the validation this whole module exists for.
  const { shippingAddress, trackingNumber } = body

  if (!isRow(body)) return { ok: false, failure: { kind: 'unavailable' } }
  if (!isAddress(shippingAddress)) return { ok: false, failure: { kind: 'unavailable' } }
  if (trackingNumber !== null && typeof trackingNumber !== 'string') {
    return { ok: false, failure: { kind: 'unavailable' } }
  }

  return { ok: true, order: { ...body, trackingNumber, shippingAddress } }
}

/**
 * §8.9 lets a shopper cancel from `pending_payment` and `paid`, and no further:
 * fulfilment begins at `processing`.
 *
 * 🔴 THE REFUSALS STAY APART because they lead somewhere different. `forbidden`
 * means the order is being prepared and a human must be asked; `terminal` means
 * there is nothing left to cancel; `concurrent` means the screen is stale and a
 * refresh answers it. Flattening them into "it broke" is the defect §8.12
 * records — and the one this milestone's fourth review round found again.
 */
export async function cancelOrder(orderId: string): Promise<CancelOrderResult> {
  const raw = await call(`/api/orders/${encodeURIComponent(orderId)}/cancel`, 'POST')
  if (raw === null) return { ok: false, failure: { kind: 'offline' } }

  if (raw.status === 200) {
    const body = raw.body
    if (!isPlainObject(body)) return { ok: false, failure: { kind: 'server' } }
    return {
      ok: true,
      // An order already cancelled is what the shopper asked for — a second tap
      // or a dropped first response, not an error.
      alreadyCancelled: body.alreadyCancelled === true,
      restoredStock: body.restoredStock === true,
    }
  }

  if (raw.status === 401) return { ok: false, failure: { kind: 'unauthenticated' } }
  if (raw.status === 404) return { ok: false, failure: { kind: 'notFound' } }
  if (raw.status === 403) return { ok: false, failure: { kind: 'forbidden' } }
  if (raw.status === 429) return { ok: false, failure: { kind: 'rateLimited' } }

  const code = errorCodeOf(raw.body)
  if (code === 'CANCEL_WINDOW_PASSED') return { ok: false, failure: { kind: 'windowPassed' } }
  if (code === 'TERMINAL') return { ok: false, failure: { kind: 'terminal' } }
  if (code === 'CONCURRENT_TRANSITION') return { ok: false, failure: { kind: 'concurrent' } }
  if (code === 'ORDER_NOT_FOUND') return { ok: false, failure: { kind: 'notFound' } }

  return { ok: false, failure: { kind: 'server' } }
}
