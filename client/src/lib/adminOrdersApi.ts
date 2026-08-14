import { getApiBaseUrl } from './apiBaseUrl.js'
import { isOrderStatusName, type OrderStatusName } from './orderStatus.js'
import type {
  AdminListFailure,
  AdminOrderRow,
  AdminOrdersResult,
  ReconcileResult,
  StuckOrdersResult,
  TransitionResult,
} from '../types/adminOrders.js'

/**
 * MILESTONE-008 Checkpoint F3 — the admin orders transport.
 *
 * 🔴 VALIDATED, NOT CAST. A malformed row would otherwise reach the screen as
 * `undefined` buttons and a NaN total on a page whose whole purpose is moving
 * real orders and real stock.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMoney(value: unknown): value is string {
  return typeof value === 'string' && /^\d+\.\d{2}$/.test(value)
}

function isRow(value: unknown): value is AdminOrderRow {
  if (!isPlainObject(value)) return false
  if (!Array.isArray(value.allowedTransitions)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.orderNumber === 'string' &&
    value.orderNumber.length > 0 &&
    typeof value.createdAt === 'string' &&
    isOrderStatusName(value.status) &&
    isMoney(value.totalAmount) &&
    typeof value.customerEmail === 'string' &&
    typeof value.itemCount === 'number' &&
    // 🔴 EVERY offered move must be a status this build knows. An unknown one
    // would render a button whose label is a raw key and whose PATCH this
    // client cannot describe.
    value.allowedTransitions.every(isOrderStatusName)
  )
}

function errorCodeOf(body: unknown): string | undefined {
  if (!isPlainObject(body) || !isPlainObject(body.error)) return undefined
  return typeof body.error.code === 'string' ? body.error.code : undefined
}

async function call(
  path: string,
  init?: { method: string; body: unknown },
): Promise<{ status: number; body: unknown } | null> {
  const base = getApiBaseUrl()
  if (!base.ok) return null
  try {
    const response = await fetch(`${base.value}${path}`, {
      method: init?.method ?? 'GET',
      credentials: 'include',
      ...(init ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) } : {}),
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

export async function requestAdminOrders(page = 1): Promise<AdminOrdersResult> {
  const raw = await call(`/api/admin/orders?page=${encodeURIComponent(String(page))}`)
  if (raw === null) return { ok: false, failure: { kind: 'offline' } }

  if (raw.status === 401) return { ok: false, failure: { kind: 'unauthenticated' } }
  /*
   * 🔴 403 IS NOT 401, AND THE DIFFERENCE IS THE WHOLE POINT of the guards
   * behind this route: 401 means sign in, 403 means you are signed in and this
   * is not yours. Telling an ordinary shopper to sign in — which they have —
   * is a loop this project already shipped once, on the profile route.
   */
  if (raw.status === 403) return { ok: false, failure: { kind: 'notAdmin' } }
  // Waiting fixes a 429; a Retry button that re-hits it does not.
  if (raw.status === 429) return { ok: false, failure: { kind: 'rateLimited' } }
  if (raw.status !== 200) return { ok: false, failure: { kind: 'unavailable' } }

  const body = raw.body
  if (!isPlainObject(body) || !Array.isArray(body.orders)) {
    return { ok: false, failure: { kind: 'unavailable' } }
  }
  if (!body.orders.every(isRow)) return { ok: false, failure: { kind: 'unavailable' } }

  return {
    ok: true,
    page: {
      page: typeof body.page === 'number' ? body.page : 1,
      totalItems: typeof body.totalItems === 'number' ? body.totalItems : 0,
      totalPages: typeof body.totalPages === 'number' ? body.totalPages : 0,
      orders: body.orders as AdminOrderRow[],
    },
  }
}

/**
 * One of §8.9's four admin moves.
 *
 * ⚠️ The screen offers only what the row's `allowedTransitions` carries, so a
 * refusal here means the row is STALE — someone else moved the order, or the
 * page has been open a while. That is why `notATransition` and `concurrent`
 * are separate outcomes rather than one error: both are answered by a refresh,
 * and saying so is the difference between an admin reloading and an admin
 * filing a bug.
 */
