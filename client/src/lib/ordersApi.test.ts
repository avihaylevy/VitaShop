import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cancelOrder, requestOrder, requestOrderHistory } from './ordersApi'

/**
 * MILESTONE-008 Checkpoint G2 — the shopper's own orders, client side.
 *
 * 🔴 THE THEME IS THAT REFUSALS MEAN DIFFERENT THINGS AND ONE OF THEM MUST NOT.
 * `forbidden` (fulfilment has started), `terminal` (nothing left to cancel) and
 * `concurrent` (someone moved it while you looked) lead a shopper to three
 * different next moves — but "no such order" and "not yours" must stay ONE
 * outcome, because DEC-070 made them byte-identical on the server and a client
 * that split them would rebuild the enumeration oracle in the UI.
 */

const ITEM = {
  productId: 'p1',
  slug: 'magnesium-citrate',
  nameHe: 'מגנזיום ציטראט',
  nameEn: 'Magnesium Citrate',
  quantity: 2,
  unitPrice: '95.00',
}

const ROW = {
  id: 'o1',
  orderNumber: 'VS-20260814-ABC123',
  createdAt: '2026-08-14T10:00:00.000Z',
  status: 'paid',
  totalAmount: '220.00',
  shippingCost: '30.00',
  deliveryMethod: 'courier',
  items: [ITEM],
}

function respond(status: number, body: unknown) {
  return vi.fn(async () => ({ status, json: async () => body }) as unknown as Response)
}

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('requestOrderHistory', () => {
  it('returns the orders, with the item breakdown REQ-F-050 asks for', async () => {
    const fetchMock = respond(200, { orders: [ROW] })
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestOrderHistory()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.orders).toHaveLength(1)
    expect(result.orders[0]!.items[0]!.nameHe).toBe('מגנזיום ציטראט')
    expect(result.orders[0]!.items[0]!.nameEn).toBe('Magnesium Citrate')

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.credentials).toBe('include')
  })

  it('🔴 VALIDATES rather than casts — a malformed row is `unavailable`, not a NaN on screen', async () => {
    // A total that is not money renders as ₪NaN, which is the defect the
    // checkout screen shipped once and a review caught.
    vi.stubGlobal('fetch', respond(200, { orders: [{ ...ROW, totalAmount: 220 }] }))
    expect(await requestOrderHistory()).toEqual({ ok: false, failure: { kind: 'unavailable' } })
  })

  it('🔴 rejects a row whose STATUS this build does not know', async () => {
    // An unknown status has no label key, so it would render as a raw wire
    // string in a shopper-facing list — the drift this milestone paid for once.
    vi.stubGlobal('fetch', respond(200, { orders: [{ ...ROW, status: 'refunded' }] }))
    expect(await requestOrderHistory()).toEqual({ ok: false, failure: { kind: 'unavailable' } })
  })

  it('rejects an item that lost one of its two frozen names', async () => {
    const halfNamed = { ...ROW, items: [{ ...ITEM, nameHe: undefined }] }
    vi.stubGlobal('fetch', respond(200, { orders: [halfNamed] }))
    expect(await requestOrderHistory()).toEqual({ ok: false, failure: { kind: 'unavailable' } })
  })

  it('an EMPTY history is a success, not a failure', async () => {
    // The control: without it, "validates rows" could be a route that rejects
    // everything, and an empty list would look identical to a broken one.
    vi.stubGlobal('fetch', respond(200, { orders: [] }))
    expect(await requestOrderHistory()).toEqual({ ok: true, orders: [] })
  })

  it('separates 401, 429 and a server fault', async () => {
    vi.stubGlobal('fetch', respond(401, { error: { code: 'AUTHENTICATION_REQUIRED' } }))
    expect(await requestOrderHistory()).toEqual({ ok: false, failure: { kind: 'unauthenticated' } })

    // Waiting fixes a 429; a Retry button that re-hits it does not.
    vi.stubGlobal('fetch', respond(429, {}))
    expect(await requestOrderHistory()).toEqual({ ok: false, failure: { kind: 'rateLimited' } })

    vi.stubGlobal('fetch', respond(503, { error: { code: 'ORDER_HISTORY_UNAVAILABLE' } }))
    expect(await requestOrderHistory()).toEqual({ ok: false, failure: { kind: 'unavailable' } })
  })

  it('a dropped connection is `offline`, not a server fault', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network')
      }),
    )
    expect(await requestOrderHistory()).toEqual({ ok: false, failure: { kind: 'offline' } })
  })
})

