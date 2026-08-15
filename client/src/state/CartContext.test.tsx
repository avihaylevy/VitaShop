// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CartProvider, useCart } from './CartContext'
import type { Cart } from '../types/cart'

const BASE_URL = 'http://localhost:3000'

function mockResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

function cartWith(quantity: number): Cart {
  return {
    items: [
      {
        id: 'line-1',
        productId: 'product-1',
        slug: 'a-slug',
        nameHe: 'שם',
        nameEn: 'Name',
        brandName: 'Brand',
        brandNameEn: null,
        packageQuantity: 30,
        imageFile: null,
        quantity,
        unitPrice: '10.00',
        lineTotal: `${(10 * quantity).toFixed(2)}`,
        isActive: true,
        stockQuantity: 3,
        lowStockThreshold: 5,
      },
    ],
    totalQuantity: quantity,
    clubMember: false,
    subtotal: `${(10 * quantity).toFixed(2)}`,
    hasBlockingLine: false,
    shipping: {
      basis: `${(10 * quantity).toFixed(2)}`,
      cost: '30.00',
      isFree: false,
      threshold: '249.00',
      remainingForFree: '249.00',
      hasShippableLines: quantity > 0,
      noDeliveryRequired: false,
    },
  }
}

/** Renders the context's state as text, so assertions read the real value. */
function Probe() {
  const { status, cart, failure, outcome } = useCart()
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="total">{cart.totalQuantity}</span>
      <span data-testid="lines">{cart.items.length}</span>
      <span data-testid="failure">{failure?.kind ?? 'none'}</span>
      <span data-testid="clamped">{String(outcome?.clampedByStock ?? false)}</span>
      <span data-testid="outcomeQuantity">{outcome?.quantity ?? 'none'}</span>
    </div>
  )
}

let fetchMock: ReturnType<typeof vi.fn>
let handle: { current: ReturnType<typeof useCart> | null }

function Capture() {
  handle.current = useCart()
  return null
}

function renderCart() {
  handle = { current: null }
  return render(
    <CartProvider>
      <Probe />
      <Capture />
    </CartProvider>,
  )
}

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', BASE_URL)
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

/**
 * MILESTONE-007 Checkpoint G.
 *
 * 🔴 THESE TEST THE THREE STATES THE PROTOTYPE NEVER HAD, because browser
 * memory never fails: loading, a FAILED load, and a mutation that fails while a
 * cart is already on screen.
 */

describe('the load', () => {
  it('starts in loading and settles in ready', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, cartWith(2)))
    renderCart()

    expect(screen.getByTestId('status').textContent).toBe('loading')
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'))
    expect(screen.getByTestId('total').textContent).toBe('2')
  })

  it('🔴 A FAILED LOAD IS NOT AN EMPTY CART', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    renderCart()

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('error'))
    expect(screen.getByTestId('failure').textContent).toBe('network')
    // The distinction is the whole point: "your cart is empty" is a claim the
    // client has no standing to make when it could not reach the server at all.
    expect(screen.getByTestId('status').textContent).not.toBe('ready')
  })

  it('retrying after a failure recovers', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    renderCart()
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('error'))

    fetchMock.mockResolvedValue(mockResponse(200, cartWith(1)))
    await act(async () => {
      await handle.current?.refresh()
    })
    expect(screen.getByTestId('status').textContent).toBe('ready')
    expect(screen.getByTestId('total').textContent).toBe('1')
  })
})

describe('🔴 the server decides the quantity — §3.4', () => {
  it('a clamped add publishes the SERVER quantity, never the requested one', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, cartWith(0)))
    renderCart()
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'))

    // Asked for 11; the server clamped to 3 (this product's stock).
    fetchMock.mockResolvedValue(
      mockResponse(200, { cart: cartWith(3), quantity: 3, clampedByStock: true, clampedByCap: false }),
    )
    await act(async () => {
      await handle.current?.addItem('a-slug', 11)
    })

    expect(screen.getByTestId('total').textContent).toBe('3')
    expect(screen.getByTestId('outcomeQuantity').textContent).toBe('3')
    expect(screen.getByTestId('clamped').textContent).toBe('true')
  })

  it('the whole cart is REPLACED from the response, never patched locally', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, cartWith(2)))
    renderCart()
    await waitFor(() => expect(screen.getByTestId('total').textContent).toBe('2'))

    // The server answers with a cart the client could not have derived: the
    // line is GONE, even though the request was an increment.
    fetchMock.mockResolvedValue(
      mockResponse(200, {
        cart: {
          items: [],
          totalQuantity: 0,
          clubMember: false,
          subtotal: '0.00',
          hasBlockingLine: false,
          shipping: {
            basis: '0.00',
            cost: '0.00',
            isFree: false,
            threshold: '249.00',
            remainingForFree: '0.00',
            hasShippableLines: false,
            noDeliveryRequired: false,
          },
        },
        quantity: 1,
      }),
    )
    await act(async () => {
      await handle.current?.setLineQuantity('line-1', 'a-slug', 3)
    })

    expect(screen.getByTestId('lines').textContent).toBe('0')
    expect(screen.getByTestId('total').textContent).toBe('0')
  })
})

describe('🔴 a failed mutation must not report a loss that did not happen', () => {
  it('keeps the cart on screen and states the failure', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, cartWith(2)))
    renderCart()
    await waitFor(() => expect(screen.getByTestId('total').textContent).toBe('2'))

    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    let result: unknown
    await act(async () => {
      result = await handle.current?.removeLine('line-1', 'a-slug')
    })

    expect(result).toBeNull()
    // Nothing changed server-side, so nothing may change on screen.
    expect(screen.getByTestId('total').textContent).toBe('2')
    expect(screen.getByTestId('status').textContent).toBe('ready')
    expect(screen.getByTestId('failure').textContent).toBe('network')
  })
})

describe('🔴 mutations are serialized, so a slow response cannot overwrite a newer cart', () => {
  it('two adds issued together resolve in call order', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, cartWith(0)))
    renderCart()
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'))

    const order: string[] = []
    fetchMock.mockImplementation(async (_url: string, init: { body?: string }) => {
      const slug = JSON.parse(init.body ?? '{}').slug as string
      order.push(slug)
      // The FIRST request is the slow one. Without serialization it would
      // settle last and its stale cart would win.
      if (slug === 'first') await new Promise((resolve) => setTimeout(resolve, 30))
      return mockResponse(200, { cart: cartWith(slug === 'first' ? 1 : 2), quantity: 1 })
    })

    await act(async () => {
      const a = handle.current?.addItem('first', 1)
      const b = handle.current?.addItem('second', 1)
      await Promise.all([a, b])
    })

    expect(order).toEqual(['first', 'second'])
    // The LAST call's cart is the one on screen.
    expect(screen.getByTestId('total').textContent).toBe('2')
  })
})
