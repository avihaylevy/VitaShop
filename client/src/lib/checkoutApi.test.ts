import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// 🔴 The same `?raw` drift guard `orderStatus.test.ts` uses: the client cannot
// import from `server/`, so the delivery-method list here is a COPY, and a copy
// nobody compares diverges.
import shippingSource from '../../../server/src/lib/shipping.ts?raw'
import { DELIVERY_METHOD_NAMES } from '../types/checkout'
import { isDeliveryMethodName, requestCheckoutQuote } from './checkoutApi'

const BASE_URL = 'http://localhost:3000'

function quoteBody(overrides: Record<string, unknown> = {}) {
  return {
    lines: [
      {
        id: 'line-1',
        slug: 'fixture',
        nameHe: 'מוצר',
        nameEn: 'Product',
        brandName: 'Brand',
        quantity: 2,
        unitPrice: '100.00',
        lineTotal: '200.00',
      },
    ],
    basis: '200.00',
    shipping: {
      cost: '30.00',
      isFree: false,
      threshold: '249.00',
      basis: '200.00',
      hasShippableLines: true,
      noDeliveryRequired: false,
    },
    totalAmount: '230.00',
    deliveryMethod: 'courier',
    estimate: { kind: 'delivered_between', minBusinessDays: 3, maxBusinessDays: 5 },
    fingerprint: 'abc123',
    ...overrides,
  }
}

function respond(status: number, body: unknown) {
  return vi.fn(async () => ({
    status,
    json: async () => body,
  }) as unknown as Response)
}

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', BASE_URL)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('requestCheckoutQuote — the happy path', () => {
  it('returns the quote, fingerprint intact', async () => {
    vi.stubGlobal('fetch', respond(200, quoteBody()))
    const result = await requestCheckoutQuote('courier')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.quote.totalAmount).toBe('230.00')
    // 🔴 DEC-060: `/pay` re-derives this and refuses a mismatch, so the
    // transport must hand it back untouched.
    expect(result.quote.fingerprint).toBe('abc123')
  })

  it('sends the chosen method, and sends the cookie', async () => {
    const fetchMock = respond(200, quoteBody({ deliveryMethod: 'self_pickup' }))
    vi.stubGlobal('fetch', fetchMock)
    await requestCheckoutQuote('self_pickup')

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ deliveryMethod: 'self_pickup' })
    // Without this the session cookie never travels and an authenticated
    // shopper is told to sign in.
    expect(init.credentials).toBe('include')
  })
})

describe('requestCheckoutQuote — each failure keeps its own identity', () => {
  it('401 is `unauthenticated`, not a generic server error', async () => {
    vi.stubGlobal('fetch', respond(401, { error: { code: 'UNAUTHENTICATED' } }))
    const result = await requestCheckoutQuote('courier')
    expect(result).toEqual({ ok: false, failure: { kind: 'unauthenticated' } })
  })

  it('409 EMPTY_CART is its own outcome', async () => {
    vi.stubGlobal('fetch', respond(409, { error: { code: 'EMPTY_CART' } }))
    const result = await requestCheckoutQuote('courier')
    expect(result).toEqual({ ok: false, failure: { kind: 'emptyCart' } })
  })

  it('409 UNPURCHASABLE_LINE carries the blocked lines through', async () => {
    vi.stubGlobal(
      'fetch',
      respond(409, {
        error: {
          code: 'UNPURCHASABLE_LINE',
          lines: [{ lineId: 'l1', slug: 'gone', why: 'SHORT_STOCK', available: 2 }],
        },
      }),
    )
    const result = await requestCheckoutQuote('courier')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('blocked')
    if (result.failure.kind !== 'blocked') return
    // The screen names WHICH line and what to do — dropping these would
    // reproduce ISSUE-080's dead end one screen later.
    expect(result.failure.lines).toEqual([
      { lineId: 'l1', slug: 'gone', why: 'SHORT_STOCK', available: 2 },
    ])
  })

  it('a thrown fetch is `offline`, not `server`', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network')
      }),
    )
    const result = await requestCheckoutQuote('courier')
    expect(result).toEqual({ ok: false, failure: { kind: 'offline' } })
  })
})

describe('🔴 a malformed 200 is a FAILURE, never a half-rendered checkout', () => {
  it('rejects a quote with no fingerprint — the confirm button could only fail', async () => {
    const { fingerprint, ...withoutFingerprint } = quoteBody()
    void fingerprint
    vi.stubGlobal('fetch', respond(200, withoutFingerprint))
    const result = await requestCheckoutQuote('courier')
    expect(result).toEqual({ ok: false, failure: { kind: 'server' } })
  })

  it('rejects money that is not canonical two-decimal', async () => {
    vi.stubGlobal('fetch', respond(200, quoteBody({ totalAmount: '230' })))
    expect(await requestCheckoutQuote('courier')).toEqual({
      ok: false,
      failure: { kind: 'server' },
    })
  })

  it('rejects an unknown delivery method in the response', async () => {
    vi.stubGlobal('fetch', respond(200, quoteBody({ deliveryMethod: 'drone' })))
    expect(await requestCheckoutQuote('courier')).toEqual({
      ok: false,
      failure: { kind: 'server' },
    })
  })

  it('rejects an estimate whose kind is unknown', async () => {
    vi.stubGlobal('fetch', respond(200, quoteBody({ estimate: { kind: 'someday' } })))
    expect(await requestCheckoutQuote('courier')).toEqual({
      ok: false,
      failure: { kind: 'server' },
    })
  })

  it('🔴 THE CONTROL — the sound body still passes', async () => {
    // Five rejections in a row read as diligence; a validator that rejected
    // EVERYTHING would pass all of them and break the screen. This is the
    // case that must go the other way.
    vi.stubGlobal('fetch', respond(200, quoteBody()))
    expect((await requestCheckoutQuote('courier')).ok).toBe(true)
  })
})

describe('the delivery-method list against the server', () => {
  function serverMethods(): string[] {
    const block = /export const DELIVERY_METHODS: readonly DeliveryMethodName\[\] = \[([\s\S]*?)\]/.exec(
      shippingSource,
    )
    if (block === null) return []
    return [...block[1]!.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]!)
  }

  it('finds a non-empty list of exactly three in the server source', () => {
    // Anti-vacuous: a regex that stopped matching would return [] and make the
    // comparison below pass against nothing.
    expect(serverMethods().length).toBe(3)
  })

  it('agrees with the server, in the same order', () => {
    expect(serverMethods()).toEqual([...DELIVERY_METHOD_NAMES])
  })

  it('isDeliveryMethodName narrows only for those three', () => {
    expect(isDeliveryMethodName('courier')).toBe(true)
    expect(isDeliveryMethodName('drone')).toBe(false)
    expect(isDeliveryMethodName(null)).toBe(false)
  })
})