describe('requestOrder', () => {
  it('returns one order, and accepts a NULL address as self pickup', async () => {
    vi.stubGlobal(
      'fetch',
      respond(200, {
        ...ROW,
        deliveryMethod: 'self_pickup',
        trackingNumber: null,
        shippingAddress: null,
      }),
    )
    const result = await requestOrder('o1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.order.shippingAddress).toBeNull()
  })

  it('carries the frozen address when there is one', async () => {
    vi.stubGlobal(
      'fetch',
      respond(200, {
        ...ROW,
        trackingNumber: 'TRK-1',
        shippingAddress: { line1: 'רחוב הרצל 1', city: 'תל אביב', zipCode: '6100000' },
      }),
    )
    const result = await requestOrder('o1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.order.shippingAddress?.city).toBe('תל אביב')
    expect(result.order.trackingNumber).toBe('TRK-1')
  })

  it('🔴 404 is ONE outcome — the client does not try to tell "missing" from "not yours"', async () => {
    vi.stubGlobal('fetch', respond(404, { error: { code: 'ORDER_NOT_FOUND' } }))
    expect(await requestOrder('o1')).toEqual({ ok: false, failure: { kind: 'notFound' } })
  })

  it('encodes the id into the path', async () => {
    const fetchMock = respond(200, { ...ROW, trackingNumber: null, shippingAddress: null })
    vi.stubGlobal('fetch', fetchMock)
    await requestOrder('a b/c')
    const [url] = fetchMock.mock.calls[0] as unknown as [string]
    expect(url).toContain('/api/orders/a%20b%2Fc')
  })
})

describe('cancelOrder', () => {
  it('reports an ordinary cancellation, and whether stock came back', async () => {
    vi.stubGlobal(
      'fetch',
      respond(200, { orderId: 'o1', status: 'cancelled', alreadyCancelled: false, restoredStock: true }),
    )
    expect(await cancelOrder('o1')).toEqual({
      ok: true,
      alreadyCancelled: false,
      restoredStock: true,
    })
  })

  it('🔴 an ALREADY-cancelled order is a SUCCESS, not an error', async () => {
    // A shopper who taps twice, or whose first response was dropped, got what
    // they asked for. Reporting a conflict is how a retry becomes a complaint.
    vi.stubGlobal(
      'fetch',
      respond(200, { orderId: 'o1', status: 'cancelled', alreadyCancelled: true, restoredStock: false }),
    )
    const result = await cancelOrder('o1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.alreadyCancelled).toBe(true)
  })

  it('🔴 keeps forbidden, terminal and concurrent APART', async () => {
    // Three different next moves: call us · nothing to cancel · refresh.
    vi.stubGlobal('fetch', respond(403, { error: { code: 'FORBIDDEN_FOR_ACTOR' } }))
    expect(await cancelOrder('o1')).toEqual({ ok: false, failure: { kind: 'forbidden' } })

    vi.stubGlobal('fetch', respond(409, { error: { code: 'TERMINAL' } }))
    expect(await cancelOrder('o1')).toEqual({ ok: false, failure: { kind: 'terminal' } })

    vi.stubGlobal('fetch', respond(409, { error: { code: 'CONCURRENT_TRANSITION' } }))
    expect(await cancelOrder('o1')).toEqual({ ok: false, failure: { kind: 'concurrent' } })
  })

  it('separates 401, 404, 429 and an unrecognised fault', async () => {
    vi.stubGlobal('fetch', respond(401, {}))
    expect(await cancelOrder('o1')).toEqual({ ok: false, failure: { kind: 'unauthenticated' } })

    vi.stubGlobal('fetch', respond(404, { error: { code: 'ORDER_NOT_FOUND' } }))
    expect(await cancelOrder('o1')).toEqual({ ok: false, failure: { kind: 'notFound' } })

    vi.stubGlobal('fetch', respond(429, {}))
    expect(await cancelOrder('o1')).toEqual({ ok: false, failure: { kind: 'rateLimited' } })

    vi.stubGlobal('fetch', respond(500, { error: { code: 'CANCELLATION_FAILED' } }))
    expect(await cancelOrder('o1')).toEqual({ ok: false, failure: { kind: 'server' } })
  })

  it('sends a POST, with credentials', async () => {
    const fetchMock = respond(200, { orderId: 'o1', status: 'cancelled', alreadyCancelled: false })
    vi.stubGlobal('fetch', fetchMock)
    await cancelOrder('o1')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/api/orders/o1/cancel')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
  })
})
