import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requestAdminOrders, transitionOrder } from './adminOrdersApi'

/**
 * MILESTONE-008 Checkpoint F3 — the admin orders transport.
 *
 * 🔴 THE THEME IS THAT 401, 403 AND THE THREE 409s ARE DIFFERENT ANSWERS. An
 * admin told "it broke" cannot tell a stale row from a finished order from
 * someone else editing at the same moment — and two of those are fixed by a
 * refresh they will never think to try.
 */

const ROW = {
  id: 'o1',
  orderNumber: 'VS-20260813-ABC123',
  createdAt: '2026-08-13T10:00:00.000Z',
  status: 'paid',
  totalAmount: '230.00',
  customerEmail: 'shopper@example.test',
  itemCount: 2,
  allowedTransitions: ['processing', 'cancelled'],
}

const PAGE = { page: 1, totalItems: 1, totalPages: 1, orders: [ROW] }

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

describe('requestAdminOrders', () => {
  it('returns the page, and carries each row-s allowed moves', async () => {
    const fetchMock = respond(200, PAGE)
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestAdminOrders()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 🔴 The server decides these. The screen renders one button per entry and
    // holds no copy of §8.9's table.
    expect(result.page.orders[0]!.allowedTransitions).toEqual(['processing', 'cancelled'])

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.credentials).toBe('include')
  })

  it('🔴 401 and 403 are DIFFERENT failures', async () => {
    vi.stubGlobal('fetch', respond(401, { error: { code: 'AUTHENTICATION_REQUIRED' } }))
    expect(await requestAdminOrders()).toEqual({ ok: false, failure: { kind: 'unauthenticated' } })

    vi.stubGlobal('fetch', respond(403, { error: { code: 'ADMIN_REQUIRED' } }))
    // Telling a signed-in shopper to sign in is the loop the profile route
    // shipped once.
    expect(await requestAdminOrders()).toEqual({ ok: false, failure: { kind: 'notAdmin' } })
  })

  it('503 is unavailable and a dropped connection is offline', async () => {
    vi.stubGlobal('fetch', respond(503, { error: { code: 'ORDER_LIST_UNAVAILABLE' } }))
    expect(await requestAdminOrders()).toEqual({ ok: false, failure: { kind: 'unavailable' } })

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network')
      }),
    )
    expect(await requestAdminOrders()).toEqual({ ok: false, failure: { kind: 'offline' } })
  })

  it('🔴 rejects a row offering a status this build does not know', async () => {
    // It would render a button labelled with a raw key, whose PATCH this
    // client could not describe if it failed.
    vi.stubGlobal(
      'fetch',
      respond(200, { ...PAGE, orders: [{ ...ROW, allowedTransitions: ['teleported'] }] }),
    )
    expect(await requestAdminOrders()).toEqual({ ok: false, failure: { kind: 'unavailable' } })
  })

  it('rejects a row whose total is not canonical money', async () => {
    vi.stubGlobal('fetch', respond(200, { ...PAGE, orders: [{ ...ROW, totalAmount: '230' }] }))
    expect(await requestAdminOrders()).toEqual({ ok: false, failure: { kind: 'unavailable' } })
  })

  it('🔴 THE CONTROL — the sound page still passes', async () => {
    vi.stubGlobal('fetch', respond(200, PAGE))
    expect((await requestAdminOrders()).ok).toBe(true)
  })
})

describe('transitionOrder', () => {
  it('reports the new status, whether it CHANGED, and whether stock came back', async () => {
    vi.stubGlobal(
      'fetch',
      respond(200, { orderId: 'o1', status: 'cancelled', changed: true, restoredStock: true }),
    )
    const result = await transitionOrder('o1', 'cancelled')
    expect(result).toEqual({ ok: true, status: 'cancelled', changed: true, restoredStock: true })
  })

  it('sends a PATCH carrying only the target status', async () => {
    const fetchMock = respond(200, { orderId: 'o1', status: 'processing', changed: true, restoredStock: false })
    vi.stubGlobal('fetch', fetchMock)
    await transitionOrder('o1', 'processing')

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/api/admin/orders/o1/status')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(String(init.body))).toEqual({ status: 'processing' })
  })

  it.each([
    ['TERMINAL', 'terminal'],
    ['NOT_A_TRANSITION', 'notATransition'],
    ['CONCURRENT_TRANSITION', 'concurrent'],
  ])('🔴 409 %s keeps its own identity (%s)', async (code, kind) => {
    // Two of the three are answered by a refresh; one means the button should
    // never have been offered. One shared message loses all of that.
    vi.stubGlobal('fetch', respond(409, { error: { code } }))
    const result = await transitionOrder('o1', 'shipped')
    if (result.ok) throw new Error('expected a failure')
    expect(result.failure.kind).toBe(kind)
  })

  it('🔴 the two 403s are told apart by their code', async () => {
    vi.stubGlobal('fetch', respond(403, { error: { code: 'ADMIN_REQUIRED' } }))
    let result = await transitionOrder('o1', 'shipped')
    if (result.ok) throw new Error('expected a failure')
    expect(result.failure.kind).toBe('notAdmin')

    vi.stubGlobal('fetch', respond(403, { error: { code: 'NOT_AN_ADMIN_TRANSITION' } }))
    result = await transitionOrder('o1', 'paid')
    if (result.ok) throw new Error('expected a failure')
    // "You are not an admin" and "an admin may not make THIS move" are
    // different facts about different things.
    expect(result.failure.kind).toBe('forbiddenMove')
  })

  it('404 is `gone` — the list is out of date, not broken', async () => {
    vi.stubGlobal('fetch', respond(404, { error: { code: 'ORDER_NOT_FOUND' } }))
    const result = await transitionOrder('o1', 'shipped')
    if (result.ok) throw new Error('expected a failure')
    expect(result.failure.kind).toBe('gone')
  })

  it('a 200 whose status is not a known one is a server fault', async () => {
    vi.stubGlobal('fetch', respond(200, { orderId: 'o1', status: 'teleported', changed: true }))
    const result = await transitionOrder('o1', 'shipped')
    expect(result).toEqual({ ok: false, failure: { kind: 'server' } })
  })
})
