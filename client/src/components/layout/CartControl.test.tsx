// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { CartProvider } from '../../state/CartContext'
import { CartControl } from './UtilityCluster'

/**
 * DEC-089a — the header cart control opens the DRAWER (it was a Link to
 * /cart with zero pinning tests, which is how the contract change sailed
 * through green — this file is the pin the old behavior never had).
 *
 * jsdom's half: the dialog trigger contract and the open/close wiring.
 * The breakpoint-crossing close and focus-return live in the browser
 * matrix (matchMedia and real focus are the second family's territory).
 */

const EMPTY_CART_BODY = {
  items: [],
  totalQuantity: 0,
  clubMember: false,
  clubSavings: '0.00',
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
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000')
  // matchMedia is not implemented in jsdom; the breakpoint-close effect
  // needs a stub to mount at all.
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => EMPTY_CART_BODY }) as unknown as Response),
  )
  render(
    <MemoryRouter>
      <CartProvider>
        <CartControl />
      </CartProvider>
    </MemoryRouter>,
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('DEC-089a — the header cart control', () => {
  it('is a dialog TRIGGER, not a link: aria-haspopup, aria-expanded flips, the drawer opens', async () => {
    const trigger = await screen.findByRole('button', { name: /cart/i })
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(trigger)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeDefined())
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    // DEC-073's empty-cart honesty inside the drawer.
    expect(screen.getByText(/cart is empty/i)).toBeDefined()
  })

  it('the full cart page stays reachable — through the drawer, not the trigger', async () => {
    fireEvent.click(await screen.findByRole('button', { name: /cart/i }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeDefined())
    // Empty cart shows no goToCart link (nothing to see there) but the
    // CLOSE control is mounted — the drawer never traps.
    expect(screen.getByRole('button', { name: /continue shopping/i })).toBeDefined()
  })
})
