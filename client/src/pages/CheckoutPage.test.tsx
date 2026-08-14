// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { CheckoutPage } from './CheckoutPage'

/**
 * MILESTONE-008 Checkpoint F2b — the review findings that live on the screen
 * rather than in the transport.
 */

function quote(overrides: Record<string, unknown> = {}) {
  return {
    lines: [
      {
        id: 'line-1',
        slug: 'fixture',
        nameHe: 'מוצר',
        nameEn: 'Product',
        brandName: 'Brand',
        quantity: 1,
        unitPrice: '100.00',
        lineTotal: '100.00',
      },
    ],
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
    fingerprint: 'fp-courier',
    ...overrides,
  }
}

const PICKUP = quote({
  deliveryMethod: 'self_pickup',
  shipping: {
    cost: '0.00',
    isFree: false,
    threshold: '249.00',
    basis: '100.00',
    hasShippableLines: true,
    noDeliveryRequired: true,
  },
  totalAmount: '100.00',
  estimate: { kind: 'ready_within', businessDays: 2 },
  fingerprint: 'fp-pickup',
})

function renderPage() {
  return render(
    <MemoryRouter>
      <CheckoutPage />
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

describe('🔴 out-of-order quotes cannot reach the screen', () => {
  it('a SLOW earlier response is discarded when a later one has already settled', async () => {
    // Request 1 (courier) resolves LAST. Without the request-id guard the
    // screen ends up showing courier's ₪130 beside a checked self-pickup
    // radio — and holding courier's fingerprint, so F2c's /pay would refuse
    // with a mismatch the shopper cannot account for.
    // A holder object, not a `let` — TypeScript does not track an assignment
    // made inside the executor callback and narrows the binding to `null`.
    const release: { fn: () => void } = { fn: () => {} }
    const first = new Promise<void>((resolve) => {
      release.fn = resolve
    })

    let call = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1
        if (call === 1) {
          await first
          return { status: 200, json: async () => quote() } as unknown as Response
        }
        return { status: 200, json: async () => PICKUP } as unknown as Response
      }),
    )

    renderPage()
    const pickup = await screen.findByRole('radio', { name: /self pickup/i })
    pickup.click()

    // The second (self pickup) answer lands first.
    await waitFor(() => expect(screen.getByText(/no shipping with self pickup/i)).toBeTruthy())

    // Now the stale courier answer arrives.
    release.fn()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(screen.getByText(/no shipping with self pickup/i)).toBeTruthy()
    expect(screen.queryByText(/130\.00/)).toBeNull()
    expect((await screen.findByRole('radio', { name: /self pickup/i })).getAttribute('checked')).not.toBe(
      'false',
    )
  })
})

describe('the failure branches that had no way out', () => {
  it('an expired session offers a LINK, not just a sentence', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ status: 401, json: async () => ({ error: { code: 'X' } }) }) as unknown as Response),
    )
    renderPage()
    // RequireAuth cannot help here: SessionContext still believes the session
    // is live, because only the server knows it expired.
    expect(await screen.findByRole('link', { name: /go to sign in/i })).toBeTruthy()
  })

  it('🔴 a 429 does NOT offer a retry button that re-hits the limiter', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ status: 429, json: async () => ({ error: { code: 'TOO_MANY_REQUESTS' } }) }) as unknown as Response),
    )
    renderPage()
    expect(await screen.findByText(/too many attempts/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull()
  })

  it('🔴 THE CONTROL — an ordinary server error DOES offer the retry', async () => {
    // Without this, "no retry button" would pass against a screen that had
    // lost the button everywhere.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ status: 500, json: async () => ({ error: { code: 'BOOM' } }) }) as unknown as Response),
    )
    renderPage()
    expect(await screen.findByRole('button', { name: /try again/i })).toBeTruthy()
  })

  it('a blocked order NAMES every line, whatever the reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        status: 409,
        json: async () => ({
          error: {
            code: 'UNPURCHASABLE_LINE',
            lines: [
              { lineId: 'l1', slug: 'withdrawn-one', why: 'WITHDRAWN', available: 0 },
              { lineId: 'l2', slug: 'gone-one', why: 'SOLD_OUT', available: 0 },
              { lineId: 'l3', slug: 'short-one', why: 'SHORT_STOCK', available: 2 },
            ],
          },
        }),
      }) as unknown as Response),
    )
    renderPage()

    // 🔴 The regression that shipped in `7e0b1a8`: the heading rendered over an
    // EMPTY list because two of these three reasons were filtered away.
    expect(await screen.findByText(/no longer sold/i)).toBeTruthy()
    expect(screen.getByText(/sold out/i)).toBeTruthy()
    expect(screen.getByText(/lower the quantity to 2/i)).toBeTruthy()
    expect(screen.getByText('withdrawn-one')).toBeTruthy()
  })
})
