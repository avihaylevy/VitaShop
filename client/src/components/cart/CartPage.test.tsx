// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { CartProvider } from '../../state/CartContext'
import type { Cart, CartLine } from '../../types/cart'
import { CartPage } from './CartPage'

const BASE_URL = 'http://localhost:3000'

function mockResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

function line(overrides: Partial<CartLine> = {}): CartLine {
  return {
    id: 'line-1',
    productId: 'product-1',
    slug: 'altman-probiotic-intense-30',
    nameHe: 'פרוביוטיק אינטנס',
    nameEn: 'Probiotic Intense',
    brandName: 'Altman',
    packageQuantity: 30,
    imageFile: null,
    quantity: 2,
    unitPrice: '94.90',
    lineTotal: '189.80',
    isActive: true,
    stockQuantity: 3,
    lowStockThreshold: 5,
    ...overrides,
  }
}

function cart(lines: CartLine[]): Cart {
  return {
    items: lines,
    totalQuantity: lines.reduce((sum, l) => sum + l.quantity, 0),
    subtotal: '189.80',
    hasBlockingLine: lines.some((l) => !l.isActive),
  }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <CartProvider>
        <CartPage />
      </CartProvider>
    </MemoryRouter>,
  )
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(async () => {
  await i18n.changeLanguage('en')
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
 * 🔴 EVERY CASE HERE IS ONE THE PROTOTYPE COULD NOT PRODUCE. Browser memory
 * never loads, never fails and never clamps, so `/cart` had never rendered a
 * loading state, an error state, a server-clamped quantity or a withdrawn
 * product. Those are exactly the four this file covers.
 */

describe('the three states browser memory never had', () => {
  it('renders a loading state before the cart arrives', async () => {
    // A request still in flight: the page must show loading, not empty. It is
    // given a real (late) resolution rather than a promise that never settles,
    // so the provider is not left permanently suspended after this test.
    fetchMock.mockReturnValue(
      new Promise((resolve) => setTimeout(() => resolve(mockResponse(200, cart([]))), 50)),
    )
    renderPage()

    expect(screen.getByText('Loading your cart…')).toBeDefined()
    expect(screen.queryByText('Your cart is empty')).toBeNull()

    // Settled before the test ends: a provider left mid-request would carry
    // its pending state into the next test and make an unrelated one hang.
    await waitFor(() => expect(screen.getByText('Your cart is empty')).toBeDefined())
  })

  it('🔴 A FAILED LOAD RENDERS AN ERROR AND A RETRY — never "your cart is empty"', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    renderPage()

    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined())
    expect(screen.getByRole('alert').textContent).toContain('could not be reached')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined()
    // The claim the client has no standing to make.
    expect(screen.queryByText('Your cart is empty')).toBeNull()
  })

  it('renders the empty state only when the SERVER said the cart is empty', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, cart([])))
    renderPage()

    await waitFor(() => expect(screen.getByText('Your cart is empty')).toBeDefined())
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('🔴 the cart renders what the SERVER said', () => {
  it('shows the server quantity, subtotal and line total, not a client calculation', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, cart([line({ quantity: 2 })])))
    renderPage()

    await waitFor(() => expect(screen.getByText('2 items in cart')).toBeDefined())
    // 189.80 is the server's lineTotal AND its subtotal; both are rendered,
    // neither is multiplied here.
    expect(screen.getAllByText(/189\.80/).length).toBeGreaterThan(0)
  })

  it('🔴 a WITHDRAWN product is shown, struck through, explained, and BLOCKS CHECKOUT', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, cart([line({ isActive: false })])))
    renderPage()

    await waitFor(() => expect(screen.getByText('Probiotic Intense')).toBeDefined())

    // Shown, not dropped — dropping it silently would make the cart lie about
    // what was put in it (C3).
    const name = screen.getByText('Probiotic Intense')
    expect(name.className).toContain('line-through')

    // 🔴 And explained IN WORDS, not by the strike-through alone: a
    // visual-only signal is not reported by a screen reader.
    expect(screen.getByText(/This product is no longer sold/i)).toBeDefined()

    // Checkout is blocked, from the SERVER's own flag.
    const alerts = screen.getAllByRole('alert').map((el) => el.textContent ?? '')
    expect(alerts.some((text) => /Remove them to continue to checkout/i.test(text))).toBe(true)

    // Removal stays available: it is the only way out of the block.
    expect(screen.getByRole('button', { name: /Remove Probiotic Intense/ })).toBeDefined()
  })

  it('the increment control is disabled at live stock', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, cart([line({ quantity: 3, stockQuantity: 3 })])))
    renderPage()

    await waitFor(() => expect(screen.getByText('Probiotic Intense')).toBeDefined())
    const increase = screen.getByRole('button', { name: /Increase quantity/ }) as HTMLButtonElement
    expect(increase.disabled).toBe(true)
  })
})

describe('🔴 a clamp is SAID OUT LOUD — §7.16', () => {
  it('the notice states the SERVER quantity and the reason', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, cart([line({ quantity: 1 })])))
    renderPage()
    await waitFor(() => expect(screen.getByText('Probiotic Intense')).toBeDefined())

    // The shopper presses "+" asking for 4; stock is 3, so the server clamps.
    fetchMock.mockResolvedValue(
      mockResponse(200, {
        cart: cart([line({ quantity: 3 })]),
        quantity: 3,
        clampedByStock: true,
        clampedByCap: false,
        removed: false,
        unchanged: false,
      }),
    )
    screen.getByRole('button', { name: /Increase quantity/ }).click()

    await waitFor(() => {
      const statuses = screen.getAllByRole('status').map((el) => el.textContent ?? '')
      // 🔴 "3", never the 4 that was asked for.
      expect(statuses.some((text) => /Only 3 of .* are in stock/.test(text))).toBe(true)
    })
  })

  it('a no-op add is reported as a no-op, not as a success', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, cart([line({ quantity: 2, stockQuantity: 50 })])))
    renderPage()
    await waitFor(() => expect(screen.getByText('Probiotic Intense')).toBeDefined())

    fetchMock.mockResolvedValue(
      mockResponse(200, {
        cart: cart([line({ quantity: 10, stockQuantity: 50 })]),
        quantity: 10,
        alreadyAtMaximum: true,
      }),
    )
    screen.getByRole('button', { name: /Increase quantity/ }).click()

    await waitFor(() => {
      const statuses = screen.getAllByRole('status').map((el) => el.textContent ?? '')
      expect(statuses.some((text) => /already at its maximum/.test(text))).toBe(true)
    })
  })
})

describe('Hebrew renders the same structure, from the same code', () => {
  it('resolves the Hebrew name and the Hebrew strings', async () => {
    await i18n.changeLanguage('he')
    fetchMock.mockResolvedValue(mockResponse(200, cart([line()])))
    renderPage()

    await waitFor(() => expect(screen.getByText('פרוביוטיק אינטנס')).toBeDefined())
    expect(screen.getByText('עגלת הקניות')).toBeDefined()
    // The English name is NOT rendered — the line is language-resolved from the
    // server's paired names on every render, not frozen at add time.
    expect(screen.queryByText('Probiotic Intense')).toBeNull()
  })
})
