import type { OrderStatusName } from '../lib/orderStatus.js'

/**
 * MILESTONE-008 Checkpoint G2 — REQ-F-050's shapes, client side.
 *
 * 🔴 BOTH FROZEN NAMES, mirroring the server. INV-02 froze the Hebrew AND the
 * English name at purchase, so the line resolves per render and a language
 * toggle needs no request — the same rule `CartLine` and the catalogue follow.
 */
export type OrderHistoryItem = {
  productId: string
  /** LIVE, for linking. The name beside it is what was agreed; this is where the product is now. */
  slug: string
  nameHe: string
  nameEn: string
  quantity: number
  /** A fixed string, never a number — the float this project keeps out of money. */
  unitPrice: string
}

export type OrderHistoryRow = {
  id: string
  orderNumber: string
  createdAt: string
  status: OrderStatusName
  /**
   * 🔴 SERVER-COMPUTED (status ∈ §8.9's shopper rows, and `paid` inside the
   * 10-day window, on the SERVER's clock). The client renders this and holds
   * no copy of the statuses or the window; the cancel route still re-checks.
   */
  cancellable: boolean
  totalAmount: string
  shippingCost: string
  deliveryMethod: string
  items: OrderHistoryItem[]
}

/**
 * 🔴 NOT FOUND IS ONE OUTCOME, and the client must not try to be cleverer than
 * the server. DEC-070 makes "no such order" and "not yours" byte-identical on
 * purpose; a client that split them into two messages would rebuild, in the
 * UI, the oracle the status code closes.
 */
export type OrderHistoryFailure =
  | { kind: 'offline' }
  | { kind: 'unauthenticated' }
  | { kind: 'rateLimited' }
  | { kind: 'unavailable' }

export type OrderHistoryResult =
  | { ok: true; orders: OrderHistoryRow[] }
  | { ok: false; failure: OrderHistoryFailure }

export type OrderDetail = OrderHistoryRow & {
  trackingNumber: string | null
  /** 🔴 Null for self pickup — no address at all, not an address of blanks. */
  shippingAddress: { line1: string; city: string; zipCode: string | null } | null
}

export type OrderDetailResult =
  | { ok: true; order: OrderDetail }
  | { ok: false; failure: OrderHistoryFailure | { kind: 'notFound' } }

/**
 * The shopper's own cancellation — §8.9 allows it from `pending_payment` and
 * `paid`, and stops there, because fulfilment begins at `processing`.
 *
 * ⚠️ `forbidden` IS NOT `terminal`. Fulfilment having started is a different
 * fact from the order being finished, and they lead a shopper to different
 * next moves — one is "call us", the other is "there is nothing to cancel".
 */
export type CancelOrderResult =
  | { ok: true; alreadyCancelled: boolean; restoredStock: boolean }
  | {
      ok: false
      failure:
        | { kind: 'offline' }
        | { kind: 'unauthenticated' }
        | { kind: 'rateLimited' }
        | { kind: 'notFound' }
        | { kind: 'forbidden' }
        /** The 10-day cancellation window has passed — goods presumed received. */
        | { kind: 'windowPassed' }
        | { kind: 'terminal' }
        | { kind: 'concurrent' }
        | { kind: 'server' }
    }
