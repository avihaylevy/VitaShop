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
    brandNameEn: null,
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

/**
 * @param shipping overrides — DEC-058's figures arrive from the SERVER, so the
 * fixture states them explicitly rather than deriving them here. Deriving would
 * make this file a second implementation of the rule under test.
 */
function cart(lines: CartLine[], shipping: Partial<Cart['shipping']> = {}): Cart {
  const active = lines.filter((l) => l.isActive)
  return {
    items: lines,
    totalQuantity: lines.reduce((sum, l) => sum + l.quantity, 0),
    subtotal: '189.80',
    hasBlockingLine: lines.some((l) => !l.isActive),
    shipping: {
      basis: '189.80',
      cost: '30.00',
      isFree: false,
      threshold: '249.00',
      remainingForFree: '59.20',
      hasShippableLines: active.length > 0,
      noDeliveryRequired: false,
      ...shipping,
    },
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
    // aria-disabled, not native disabled — the control must stay FOCUSABLE
    // while inert (DEC-073 review; Chromium blurs a natively-disabled focused
    // element, which inside the drawer's focus trap dropped focus to <body>).
    expect(increase.getAttribute('aria-disabled')).toBe('true')
    expect(increase.disabled).toBe(false)
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

/**
 * 🔴 DEC-058 — THE SHIPPING DISPLAY, AND THE SENTENCE THAT EXPLAINS IT.
 *
 * The arithmetic is the server's and is proved there. What is proved here is
 * that the page RENDERS what it was told and never derives money: the figures
 * below are the fixture's, and if the page ever computed its own the numbers
 * would stop matching.
 *
 * 🔴 The basis sentence is a REQUIREMENT, not decoration. With a withdrawn line
 * in the cart the screen shows a subtotal of one figure while shipping is
 * measured against a smaller one, and an unexplained gap between two numbers on
 * one screen reads as a bug.
 */
describe('🔴 DEC-058 — shipping is shown, and the basis is stated', () => {
  it('a chargeable cart shows ₪30 and how much more earns free shipping', async () => {
    fetchMock.mockResolvedValue(
      mockResponse(200, cart([line()], { basis: '189.80', cost: '30.00', remainingForFree: '59.20' })),
    )
    renderPage()

    await waitFor(() => expect(screen.getByText('Shipping')).toBeDefined())
    expect(screen.getAllByText(/30\.00/).length).toBeGreaterThan(0)
    // The remaining amount and the threshold both come from the SERVER.
    expect(screen.getByText(/Add .*59\.20.* more to get free shipping/)).toBeDefined()
  })

  it('a qualifying cart says FREE rather than showing ₪0.00', async () => {
    fetchMock.mockResolvedValue(
      mockResponse(200, cart([line()], { basis: '260.00', cost: '0.00', isFree: true, remainingForFree: '0.00' })),
    )
    renderPage()

    await waitFor(() => expect(screen.getByText('Free')).toBeDefined())
    expect(screen.getByText(/qualifies for free shipping/)).toBeDefined()
  })

  it('🔴 when a WITHDRAWN line makes the basis differ from the subtotal, the page SAYS which figure counts', async () => {
    // subtotal 189.80 (fixture) vs basis 120.00 — the gap a shopper would
    // otherwise read as a bug.
    fetchMock.mockResolvedValue(
      mockResponse(200, cart([line({ isActive: false })], {
        basis: '120.00',
        cost: '30.00',
        remainingForFree: '129.00',
        hasShippableLines: true,
        noDeliveryRequired: false,
      })),
    )
    renderPage()

    await waitFor(() => expect(screen.getByText('Shipping')).toBeDefined())
    // 🔴 Names the basis AND says which items were left out of it.
    //
    // ⚠️ The wording deliberately no longer says "no longer sold". Since
    // DEC-059 answer 3 a line is excluded when it is withdrawn OR short of the
    // quantity asked for, and the old sentence told a shopper that a
    // temporarily out-of-stock product was discontinued — the opposite of the
    // distinction the server itself draws.
    const explained = screen.getByText(/counted on the .*120\.00.* of items you can buy right now/)
    expect(explained).toBeDefined()
    expect(explained.textContent).toMatch(/cannot buy right now do not count/)
  })

  it('🔴 SELF PICKUP is never offered "add ₪0.00 more for free shipping"', async () => {
    // The flag existed, was validated, was in every fixture — and had NO
    // CONSUMER. Self pickup returns basis === subtotal, isFree false and
    // remainingForFree '0.00', which is precisely the shape that renders the
    // "add ₪X more" prompt, so the safety property was asserted in three
    // comments and implemented nowhere.
    fetchMock.mockResolvedValue(
      mockResponse(
        200,
        cart([line()], {
          basis: '189.80',
          cost: '0.00',
          isFree: false,
          remainingForFree: '0.00',
          noDeliveryRequired: true,
        }),
      ),
    )
    renderPage()

    await waitFor(() => expect(screen.getByText('Shipping')).toBeDefined())
    expect(screen.queryByText(/Add .* more to qualify/i)).toBeNull()
    expect(screen.queryByText(/₪0\.00 more/)).toBeNull()
    expect(screen.getByText(/nothing is shipped/i)).toBeDefined()
  })

  it('🔴 a cart with NOTHING shippable shows no shipping figure at all — not ₪0, not "free"', async () => {
    fetchMock.mockResolvedValue(
      mockResponse(200, cart([line({ isActive: false })], {
        basis: '0.00',
        cost: '0.00',
        isFree: false,
        hasShippableLines: false,
        noDeliveryRequired: false,
      })),
    )
    renderPage()

    await waitFor(() => expect(screen.getByText('Probiotic Intense')).toBeDefined())
    // The row is absent, not zeroed: free shipping is a promise about an ORDER
    // and there is no order for one to be about.
    expect(screen.queryByText('Shipping')).toBeNull()
    expect(screen.queryByText('Free')).toBeNull()
    // The subtotal is still shown — C3 is untouched, the cart still reports
    // what was put in it.
    expect(screen.getAllByText(/189\.80/).length).toBeGreaterThan(0)
  })

  it('Hebrew renders the same structure from the same code', async () => {
    await i18n.changeLanguage('he')
    fetchMock.mockResolvedValue(
      mockResponse(200, cart([line()], { basis: '189.80', cost: '30.00', remainingForFree: '59.20' })),
    )
    renderPage()

    await waitFor(() => expect(screen.getByText('משלוח')).toBeDefined())
    expect(screen.getByText(/הוספה של .*59\.20/)).toBeDefined()
  })
})

describe('🔴 the basis is named whenever the two figures disagree — free or not', () => {
  it('a FREE cart with a withdrawn line still says which total the threshold measured', async () => {
    // subtotal 189.80 (fixture) vs basis 260.00 is impossible; use a basis that
    // is genuinely smaller yet still qualifying, which is the real shape: a
    // large active total plus a withdrawn line on top.
    fetchMock.mockResolvedValue(
      mockResponse(200, cart([line({ isActive: false })], {
        basis: '260.00',
        cost: '0.00',
        isFree: true,
        remainingForFree: '0.00',
        hasShippableLines: true,
        noDeliveryRequired: false,
      })),
    )
    renderPage()

    await waitFor(() => expect(screen.getByText('Free')).toBeDefined())
    // 🔴 Without this branch the page would say only "qualifies for free
    // shipping" beside a subtotal that does not match the basis.
    expect(screen.getByText(/counted on the .*260\.00.* of items you can buy right now/)).toBeDefined()
  })
})
