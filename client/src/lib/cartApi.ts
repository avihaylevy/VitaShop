import { getApiBaseUrl } from './apiBaseUrl.js'
import type {
  Cart,
  CartLine,
  CartMergeReport,
  CartMutationOutcome,
  CartResult,
} from '../types/cart.js'

/**
 * MILESTONE-007 Checkpoint G — the cart transport.
 *
 * 🔴 `credentials: 'include'` ON EVERY REQUEST, without exception. The guest
 * cart is keyed by a session cookie that is HttpOnly and cross-origin in
 * development. Without this the cookie is neither sent nor stored, every
 * request looks like a brand-new visitor, and the cart appears to work while
 * silently belonging to nobody — the same silent-identity failure ISSUE-069
 * recorded on the server side.
 *
 * 🔴 THE RESPONSE IS VALIDATED, not cast. `catalogApi.ts` set this precedent
 * and the reason holds harder here: an unvalidated cart is money on screen. A
 * response whose shape is wrong is a FAILURE, never a partially-rendered cart.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Canonical two-decimal money, matching the catalogue's own predicate. */
function isMoney(value: unknown): value is string {
  return typeof value === 'string' && /^\d+\.\d{2}$/.test(value)
}

function isCartLine(value: unknown): value is CartLine {
  if (!isPlainObject(value)) return false
  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.productId === 'string' &&
    typeof value.slug === 'string' &&
    typeof value.nameHe === 'string' &&
    typeof value.nameEn === 'string' &&
    typeof value.brandName === 'string' &&
    typeof value.packageQuantity === 'number' &&
    (value.imageFile === null || typeof value.imageFile === 'string') &&
    typeof value.quantity === 'number' &&
    Number.isInteger(value.quantity) &&
    isMoney(value.unitPrice) &&
    isMoney(value.lineTotal) &&
    typeof value.isActive === 'boolean' &&
    typeof value.stockQuantity === 'number' &&
    typeof value.lowStockThreshold === 'number'
  )
}

function isShipping(value: unknown): value is Cart['shipping'] {
  if (!isPlainObject(value)) return false
  return (
    isMoney(value.basis) &&
    isMoney(value.cost) &&
    isMoney(value.threshold) &&
    isMoney(value.remainingForFree) &&
    // 🔴 Strict on BOTH booleans. A missing `isFree` defaulting to false would
    // charge a shopper who qualified; a missing `hasShippableLines` defaulting
    // to true would render a shipping row for an empty cart. Absence is a
    // broken response, not a value.
    typeof value.isFree === 'boolean' &&
    typeof value.hasShippableLines === 'boolean'
  )
}

export function isCart(value: unknown): value is Cart {
  if (!isPlainObject(value)) return false
  return (
    Array.isArray(value.items) &&
    value.items.every(isCartLine) &&
    typeof value.totalQuantity === 'number' &&
    isMoney(value.subtotal) &&
    // 🔴 Strict: a MISSING flag rejects the response rather than defaulting to
    // false, because false is exactly the value that lets checkout proceed over
    // a line the server said was blocking.
    typeof value.hasBlockingLine === 'boolean' &&
    isShipping(value.shipping)
  )
}

export function isCartMergeReport(value: unknown): value is CartMergeReport {
  if (!isPlainObject(value)) return false
  return (
    typeof value.mergeFailed === 'boolean' &&
    typeof value.merged === 'boolean' &&
    Array.isArray(value.clampedSlugs) &&
    value.clampedSlugs.every((slug) => typeof slug === 'string') &&
    Array.isArray(value.dropped) &&
    value.dropped.every(
      (entry) =>
        isPlainObject(entry) &&
        typeof entry.slug === 'string' &&
        (entry.reason === 'INACTIVE' || entry.reason === 'UNAVAILABLE'),
    )
  )
}

type RawResponse = { status: number; body: unknown }

async function request(
  path: string,
  init: { method: string; body?: unknown } = { method: 'GET' },
): Promise<RawResponse | null> {
  const base = getApiBaseUrl()
  if (!base.ok) return null

  try {
    const response = await fetch(`${base.value}${path}`, {
      method: init.method,
      credentials: 'include',
      ...(init.body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) }),
    })

    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      body = null
    }
    return { status: response.status, body }
  } catch {
    return null
  }
}

