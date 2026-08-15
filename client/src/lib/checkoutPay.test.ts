import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { payForCheckout, type PayInput } from './checkoutApi'

/**
 * MILESTONE-008 Checkpoint F2c — `POST /api/checkout/pay`, all eleven answers.
 *
 * 🔴 THE THEME IS THAT NONE OF THEM MAY BE FLATTENED. §8.12 records one defect
 * shape appearing FOUR times in Checkpoint D: a later step failed and the
 * shopper was told the ORDER failed — for an order that exists. Each of those
 * was a distinct server answer collapsed into "it didn't work".
 */

const SUCCESS = {
  orderId: 'order-1',
  orderNumber: 'VS-20260813-ABC123',
  totalAmount: '230.00',
  shippingCost: '30.00',
  replayed: false,
  estimate: { kind: 'delivered_between', minBusinessDays: 3, maxBusinessDays: 5 },
}

const QUOTE = {
  lines: [
    {
      id: 'l1',
      slug: 's',
      nameHe: 'מ',
      nameEn: 'P',
      brandName: 'B',
      brandNameEn: null,
      quantity: 1,
      unitPrice: '100.00',
      lineTotal: '100.00',
    },
  ],
  clubMember: false,
  clubSavings: '0.00',
  basis: '100.00',
  shipping: {
    cost: '30.00',
    isFree: false,
    threshold: '249.00',
    basis: '100.00',
    hasShippableLines: true,
    noDeliveryRequired: false,
  },
  totalAmount: '130.00',
  deliveryMethod: 'courier',
  estimate: { kind: 'delivered_between', minBusinessDays: 3, maxBusinessDays: 5 },
  fingerprint: 'fp-new',
}

const INPUT: PayInput = {
  fingerprint: 'fp-shown',
  deliveryMethod: 'courier',
  address: { line1: 'רחוב 1', city: 'תל אביב', zipCode: null },
  idempotencyKey: 'key-1',
  simulatedOutcome: 'success',
  saveAddress: false,
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

describe('what it sends', () => {
  it('returns the fingerprint UNCHANGED — the gate compares, it does not read', async () => {
    const fetchMock = respond(201, SUCCESS)
    vi.stubGlobal('fetch', fetchMock)
    await payForCheckout(INPUT)

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const sent = JSON.parse(String(init.body))
    expect(sent.fingerprint).toBe('fp-shown')
    expect(sent.idempotencyKey).toBe('key-1')
    expect(init.credentials).toBe('include')
  })

  it('🔴 OMITS the address entirely for self pickup', async () => {
    // Sending `{line1:'',city:''}` is refused as ADDRESS_NOT_ALLOWED: the
    // server asks whether an address is USABLE, and an empty object is still
    // an object.
    const fetchMock = respond(201, SUCCESS)
    vi.stubGlobal('fetch', fetchMock)
    await payForCheckout({ ...INPUT, deliveryMethod: 'self_pickup', address: null })

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect('address' in JSON.parse(String(init.body))).toBe(false)
  })
})

describe('ISSUE-093 — the address is saved only when asked', () => {
  it('sends saveAddress:false by default, so nothing is stored', async () => {
    const fetchMock = respond(201, SUCCESS)
    vi.stubGlobal('fetch', fetchMock)
    await payForCheckout(INPUT)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body)).saveAddress).toBe(false)
  })

  it('sends it when the shopper ticked the box', async () => {
    const fetchMock = respond(201, SUCCESS)
    vi.stubGlobal('fetch', fetchMock)
    await payForCheckout({ ...INPUT, saveAddress: true })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body)).saveAddress).toBe(true)
  })
})

describe('the two answers that must never read as a failure', () => {
  it('201 is a new order', async () => {
    vi.stubGlobal('fetch', respond(201, SUCCESS))
    const result = await payForCheckout(INPUT)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.order.orderNumber).toBe('VS-20260813-ABC123')
    expect(result.order.replayed).toBe(false)
  })

  it('🔴 200 with replayed:true is a CONFIRMATION — the order already exists', async () => {
    // A retry after a dropped connection. Reporting this as an error is the
    // §8.12 defect: the shopper is told the order failed while it exists.
    vi.stubGlobal('fetch', respond(200, { ...SUCCESS, replayed: true, status: 'paid' }))
    const result = await payForCheckout(INPUT)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.order.replayed).toBe(true)
    // The STORED status travels, so the screen can tell a live order from one
    // that has moved on.
    expect(result.order.status).toBe('paid')
  })

  it('🔴 a CANCELLED order is not "payment failed" — it names the order', async () => {
    vi.stubGlobal(
      'fetch',
      respond(409, {
        error: { code: 'ORDER_CANCELLED', message: 'x' },
        orderNumber: 'VS-20260813-ZZZ999',
      }),
    )
    const result = await payForCheckout(INPUT)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure).toEqual({ kind: 'orderCancelled', orderNumber: 'VS-20260813-ZZZ999' })
  })
})

