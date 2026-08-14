// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { OrderDetailPage } from './OrderDetailPage'

/**
 * MILESTONE-008 Checkpoint G2 — one order, and the only consumer of
 * `GET /api/orders/:id`.
 *
 * 🔴 THE TWO THAT MATTER: a self-pickup order has NO address and must say so
 * rather than render a blank, and "not found" is ONE message. DEC-070 made an
 * order that does not exist byte-identical to one belonging to somebody else,
 * and a screen that split them would rebuild the enumeration oracle in the UI.
 */

const DETAIL = {
  id: 'o1',
  orderNumber: 'VS-20260814-ABC123',
  createdAt: '2026-08-14T10:00:00.000Z',
  status: 'shipped',
  totalAmount: '220.00',
  shippingCost: '30.00',
  deliveryMethod: 'courier',
  items: [
    {
      productId: 'p1',
      slug: 'magnesium-citrate',
      nameHe: 'מגנזיום ציטראט',
      nameEn: 'Magnesium Citrate',
      quantity: 2,
      unitPrice: '95.00',
    },
  ],
  trackingNumber: 'TRK-1',
  shippingAddress: { line1: 'רחוב הרצל 1', city: 'תל אביב', zipCode: '6100000' },
}

function respond(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ status, json: async () => body }) as unknown as Response))
}

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={['/account/orders/o1']}>
      <Routes>
        <Route path="/account/orders/:id" element={<OrderDetailPage />} />
      </Routes>
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

describe('one order', () => {
  it('renders the frozen address, the tracking number and the breakdown', async () => {
    respond(200, DETAIL)
    renderDetail()

    expect(await screen.findByText(/VS-20260814-ABC123/)).toBeTruthy()
    expect(screen.getByText(/רחוב הרצל 1/)).toBeTruthy()
    expect(screen.getByText('TRK-1')).toBeTruthy()
    expect(screen.getByText('Magnesium Citrate')).toBeTruthy()
  })

  it('🔴 a SELF-PICKUP order says there is no address, rather than rendering a blank', async () => {
    respond(200, { ...DETAIL, deliveryMethod: 'self_pickup', shippingAddress: null, trackingNumber: null })
    renderDetail()

    expect(await screen.findByText(/self pickup/i)).toBeTruthy()
    // And the missing tracking number is STATED — REQ-F-047 asks for one "where
    // one exists", so most orders have none for most of their life.
    expect(screen.getByText(/no tracking number yet/i)).toBeTruthy()
  })

  it('🔴 THE CONTROL — a courier order still shows its address', async () => {
    // Without this, "says self pickup" would pass against a screen that never
    // renders an address at all.
    respond(200, DETAIL)
    renderDetail()

    expect(await screen.findByText(/תל אביב/)).toBeTruthy()
    expect(screen.queryByText(/self pickup/i)).toBeNull()
  })

  it('🔴 a 404 is ONE message — the screen never says whose order it is', async () => {
    respond(404, { error: { code: 'ORDER_NOT_FOUND' } })
    renderDetail()

    const message = await screen.findByText(/could not be found/i)
    expect(message.getAttribute('role')).toBe('status')
    // Nothing anywhere may hint that the order exists but belongs to someone.
    expect(document.body.textContent).not.toMatch(/not yours|another|forbidden|permission/i)
  })

  it('🔴 THE RETRY BUTTON ACTUALLY RETRIES — it did not, and nothing tested it', async () => {
    /*
     * 🔴 THE HIGH FINDING OF THE G2 REVIEW. `onClick` set the state to loading
     * and nothing else: the fetch lives in an effect keyed on the order id,
     * which does not change when the SAME order is retried. So the error
     * cleared, the button vanished, and the page sat on "Loading the order…"
     * forever — recoverable only by a full page reload.
     *
     * ⚠️ NO TEST TOUCHED THE BUTTON, which is exactly why the suite was green.
     */
    let attempt = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        attempt += 1
        return attempt === 1
          ? ({ status: 503, json: async () => ({}) } as unknown as Response)
          : ({ status: 200, json: async () => DETAIL } as unknown as Response)
      }),
    )
    renderDetail()

    fireEvent.click(await screen.findByRole('button', { name: /try again/i }))

    expect(await screen.findByText(/VS-20260814-ABC123/)).toBeTruthy()
    expect(attempt).toBe(2)
  })

  it('🔴 the Retry button STAYS MOUNTED while the retry runs — ISSUE-098', async () => {
    // A button that unmounts under the shopper drops keyboard focus to <body>.
    // Kept mounted and `aria-disabled` instead; the attribute is what jsdom can
    // see, and `disabled` would blur it in a real browser.
    let resolveSecond: (value: Response) => void = () => {}
    let attempt = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        attempt += 1
        if (attempt === 1) return { status: 503, json: async () => ({}) } as unknown as Response
        return new Promise<Response>((resolve) => {
          resolveSecond = resolve
        })
      }),
    )
    renderDetail()

    fireEvent.click(await screen.findByRole('button', { name: /try again/i }))

    const inFlight = screen.getByRole('button', { name: /try again/i })
    expect(inFlight.hasAttribute('disabled')).toBe(false)
    expect(inFlight.getAttribute('aria-disabled')).toBe('true')

    await act(async () => {
      resolveSecond({ status: 200, json: async () => DETAIL } as unknown as Response)
    })
    await screen.findByText(/VS-20260814-ABC123/)
  })

  it('🔴 offers a SIGN-IN LINK rather than a Retry when the session is gone', async () => {
    // `requireActiveShopper` destroys the session and answers 401 for a gone or
    // disabled account, so a Retry there can only 401 forever — the dead-end
    // refusal ISSUE-080 recorded.
    respond(401, { error: { code: 'AUTHENTICATION_REQUIRED' } })
    renderDetail()

    expect(await screen.findByText(/sign in to see your orders/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: /sign in/i }).getAttribute('href')).toBe('/login')
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull()
  })

  it('offers a way back to the history', async () => {
    respond(200, DETAIL)
    renderDetail()

    expect((await screen.findByRole('link', { name: /back to orders/i })).getAttribute('href')).toBe(
      '/account/orders',
    )
  })
})