/** Maps a non-2xx into the four failures the UI can actually say something about. */
function failureFor(raw: RawResponse): CartResult<never> {
  const code = isPlainObject(raw.body) && isPlainObject(raw.body.error) ? raw.body.error.code : undefined
  if (code === 'OUT_OF_STOCK') return { ok: false, failure: { kind: 'outOfStock' } }
  if (raw.status === 404) return { ok: false, failure: { kind: 'notFound' } }
  return { ok: false, failure: { kind: 'server' } }
}

const NETWORK: CartResult<never> = { ok: false, failure: { kind: 'network' } }

/**
 * A mutation answers with the WHOLE cart plus what it changed. The cart is
 * replaced wholesale from that payload — never patched locally, so the client
 * can hold no quantity the server did not just state.
 */
type MutationEnvelope = { cart: Cart; outcome: CartMutationOutcome }

function readMutation(subject: string, body: unknown): MutationEnvelope | null {
  if (!isPlainObject(body) || !isCart(body.cart)) return null
  if (typeof body.quantity !== 'number') return null
  return {
    cart: body.cart,
    outcome: {
      subject,
      quantity: body.quantity,
      clampedByCap: body.clampedByCap === true,
      clampedByStock: body.clampedByStock === true,
      alreadyAtMaximum: body.alreadyAtMaximum === true,
      removed: body.removed === true,
      unchanged: body.unchanged === true,
    },
  }
}

export async function fetchCart(): Promise<CartResult<Cart>> {
  const raw = await request('/api/cart')
  if (!raw) return NETWORK
  if (raw.status !== 200) return failureFor(raw)
  if (!isCart(raw.body)) return { ok: false, failure: { kind: 'server' } }
  return { ok: true, value: raw.body }
}

export async function addCartItem(
  slug: string,
  quantity: number,
  /** What to CALL it in a message. Defaults to the slug when no name is known. */
  subject: string = slug,
): Promise<CartResult<MutationEnvelope>> {
  const raw = await request('/api/cart/items', { method: 'POST', body: { slug, quantity } })
  if (!raw) return NETWORK
  if (raw.status !== 200) return failureFor(raw)
  const parsed = readMutation(subject, raw.body)
  return parsed ? { ok: true, value: parsed } : { ok: false, failure: { kind: 'server' } }
}

/**
 * 🔴 Quantity 0 REMOVES the line — Checkpoint D's decision, not a special case
 * invented here. The stepper's lower bound produces it naturally.
 */
export async function setCartLineQuantity(
  lineId: string,
  subject: string,
  quantity: number,
): Promise<CartResult<MutationEnvelope>> {
  const raw = await request(`/api/cart/items/${encodeURIComponent(lineId)}`, {
    method: 'PATCH',
    body: { quantity },
  })
  if (!raw) return NETWORK
  if (raw.status !== 200) return failureFor(raw)
  const parsed = readMutation(subject, raw.body)
  return parsed ? { ok: true, value: parsed } : { ok: false, failure: { kind: 'server' } }
}

/** Idempotent server-side: removing an already-gone line succeeds. */
export async function removeCartLine(
  lineId: string,
  subject: string,
): Promise<CartResult<MutationEnvelope>> {
  const raw = await request(`/api/cart/items/${encodeURIComponent(lineId)}`, { method: 'DELETE' })
  if (!raw) return NETWORK
  if (raw.status !== 200) return failureFor(raw)
  if (!isPlainObject(raw.body) || !isCart(raw.body.cart)) {
    return { ok: false, failure: { kind: 'server' } }
  }
  return {
    ok: true,
    value: {
      cart: raw.body.cart,
      outcome: {
        subject,
        quantity: 0,
        clampedByCap: false,
        clampedByStock: false,
        alreadyAtMaximum: false,
        removed: raw.body.removed === true,
        unchanged: raw.body.removed !== true,
      },
    },
  }
}