export async function transitionOrder(
  orderId: string,
  status: OrderStatusName,
  /**
   * ISSUE-103 — sent only with the move to `shipped`, and only when the admin
   * typed one; the server refuses it on any other target. Trimmed here so a
   * pasted value with whitespace does not read as "present" while empty.
   */
  trackingNumber?: string,
): Promise<TransitionResult> {
  const trimmedTracking = trackingNumber?.trim() ?? ''
  const raw = await call(`/api/admin/orders/${encodeURIComponent(orderId)}/status`, {
    method: 'PATCH',
    body: {
      status,
      ...(status === 'shipped' && trimmedTracking !== '' ? { trackingNumber: trimmedTracking } : {}),
    },
  })
  if (raw === null) return { ok: false, failure: { kind: 'offline' } }

  if (raw.status === 200) {
    const body = raw.body
    if (!isPlainObject(body) || !isOrderStatusName(body.status)) {
      return { ok: false, failure: { kind: 'server' } }
    }
    return {
      ok: true,
      status: body.status,
      changed: body.changed === true,
      // 🔴 REPORTED, because a cancellation that returned stock is a different
      // event from one that did not, and an admin watching inventory needs to
      // know which just happened.
      restoredStock: body.restoredStock === true,
    }
  }

  if (raw.status === 401) return { ok: false, failure: { kind: 'unauthenticated' } }

  const code = errorCodeOf(raw.body)
  if (raw.status === 403) {
    // ADMIN_REQUIRED means the account is not an admin; NOT_AN_ADMIN_TRANSITION
    // means it is, and asked for a move that is nobody's to make from here.
    return { ok: false, failure: { kind: code === 'ADMIN_REQUIRED' ? 'notAdmin' : 'forbiddenMove' } }
  }
  if (raw.status === 404) return { ok: false, failure: { kind: 'gone' } }
  if (raw.status === 429) return { ok: false, failure: { kind: 'rateLimited' } }

  if (code === 'TERMINAL') return { ok: false, failure: { kind: 'terminal' } }
  if (code === 'NOT_A_TRANSITION') return { ok: false, failure: { kind: 'notATransition' } }
  if (code === 'CONCURRENT_TRANSITION') return { ok: false, failure: { kind: 'concurrent' } }

  return { ok: false, failure: { kind: 'server' } }
}

/**
 * The shared refusal mapping for both reconciliation calls.
 *
 * 🔴 401 AND 403 STAY APART. 401 means sign in; 403 means you are signed in and
 * this is not yours — telling a signed-in shopper to sign in is the loop the
 * profile route shipped once.
 */
function reconcileFailure(status: number): AdminListFailure {
  if (status === 401) return { kind: 'unauthenticated' }
  if (status === 403) return { kind: 'notAdmin' }
  if (status === 429) return { kind: 'rateLimited' }
  return { kind: 'unavailable' }
}

/**
 * MILESTONE-008 Checkpoint G3 — the READ half of ISSUE-082's trigger.
 * 🔴 Changes nothing, so the screen may call it on load.
 */
export async function requestStuckOrders(): Promise<StuckOrdersResult> {
  const raw = await call('/api/admin/orders/stuck')
  if (raw === null) return { ok: false, failure: { kind: 'offline' } }
  if (raw.status !== 200) return { ok: false, failure: reconcileFailure(raw.status) }

  const body = raw.body
  if (!isPlainObject(body) || typeof body.count !== 'number' || !Array.isArray(body.orders)) {
    return { ok: false, failure: { kind: 'unavailable' } }
  }
  return {
    ok: true,
    count: body.count,
    orders: body.orders as { id: string; orderNumber: string; createdAt: string }[],
  }
}

/**
 * 🔴 THE REPAIR. IT MARKS ORDERS PAID — the screen asks first, and the server
 * refuses anyone who is not an admin with the role read per request (DEC-065).
 *
 * ⚠️ A PARTIAL REPAIR IS A SUCCESS. `failed` carries the orders the table or
 * the write refused, and reporting only the count would hide which ones are
 * still stuck — the whole point of the sweep's report.
 */
export async function reconcileStuckOrders(): Promise<ReconcileResult> {
  const raw = await call('/api/admin/orders/reconcile', { method: 'POST', body: {} })
  if (raw === null) return { ok: false, failure: { kind: 'offline' } }
  if (raw.status !== 200) return { ok: false, failure: reconcileFailure(raw.status) }

  const body = raw.body
  if (
    !isPlainObject(body) ||
    typeof body.examined !== 'number' ||
    typeof body.repaired !== 'number' ||
    typeof body.remaining !== 'number' ||
    !Array.isArray(body.failed)
  ) {
    return { ok: false, failure: { kind: 'unavailable' } }
  }
  return {
    ok: true,
    report: {
      examined: body.examined,
      repaired: body.repaired,
      failed: body.failed as { orderNumber: string; reason: string }[],
      remaining: body.remaining,
    },
  }
}