describe('DEC-060 — the gate refusing', () => {
  it('CHECKOUT_CHANGED carries the NEW quote through', async () => {
    vi.stubGlobal(
      'fetch',
      respond(409, { error: { code: 'CHECKOUT_CHANGED', message: 'x' }, quote: QUOTE }),
    )
    const result = await payForCheckout(INPUT)
    expect(result.ok).toBe(false)
    if (result.ok || result.failure.kind !== 'changed') throw new Error('expected `changed`')
    // REQ-F-042 requires the updated figures to be SHOWN and confirmed again.
    expect(result.failure.quote.fingerprint).toBe('fp-new')
    expect(result.failure.quote.totalAmount).toBe('130.00')
  })

  it('a CHECKOUT_CHANGED whose quote is malformed is a server fault, not a silent halt', async () => {
    vi.stubGlobal(
      'fetch',
      respond(409, { error: { code: 'CHECKOUT_CHANGED' }, quote: { totalAmount: 'x' } }),
    )
    const result = await payForCheckout(INPUT)
    expect(result).toEqual({ ok: false, failure: { kind: 'server' } })
  })
})

describe('every other refusal keeps its own identity', () => {
  it.each([
    [402, { error: { code: 'PAYMENT_DECLINED' } }, 'declined'],
    [401, { error: { code: 'AUTHENTICATION_REQUIRED' } }, 'unauthenticated'],
    [403, { error: { code: 'EMAIL_NOT_VERIFIED' } }, 'emailNotVerified'],
    [429, { error: { code: 'TOO_MANY_REQUESTS' } }, 'rateLimited'],
    [409, { error: { code: 'EMPTY_CART' } }, 'emptyCart'],
    [500, { error: { code: 'BOOM' } }, 'server'],
  ])('%i → %s', async (status, body, kind) => {
    vi.stubGlobal('fetch', respond(status as number, body))
    const result = await payForCheckout(INPUT)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe(kind)
  })

  it.each(['ADDRESS_REQUIRED', 'ADDRESS_NOT_ALLOWED'])('400 %s is an address fault', async (code) => {
    vi.stubGlobal('fetch', respond(400, { error: { code } }))
    const result = await payForCheckout(INPUT)
    if (result.ok || result.failure.kind !== 'addressRejected') throw new Error('expected address fault')
    expect(result.failure.reason).toBe(code)
  })

  it.each(['FINGERPRINT_REQUIRED', 'INVALID_IDEMPOTENCY_KEY', 'INVALID_PAYMENT_OUTCOME'])(
    '400 %s is THIS CLIENT being wrong, and says which',
    async (code) => {
      vi.stubGlobal('fetch', respond(400, { error: { code } }))
      const result = await payForCheckout(INPUT)
      if (result.ok || result.failure.kind !== 'invalidRequest') throw new Error('expected invalidRequest')
      expect(result.failure.code).toBe(code)
    },
  )

  it('a blocked order still names its lines', async () => {
    vi.stubGlobal(
      'fetch',
      respond(409, {
        error: {
          code: 'UNPURCHASABLE_LINE',
          lines: [{ lineId: 'l1', slug: 'gone', why: 'WITHDRAWN', available: 0 }],
        },
      }),
    )
    const result = await payForCheckout(INPUT)
    if (result.ok || result.failure.kind !== 'blocked') throw new Error('expected blocked')
    expect(result.failure.lines).toHaveLength(1)
  })

  it('🔴 a dropped connection is `offline`, NOT a failed order', async () => {
    // The most dangerous answer here: the order may exist. The caller must
    // retry with the SAME key, which the server answers from the stored order.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network')
      }),
    )
    expect(await payForCheckout(INPUT)).toEqual({ ok: false, failure: { kind: 'offline' } })
  })
})

describe('🔴 a malformed SUCCESS is a failure — it is the receipt for money', () => {
  it('rejects a 201 with no order number', async () => {
    const { orderNumber, ...withoutNumber } = SUCCESS
    void orderNumber
    vi.stubGlobal('fetch', respond(201, withoutNumber))
    // A confirmation without the number is worse than an error: it looks like
    // success and leaves the shopper nothing to quote back.
    expect(await payForCheckout(INPUT)).toEqual({ ok: false, failure: { kind: 'server' } })
  })

  it('rejects a total that is not canonical money', async () => {
    vi.stubGlobal('fetch', respond(201, { ...SUCCESS, totalAmount: '230' }))
    expect(await payForCheckout(INPUT)).toEqual({ ok: false, failure: { kind: 'server' } })
  })

  it('🔴 THE CONTROL — the sound success still passes', async () => {
    vi.stubGlobal('fetch', respond(201, SUCCESS))
    expect((await payForCheckout(INPUT)).ok).toBe(true)
  })
})
