import type { OrderStatusName } from '../lib/orderStatus'

/**
 * MILESTONE-008 Checkpoint F3 — the admin orders list, as the browser sees it.
 *
 * 🔴 `allowedTransitions` COMES FROM THE SERVER, PER ROW, and this client must
 * never compute it. §8.9's table decides which moves are legal from a status,
 * and a browser holding its own copy is the drift that blanked the
 * blocked-order screen earlier in this milestone. The row says what to offer;
 * the PATCH guard still decides.
 */
export type AdminOrderRow = {
  id: string
  orderNumber: string
  /** ISO 8601, formatted for display only — never parsed for logic. */
  createdAt: string
  status: OrderStatusName
  totalAmount: string
  customerEmail: string
  itemCount: number
  allowedTransitions: readonly OrderStatusName[]
}

export type AdminOrdersPage = {
  page: number
  totalItems: number
  totalPages: number
  orders: readonly AdminOrderRow[]
}

export type AdminListFailure =
  | { kind: 'unauthenticated' }
  /** 429 — waiting fixes it; retrying immediately does not. */
  | { kind: 'rateLimited' }
  /** Signed in, not an admin. A different sentence from "sign in". */
  | { kind: 'notAdmin' }
  | { kind: 'unavailable' }
  | { kind: 'offline' }

export type AdminOrdersResult =
  | { ok: true; page: AdminOrdersPage }
  | { ok: false; failure: AdminListFailure }

/**
 * 🔴 THE REFUSALS ARE DISTINCT BECAUSE THE ADMIN'S NEXT MOVE IS. `TERMINAL`
 * means the order is finished and the button should never have been offered;
 * `NOT_A_TRANSITION` means the row is stale; `CONCURRENT_TRANSITION` means
 * someone else got there first and a refresh will show what happened. Reported
 * as one error, all three read as "it broke".
 */
export type TransitionFailure =
  | { kind: 'terminal' }
  | { kind: 'notATransition' }
  | { kind: 'concurrent' }
  | { kind: 'forbiddenMove' }
  | { kind: 'gone' }
  | { kind: 'unauthenticated' }
  | { kind: 'notAdmin' }
  /**
   * 🔴 429 from the status limiter — 60 moves per 15 minutes, per admin. An
   * admin working a long fulfilment queue WILL reach it, and "the update
   * failed" is indistinguishable from a server fault, so they retry
   * immediately and keep failing. The same argument that split the three 409s.
   */
  | { kind: 'rateLimited' }
  | { kind: 'server' }
  | { kind: 'offline' }

export type TransitionResult =
  | { ok: true; status: OrderStatusName; changed: boolean; restoredStock: boolean }
  | { ok: false; failure: TransitionFailure }
