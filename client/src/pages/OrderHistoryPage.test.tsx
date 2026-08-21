// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { OrderHistoryPage } from './OrderHistoryPage'

/**
 * MILESTONE-008 Checkpoint G2 — REQ-F-050's history, and the first UI the
 * shopper-cancel route has ever had.
 *
 * 🔴 THE CANCEL CONTROL IS THE RISK HERE. `cancelled` is terminal in §8.9, it
 * restores stock, and nothing in this system has an undo — so the tests that
 * matter are the ones about asking first and about keeping the three refusals
 * apart, not the ones about rendering a list.
 */

const ITEM = {
  productId: 'p1',
  slug: 'magnesium-citrate',
  nameHe: 'מגנזיום ציטראט',
  nameEn: 'Magnesium Citrate',
  quantity: 2,
  unitPrice: '95.00',
}

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 'o1',
    orderNumber: 'VS-20260814-ABC123',
    // Yesterday, RELATIVE to the test run — a fixed date would silently age
    // past the 10-day cancel window and start hiding the cancel button.
    createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    status: 'paid',
    // 🔴 SERVER-COMPUTED in production (status + the 10-day window). The
    // page renders this flag and owns no policy; tests set it per case.
    cancellable: true,
    totalAmount: '220.00',
    shippingCost: '30.00',
    deliveryMethod: 'courier',
    items: [ITEM],
    ...overrides,
  }
}

/** Answers the history GET, and records every cancel POST. */
function routed(history: unknown, cancelAnswer?: () => Promise<Response>) {
  const cancels: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        cancels.push(String(url))
        return (
          (await cancelAnswer?.()) ??
          ({
            status: 200,
            json: async () => ({ orderId: 'o1', status: 'cancelled', alreadyCancelled: false, restoredStock: true }),
          } as unknown as Response)
        )
      }
      return { status: 200, json: async () => history } as unknown as Response
    }),
  )
  return cancels
}

function renderHistory() {
  return render(
    <MemoryRouter>
      <OrderHistoryPage />
    </MemoryRouter>,
  )
}

beforeEach(async () => {
  vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000')
  /*
   * ⚠️ jsdom HAS NO `matchMedia`, and `usePresence` (CenterDialog's motion
   * handling) calls it on the success dialog's close path — the
   * useAddToCart.test.tsx pattern, required since the cancelled-order
   * dialog moved onto CenterDialog.
   */
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }))
  await i18n.changeLanguage('en')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('the order history', () => {
  it('renders the order with its status label and item breakdown — REQ-F-050', async () => {
    routed({ orders: [order()] })
    renderHistory()

    expect(await screen.findByText('VS-20260814-ABC123')).toBeTruthy()
    // The label comes from F0's `orders` namespace, never the raw wire status.
    expect(screen.queryByText('Received')).toBeTruthy()
    expect(screen.queryByText('paid')).toBeNull()
    expect(screen.queryByText('Magnesium Citrate')).toBeTruthy()
  })

  it('a LANGUAGE SWITCH re-renders the frozen names without re-requesting', async () => {
    const fetchMock = vi.fn(async () => ({ status: 200, json: async () => ({ orders: [order()] }) }) as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
    renderHistory()

    await screen.findByText('Magnesium Citrate')
    const before = fetchMock.mock.calls.length

    await act(async () => {
      await i18n.changeLanguage('he')
    })

    expect(await screen.findByText('מגנזיום ציטראט')).toBeTruthy()
    expect(fetchMock.mock.calls.length).toBe(before)
  })

  it('says so when there are no orders, and offers somewhere to go', async () => {
    routed({ orders: [] })
    renderHistory()
    expect(await screen.findByText(/have not placed any orders/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: /browse the catalogue/i }).getAttribute('href')).toBe('/catalog')
  })

  it('🔴 offers NO Retry on a 429 — waiting fixes it, pressing again does not', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 429, json: async () => ({}) }) as unknown as Response))
    renderHistory()

    await screen.findByText(/too many requests/i)
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull()
  })

  it('🔴 the Retry button STAYS MOUNTED while the retry runs, and re-requests', async () => {
    // ISSUE-098 again: rendering it only for `failed` meant pressing it
    // unmounted the focused button and dropped focus to <body> — fixed on the
    // home page one commit before this file existed, and repeated here.
    let attempt = 0
    let resolveSecond: (value: Response) => void = () => {}
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
    renderHistory()

    fireEvent.click(await screen.findByRole('button', { name: /try again/i }))

    const inFlight = screen.getByRole('button', { name: /try again/i })
    expect(inFlight.hasAttribute('disabled')).toBe(false)
    expect(inFlight.getAttribute('aria-disabled')).toBe('true')

    await act(async () => {
      resolveSecond({ status: 200, json: async () => ({ orders: [order()] }) } as unknown as Response)
    })
    expect(await screen.findByText('VS-20260814-ABC123')).toBeTruthy()
    expect(attempt).toBe(2)
  })

  it('🔴 a SECOND Retry press while one is in flight sends NOTHING', async () => {
    /*
     * ⚠️ THIS REPLACED A TEST THAT COULD NOT FAIL. The first version drove two
     * overlapping loads to prove the request-id guard, and the third fetch
     * never happened — because the in-flight click guard makes overlapping
     * retries UNREACHABLE from the UI. Writing the test is what showed that;
     * the guard being tested was the wrong one.
     *
     * The request-id guard in `load()` stays as defence against a response
     * landing after the shopper has navigated away, which this suite cannot
     * observe. What IS observable, and what protects the server, is this.
     */
    let attempt = 0
    let resolveSecond: (value: Response) => void = () => {}
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
    renderHistory()

    fireEvent.click(await screen.findByRole('button', { name: /try again/i }))
    expect(attempt).toBe(2)

    // Still mounted, still focusable, and inert while the request runs.
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(attempt).toBe(2)

    await act(async () => {
      resolveSecond({ status: 200, json: async () => ({ orders: [order()] }) } as unknown as Response)
    })
    await screen.findByText('VS-20260814-ABC123')
  })

  it('🔴 offers a SIGN-IN LINK rather than a Retry when the session is gone', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 401, json: async () => ({}) }) as unknown as Response))
    renderHistory()

    expect(await screen.findByText(/sign in to see your orders/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: /sign in/i }).getAttribute('href')).toBe('/login')
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull()
  })

  it('🔴 THE CONTROL — an ordinary failure DOES offer Retry', async () => {
    // Without this, "no retry on 429" would pass against a screen that never
    // renders a retry button at all.
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 503, json: async () => ({}) }) as unknown as Response))
    renderHistory()

    await screen.findByText(/could not be loaded/i)
    expect(screen.queryByRole('button', { name: /try again/i })).toBeTruthy()
  })
})

