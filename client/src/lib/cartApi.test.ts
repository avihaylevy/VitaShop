import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addCartItem, fetchCart, isCart, isCartMergeReport, removeCartLine, setCartLineQuantity } from './cartApi.js'
import type { CartLine } from '../types/cart.js'

const BASE_URL = 'http://localhost:3000'

function mockResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

function validLine(overrides: Partial<CartLine> = {}): CartLine {
  return {
    id: 'line-1',
    productId: 'product-1',
    slug: 'altman-probiotic-intense-30',
    nameHe: 'פרוביוטיק אינטנס',
    nameEn: 'Probiotic Intense',
    brandName: 'אלטמן',
    brandNameEn: 'Altman',
    packageQuantity: 30,
    imageFile: 'probiotic.webp',
    quantity: 2,
    unitPrice: '94.90',
    lineTotal: '189.80',
    isActive: true,
    stockQuantity: 3,
    lowStockThreshold: 5,
    ...overrides,
  }
}

function validCart(lines: CartLine[] = [validLine()]) {
  return {
    items: lines,
    totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
    subtotal: '189.80',
    hasBlockingLine: lines.some((line) => !line.isActive),
    // DEC-058. Present because `isCart` REQUIRES it — a response without
    // shipping is a broken response, not a cart with free delivery.
    shipping: {
      basis: '189.80',
      cost: '30.00',
      isFree: false,
      threshold: '249.00',
      remainingForFree: '59.20',
      hasShippableLines: true,
      noDeliveryRequired: false,
    },
  }
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', BASE_URL)
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

/**
 * MILESTONE-007 Checkpoint G.
 *
 * 🔴 These test what makes the transport FAIL, not that a good response is
 * parsed. A cart that renders a plausible number it should have rejected is
 * worse than one that does not render.
 */

describe('🔴 the session cookie — the cart has no identity without it', () => {
  it("EVERY request sends credentials: 'include'", async () => {
    fetchMock.mockResolvedValue(mockResponse(200, validCart()))
    await fetchCart()

    fetchMock.mockResolvedValue(mockResponse(200, { cart: validCart(), quantity: 2 }))
    await addCartItem('a-slug', 1)
    await setCartLineQuantity('line-1', 'a-slug', 2)

    fetchMock.mockResolvedValue(mockResponse(200, { cart: validCart(), removed: true }))
    await removeCartLine('line-1', 'a-slug')

    expect(fetchMock).toHaveBeenCalledTimes(4)
    // 🔴 Asserted on every call, not just the first. The guest cart is keyed by
    // an HttpOnly cookie; a single request without this behaves as a brand-new
    // visitor and the loss is completely silent — the same shape as ISSUE-069.
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.credentials).toBe('include')
    }
  })

  it('a line id is percent-encoded into the path, never concatenated raw', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, { cart: validCart(), removed: true }))
    await removeCartLine('a/b?c', 'a-slug')
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE_URL}/api/cart/items/a%2Fb%3Fc`)
  })
})

describe('🔴 an invalid response is a FAILURE, never a partly-rendered cart', () => {
  it.each([
    ['a line with no id — PATCH and DELETE would be unaddressable', { id: undefined }],
    ['a price that is not canonical two-decimal money', { unitPrice: '94.9' }],
    ['a price sent as a number', { unitPrice: 94.9 as unknown as string }],
    ['a fractional quantity', { quantity: 1.5 }],
    ['a missing isActive flag — C3 could not block checkout', { isActive: undefined }],
    ['a missing stock quantity', { stockQuantity: undefined }],
  ])('rejects %s', async (_label, override) => {
    const line = { ...validLine(), ...override } as CartLine
    fetchMock.mockResolvedValue(mockResponse(200, validCart([line])))

    const result = await fetchCart()
    expect(result).toEqual({ ok: false, failure: { kind: 'server' } })
  })

  it('🔴 a MISSING hasBlockingLine is rejected, not defaulted to false', () => {
    const cart = validCart()
    delete (cart as Record<string, unknown>).hasBlockingLine
    // false is exactly the value that would let checkout proceed over a line
    // the server called blocking, so absence must not become it.
    expect(isCart(cart)).toBe(false)
  })

  it('🔴 a MISSING noDeliveryRequired is rejected, not defaulted to false', () => {
    const cart = validCart()
    delete (cart.shipping as Record<string, unknown>).noDeliveryRequired
    // 🔴 THE FIELD WAS ADDED TO THE TYPE AND NOT TO THE GUARD, which is worse
    // than never having it: the response passed, TypeScript reported the flag
    // as `boolean` while it was `undefined`, and `undefined` is falsy — so the
    // self-pickup branch it exists to force never fired, and the type system
    // asserted that could not happen. `false` is exactly the wrong default:
    // it is the value that renders "add ₪0.00 more for free shipping" on an
    // order with no delivery at all.
    expect(isCart(cart)).toBe(false)
  })

  it('accepts the response the server actually sends', () => {
    expect(isCart(validCart())).toBe(true)
  })
})

describe('failure mapping — only what the UI can honestly say', () => {
  it('an unreachable server is a network failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await fetchCart()).toEqual({ ok: false, failure: { kind: 'network' } })
  })

  it('OUT_OF_STOCK is distinguished, because the shopper can act on it', async () => {
    fetchMock.mockResolvedValue(mockResponse(400, { error: { code: 'OUT_OF_STOCK', message: 'x' } }))
    expect(await addCartItem('a-slug', 1)).toEqual({ ok: false, failure: { kind: 'outOfStock' } })
  })

  it('a 404 is notFound; a 500 is a plain server failure', async () => {
    fetchMock.mockResolvedValue(mockResponse(404, { error: { code: 'PRODUCT_NOT_FOUND', message: 'x' } }))
    expect(await addCartItem('a-slug', 1)).toEqual({ ok: false, failure: { kind: 'notFound' } })

    fetchMock.mockResolvedValue(mockResponse(500, { error: { code: 'INVALID_STOCK', message: 'x' } }))
    expect(await addCartItem('a-slug', 1)).toEqual({ ok: false, failure: { kind: 'server' } })
  })

  it('a missing VITE_API_BASE_URL fails rather than requesting a wrong origin', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '')
    expect(await fetchCart()).toEqual({ ok: false, failure: { kind: 'network' } })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('🔴 the outcome flags survive the transport — §7.16', () => {
  it('a clamped add reports the SERVER quantity and both clamp reasons', async () => {
    fetchMock.mockResolvedValue(
      mockResponse(200, {
        cart: validCart(),
        quantity: 3,
        clampedByCap: false,
        clampedByStock: true,
        alreadyAtMaximum: false,
      }),
    )

    const result = await addCartItem('altman-probiotic-intense-30', 11)
    expect(result.ok).toBe(true)
    // 🔴 3, not the 11 that was asked for. If this ever reports the request's
    // quantity, the UI is lying about what is in the cart.
    expect(result.ok && result.value.outcome.quantity).toBe(3)
    expect(result.ok && result.value.outcome.clampedByStock).toBe(true)
    expect(result.ok && result.value.outcome.clampedByCap).toBe(false)
  })

  it('alreadyAtMaximum arrives as true, so a no-op is not reported as a success', async () => {
    fetchMock.mockResolvedValue(
      mockResponse(200, { cart: validCart(), quantity: 10, alreadyAtMaximum: true }),
    )
    const result = await addCartItem('a-slug', 1)
    expect(result.ok && result.value.outcome.alreadyAtMaximum).toBe(true)
  })

  it('a repeated DELETE reports removed: false, so a retry is not announced as a removal', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, { cart: validCart([]), removed: false }))
    const result = await removeCartLine('line-1', 'a-slug')
    expect(result.ok && result.value.outcome.removed).toBe(false)
    expect(result.ok && result.value.outcome.unchanged).toBe(true)
  })
})

describe("the login response's merge report", () => {
  it('accepts what auth.ts sends', () => {
    expect(
      isCartMergeReport({
        mergeFailed: false,
        merged: true,
        clampedSlugs: ['a'],
        dropped: [{ slug: 'b', reason: 'INACTIVE' }],
      }),
    ).toBe(true)
  })

  it('🔴 rejects an unknown drop reason rather than rendering an unexplained removal', () => {
    expect(
      isCartMergeReport({
        mergeFailed: false,
        merged: true,
        clampedSlugs: [],
        dropped: [{ slug: 'b', reason: 'SOMETHING_ELSE' }],
      }),
    ).toBe(false)
  })

  it('rejects a missing mergeFailed — absence must not read as success', () => {
    expect(isCartMergeReport({ merged: true, clampedSlugs: [], dropped: [] })).toBe(false)
  })

  it('ISSUE-073 — accepts the names the server now sends with a dropped line', () => {
    expect(
      isCartMergeReport({
        mergeFailed: false,
        merged: true,
        clampedSlugs: [],
        dropped: [{ slug: 'b', nameHe: 'שם', nameEn: 'Name', reason: 'INACTIVE' }],
      }),
    ).toBe(true)
  })

  it('ISSUE-073 (amended by review) — a malformed or null name must NOT sink the report', () => {
    // The report is the clamp/drop notification; the name is decoration with
    // a slug fallback. Losing the whole message over a bad name would be the
    // silent loss the report exists to prevent. The renderer type-checks the
    // name at use instead.
    for (const badName of [42, null, ''] as const) {
      expect(
        isCartMergeReport({
          mergeFailed: false,
          merged: true,
          clampedSlugs: [],
          dropped: [{ slug: 'b', nameHe: badName, reason: 'INACTIVE' }],
        }),
      ).toBe(true)
    }
  })
})
