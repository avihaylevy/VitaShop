// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { CartProvider } from '../../state/CartContext'
import type { Cart, CartLine } from '../../types/cart'
import { CartPage } from './CartPage'

/**
 * 🔴 ISSUE-104 — THE TEST THAT SHOULD HAVE EXISTED SINCE CHECKPOINT F2c.
 *
 * `/checkout` shipped four checkpoints ago and NOTHING IN THE CLIENT LINKED TO
 * IT: `grep` across `client/src` found the string only inside comments. The
 * screen worked, the flow behind it was tested end to end, and the only way in
 * was to type the URL — while the commit that shipped it was titled "a shopper
 * can place an order by clicking" and `STATUS.md` repeated that claim for days.
 *
 * ⚠️ IT SURVIVED BECAUSE EVERY TEST STARTED WHERE IT WANTED TO BE. The
 * integration tests drive the route; the client tests render `CheckoutPage`
 * directly, so the page always exists. Nothing asserted REACHABILITY.
 *
 * 🔴 THIS FILE ASSERTS THE ONE THING THOSE COULD NOT: starting at the cart, a
 * shopper can GET to checkout by clicking. It is the third instance of one
 * family — ISSUE-097 (a screen with no link), ISSUE-102 (a link with no
 * screen), ISSUE-104 (a screen with no link, and the milestone's whole point).
 */

/** The shapes come from `types/cart`, matching `CartPage.test.tsx`'s fixtures. */
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
  const active = lines.filter((l) => l.isActive)
  return {
    items: lines,
    totalQuantity: lines.reduce((sum, l) => sum + l.quantity, 0),
    subtotal: '189.80',
    // 🔴 THE SERVER'S FLAG, exactly as the page consumes it — the client never
    // re-derives it, so the fixture must not either.
    hasBlockingLine: lines.some((l) => !l.isActive),
    shipping: {
      basis: '189.80',
      cost: '30.00',
      isFree: false,
      threshold: '249.00',
      remainingForFree: '59.20',
      hasShippableLines: active.length > 0,
      noDeliveryRequired: false,
    },
  }
}

function respond(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => body }) as unknown as Response),
  )
}

function renderCart() {
  return render(
    <MemoryRouter initialEntries={['/cart']}>
      <CartProvider>
        <Routes>
          <Route path="/cart" element={<CartPage />} />
          <Route path="/checkout" element={<h1>checkout reached</h1>} />
        </Routes>
      </CartProvider>
    </MemoryRouter>,
  )
}

beforeEach(async () => {
  vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000')
  await i18n.changeLanguage('en')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('reaching checkout from the cart', () => {
  it('🔴 a shopper with a purchasable cart can REACH /checkout by clicking', async () => {
    respond(cart([line()]))
    renderCart()

    const entry = await screen.findByRole('link', { name: /checkout/i })
    expect(entry.getAttribute('href')).toBe('/checkout')
  })

  it('🔴 offers NO way through while a line BLOCKS checkout', async () => {
    /*
     * C3: the server's `hasBlockingLine` decides, and the cart already explains
     * why beside the offending row. Offering a control that the checkout screen
     * would refuse sends the shopper somewhere to be told no.
     */
    respond(cart([line({ isActive: false })]))
    renderCart()

    await screen.findByText(/Probiotic Intense/i)
    expect(screen.queryByRole('link', { name: /checkout/i })).toBeNull()
  })

  it('🔴 THE CONTROL — the blocking message and the entry cannot both be absent', async () => {
    // Without this, "no entry when blocked" would pass against a cart that
    // never renders an entry at all — which is exactly the defect being fixed.
    respond(cart([line({ isActive: false })]))
    renderCart()

    expect(await screen.findByRole('alert')).toBeTruthy()
  })

  it('an EMPTY cart offers no way to checkout', async () => {
    respond(cart([]))
    renderCart()

    await screen.findByText(/cart is empty/i)
    expect(screen.queryByRole('link', { name: /checkout/i })).toBeNull()
  })

  it('keeps the quiet way back to the catalogue', async () => {
    // The new control must not replace it — one is the primary action, the
    // other is the way out, and DESIGN_SYSTEM §8 keeps the second quiet.
    respond(cart([line()]))
    renderCart()

    expect((await screen.findByRole('link', { name: /continue shopping/i })).getAttribute('href')).toBe(
      '/catalog',
    )
  })
})