describe('cancelling an order', () => {
  it('🔴 ASKS FIRST — the button alone sends nothing', async () => {
    /*
     * `cancelled` is terminal, restores stock, and has no undo. A cancel that
     * fires on one click is one misclick from destroying a real order — the
     * finding that produced the admin screen's confirmation, applied here
     * before it could be found again.
     */
    const cancels = routed({ orders: [order()] })
    renderHistory()

    fireEvent.click(await screen.findByRole('button', { name: /^cancel order$/i }))
    expect(cancels).toEqual([]) // nothing sent yet
    expect(screen.getByText(/cannot be undone/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /yes, cancel it/i }))
    await waitFor(() => expect(cancels).toHaveLength(1))
    expect(cancels[0]).toContain('/api/orders/o1/cancel')
  })

  it('backing out sends nothing and leaves the order alone', async () => {
    const cancels = routed({ orders: [order()] })
    renderHistory()

    fireEvent.click(await screen.findByRole('button', { name: /^cancel order$/i }))
    fireEvent.click(screen.getByRole('button', { name: /keep the order/i }))

    expect(cancels).toEqual([])
    expect(screen.queryByText(/cannot be undone/i)).toBeNull()
    expect(screen.getByRole('button', { name: /^cancel order$/i })).toBeTruthy()
  })

  it('🔴 keeps the three refusals APART — they lead to three different moves', async () => {
    // forbidden -> call us · terminal -> nothing to cancel · concurrent -> refresh
    for (const [status, code, expected] of [
      [403, 'FORBIDDEN_FOR_ACTOR', /already being prepared/i],
      [409, 'TERMINAL', /already complete/i],
      [409, 'CONCURRENT_TRANSITION', /changed while you were looking/i],
      // The user's twelfth list — the 10-day window refusal is its own answer.
      [409, 'CANCEL_WINDOW_PASSED', /delivery window has passed/i],
    ] as const) {
      routed({ orders: [order()] }, async () => ({ status, json: async () => ({ error: { code } }) }) as unknown as Response)
      renderHistory()

      fireEvent.click(await screen.findByRole('button', { name: /^cancel order$/i }))
      fireEvent.click(screen.getByRole('button', { name: /yes, cancel it/i }))

      /*
       * 🔴 TWICE, AND BOTH ARE REQUIRED: once visibly in the row, once in the
       * page's always-mounted `sr-only` live region. The row text is what a
       * sighted shopper reads; the live region is what is SPOKEN, and it is
       * separate because a region inserted together with its text is
       * unreliably announced.
       */
      const spoken = await screen.findAllByText(expected)
      expect(spoken.length).toBe(2)
      expect(spoken.some((node) => node.className.includes('sr-only'))).toBe(true)
      cleanup()
    }
  })

  it('🔴 the in-flight CONFIRM button is aria-disabled, NEVER disabled', async () => {
    /*
     * 🔴 ON THE ONE IRREVERSIBLE ACTION THIS SCREEN HAS. A `disabled` attribute
     * landing on the focused element makes the browser BLUR it, and the confirm
     * block then unmounts — so a keyboard user who confirms a cancellation
     * loses focus to <body> and never gets it back. jsdom does not model that
     * blur (ISSUE-098 measured it in Chromium), so the ATTRIBUTE is what this
     * assertion can see — and it goes red the moment `disabled` returns.
     */
    let resolveCancel: (value: Response) => void = () => {}
    routed({ orders: [order()] }, () => new Promise<Response>((resolve) => {
      resolveCancel = resolve
    }))
    renderHistory()

    fireEvent.click(await screen.findByRole('button', { name: /^cancel order$/i }))
    fireEvent.click(screen.getByRole('button', { name: /yes, cancel it/i }))

    const confirm = screen.getByRole('button', { name: /yes, cancel it/i })
    expect(confirm.hasAttribute('disabled')).toBe(false)
    expect(confirm.getAttribute('aria-disabled')).toBe('true')

    await act(async () => {
      resolveCancel({
        status: 200,
        json: async () => ({ orderId: 'o1', status: 'cancelled', alreadyCancelled: false, restoredStock: true }),
      } as unknown as Response)
    })
  })

  it('🔴 an ALREADY-cancelled order reads as done, not as an error', async () => {
    routed(
      { orders: [order()] },
      async () =>
        ({
          status: 200,
          json: async () => ({ orderId: 'o1', status: 'cancelled', alreadyCancelled: true, restoredStock: false }),
        }) as unknown as Response,
    )
    renderHistory()

    fireEvent.click(await screen.findByRole('button', { name: /^cancel order$/i }))
    fireEvent.click(screen.getByRole('button', { name: /yes, cancel it/i }))

    // A success (even the already-done kind) speaks through the DIALOG —
    // the page's live region would be inert under it (review).
    const dialog = await screen.findByRole('dialog', { name: /order cancelled/i })
    expect(dialog.textContent).toMatch(/was already cancelled/i)
  })

  it('🔴 offers no cancel control once fulfilment has begun', async () => {
    // §8.9 stops a shopper at `paid`; the SERVER computes that into the
    // row's `cancellable` flag and the screen renders it.
    routed({ orders: [order({ status: 'shipped', cancellable: false })] })
    renderHistory()

    await screen.findByText('VS-20260814-ABC123')
    expect(screen.queryByRole('button', { name: /^cancel order$/i })).toBeNull()
  })

  it('🔴 THE CONTROL — a cancellable order DOES offer it', async () => {
    routed({ orders: [order({ status: 'pending_payment' })] })
    renderHistory()

    await screen.findByText('VS-20260814-ABC123')
    expect(screen.queryByRole('button', { name: /^cancel order$/i })).toBeTruthy()
  })

  it("🔴 the user's twelfth list — no cancel control past the 10-day window", async () => {
    // Eleven days old, still `paid` — the SERVER computes cancellable:false
    // for it (the window on its own clock) and the screen honours the flag.
    const eleven = new Date(Date.now() - 11 * 24 * 60 * 60 * 1000).toISOString()
    routed({ orders: [order({ createdAt: eleven, cancellable: false })] })
    renderHistory()

    await screen.findByText('VS-20260814-ABC123')
    expect(screen.queryByRole('button', { name: /^cancel order$/i })).toBeNull()
  })

  it("🔴 the user's twelfth list — success opens a DIALOG and the order leaves the list", async () => {
    /*
     * The server no longer lists cancelled orders, so the row unmounts on the
     * post-cancel reload — the confirmation must therefore live in a dialog,
     * not in a line beside a row that has just disappeared.
     */
    let cancelled = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          cancelled = true
          return {
            status: 200,
            json: async () => ({ orderId: 'o1', status: 'cancelled', alreadyCancelled: false, restoredStock: true }),
          } as unknown as Response
        }
        return {
          status: 200,
          json: async () => ({ orders: cancelled ? [] : [order()] }),
        } as unknown as Response
      }),
    )
    // Rendered into a real #root: useReturnFocus only accepts a return
    // target that lives inside it, exactly like the app.
    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)
    render(
      <MemoryRouter>
        <OrderHistoryPage />
      </MemoryRouter>,
      { container: root },
    )

    fireEvent.click(await screen.findByRole('button', { name: /^cancel order$/i }))
    fireEvent.click(screen.getByRole('button', { name: /yes, cancel it/i }))

    const dialog = await screen.findByRole('dialog', { name: /order cancelled/i })
    expect(dialog.textContent).toMatch(/was cancelled successfully/i)
    // The cancelled order is GONE from the list, not re-rendered as a
    // cancelled row.
    await waitFor(() => expect(screen.queryByText('VS-20260814-ABC123')).toBeNull())

    // Closing lands focus somewhere deliberate — the heading — because the
    // confirm button that opened the dialog unmounted with its row. The
    // restore is microtask-deferred (inert must lift first), so awaited.
    fireEvent.click(screen.getByRole('button', { name: /^ok$/i }))
    // CenterDialog stays mounted through its exit animation (usePresence);
    // jsdom fires no transitionend, so the fallback timer unmounts it.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const heading = screen.getByRole('heading', { name: /my orders/i })
    await waitFor(() => expect(document.activeElement).toBe(heading))
    root.remove()
  })
})
