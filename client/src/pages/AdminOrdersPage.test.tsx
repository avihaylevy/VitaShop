// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { AdminOrdersPage } from './AdminOrdersPage'

/**
 * MILESTONE-008 Checkpoint F3 — ISSUE-083's remaining half, on screen.
 */

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'o1',
    orderNumber: 'VS-20260813-ABC123',
    createdAt: '2026-08-13T10:00:00.000Z',
    status: 'paid',
    totalAmount: '230.00',
    customerEmail: 'shopper@example.test',
    itemCount: 2,
    allowedTransitions: ['processing', 'cancelled'],
    ...overrides,
  }
}

function page(orders: unknown[], overrides: Record<string, unknown> = {}) {
  return { page: 1, totalItems: orders.length, totalPages: 1, orders, ...overrides }
}

/**
 * The outcome text deliberately appears TWICE — once visibly in the row and
 * once in the screen-reader live region — so an assertion has to say which it
 * means. This scopes to the row.
 */
async function rowText(pattern: RegExp) {
  const items = await screen.findAllByRole('listitem')
  return within(items[0]!).findByText(pattern)
}

/** Answers the list, and whatever the PATCH should be. */
function routed(listBody: unknown, patch?: { status: number; body: unknown }) {
  const patches: { url: string; init: RequestInit }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        patches.push({ url: String(url), init })
        return {
          status: patch?.status ?? 200,
          json: async () => patch?.body ?? { orderId: 'o1', status: 'processing', changed: true, restoredStock: false },
        } as unknown as Response
      }
      return { status: 200, json: async () => listBody } as unknown as Response
    }),
  )
  return patches
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminOrdersPage />
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

describe('the list', () => {
  it('renders an order with its number, customer and total', async () => {
    routed(page([row()]))
    renderPage()
    expect(await screen.findByText('VS-20260813-ABC123')).toBeTruthy()
    expect(screen.getByText('shopper@example.test')).toBeTruthy()
  })

  it('🔴 offers exactly the moves the SERVER said are legal', async () => {
    routed(page([row({ status: 'shipped', allowedTransitions: ['delivered'] })]))
    renderPage()
    expect(await screen.findByRole('button', { name: /move to delivered/i })).toBeTruthy()
    // §8.9 has no shipped -> cancelled, and the screen must not invent one.
    expect(screen.queryByRole('button', { name: /move to cancelled/i })).toBeNull()
  })

  it('a TERMINAL order says so instead of rendering an empty row', async () => {
    routed(page([row({ status: 'delivered', allowedTransitions: [] })]))
    renderPage()
    expect(await screen.findByText(/no moves available/i)).toBeTruthy()
  })

  it('an empty list says so', async () => {
    routed(page([]))
    renderPage()
    expect(await screen.findByText(/no orders to show/i)).toBeTruthy()
  })

  it('🔴 counts ONE order in singular — the plural bug', async () => {
    // `"{{count}} orders"` rendered "1 orders". i18next needs suffixed keys,
    // and Hebrew needs four categories where English needs two.
    routed(page([row()]))
    renderPage()
    expect(await screen.findByText(/^one order$/i)).toBeTruthy()
  })
})

describe('🔴 the refusals an admin can act on', () => {
  it('403 says "administrators only" and offers NO retry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 403, json: async () => ({ error: { code: 'ADMIN_REQUIRED' } }) }) as unknown as Response))
    renderPage()
    expect(await screen.findByText(/administrators only/i)).toBeTruthy()
    // Pressing again cannot make an account an administrator.
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull()
  })

  it('401 offers a sign-in LINK, not the same sentence', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 401, json: async () => ({ error: { code: 'AUTHENTICATION_REQUIRED' } }) }) as unknown as Response))
    renderPage()
    expect(await screen.findByRole('link', { name: /go to sign in/i })).toBeTruthy()
  })

  it('🔴 THE CONTROL — an ordinary failure DOES offer the retry', async () => {
    // Without this, "no retry button" would pass against a page that had lost
    // the button everywhere.
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 503, json: async () => ({ error: { code: 'X' } }) }) as unknown as Response))
    renderPage()
    expect(await screen.findByRole('button', { name: /try again/i })).toBeTruthy()
  })
})

describe('moving an order', () => {
  it('PATCHes the target the button names', async () => {
    const patches = routed(page([row()]))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /move to picking/i }))
    await waitFor(() => expect(patches).toHaveLength(1))
    expect(JSON.parse(String(patches[0]!.init.body))).toEqual({ status: 'processing' })
  })

  it('reports the move, and says when stock came back', async () => {
    routed(page([row()]), {
      status: 200,
      body: { orderId: 'o1', status: 'cancelled', changed: true, restoredStock: true },
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /move to cancelled/i }))
    fireEvent.click(await screen.findByRole('button', { name: /yes, cancel it/i }))
    expect(await rowText(/stock was returned/i)).toBeTruthy()
  })

  describe('🔴 cancelling asks first — it is irreversible', () => {
    it('does NOT send the PATCH on the first click', async () => {
      const patches = routed(page([row()]))
      renderPage()
      fireEvent.click(await screen.findByRole('button', { name: /move to cancelled/i }))

      // `cancelled` is terminal in §8.9 and restores stock. There is no undo
      // anywhere in this system, and it sat beside "move to picking" at the
      // same size, separated only by colour.
      expect(await screen.findByText(/cannot be undone/i)).toBeTruthy()
      expect(patches).toHaveLength(0)
    })

    it('sends it once confirmed', async () => {
      const patches = routed(page([row()]), {
        status: 200,
        body: { orderId: 'o1', status: 'cancelled', changed: true, restoredStock: true },
      })
      renderPage()
      fireEvent.click(await screen.findByRole('button', { name: /move to cancelled/i }))
      fireEvent.click(await screen.findByRole('button', { name: /yes, cancel it/i }))
      await waitFor(() => expect(patches).toHaveLength(1))
      expect(JSON.parse(String(patches[0]!.init.body))).toEqual({ status: 'cancelled' })
    })

    it('backing out sends nothing and restores the buttons', async () => {
      const patches = routed(page([row()]))
      renderPage()
      fireEvent.click(await screen.findByRole('button', { name: /move to cancelled/i }))
      fireEvent.click(await screen.findByRole('button', { name: /^no$/i }))

      expect(await screen.findByRole('button', { name: /move to picking/i })).toBeTruthy()
      expect(patches).toHaveLength(0)
    })

    it('🔴 THE CONTROL — a NON-destructive move still goes on one click', async () => {
      // Without this, "asks first" would pass against a screen that had grown
      // a confirmation step for every button.
      const patches = routed(page([row()]))
      renderPage()
      fireEvent.click(await screen.findByRole('button', { name: /move to picking/i }))
      await waitFor(() => expect(patches).toHaveLength(1))
    })
  })

  describe('ISSUE-103 — shipping asks for a tracking number', () => {
    const processingRow = () => row({ status: 'processing', allowedTransitions: ['shipped', 'cancelled'] })

    it('does NOT send the PATCH on the first click — it opens the tracking question', async () => {
      const patches = routed(page([processingRow()]))
      renderPage()
      fireEvent.click(await screen.findByRole('button', { name: /move to shipped/i }))

      expect(await screen.findByLabelText(/tracking number \(optional\)/i)).toBeTruthy()
      expect(patches).toHaveLength(0)
    })

    it('🔴 a typed tracking number rides the PATCH body', async () => {
      const patches = routed(page([processingRow()]), {
        status: 200,
        body: { orderId: 'o1', status: 'shipped', changed: true, restoredStock: false },
      })
      renderPage()
      fireEvent.click(await screen.findByRole('button', { name: /move to shipped/i }))
      fireEvent.change(await screen.findByLabelText(/tracking number \(optional\)/i), {
        target: { value: ' RR123456789IL ' },
      })
      fireEvent.click(screen.getByRole('button', { name: /move to shipped/i }))

      await waitFor(() => expect(patches).toHaveLength(1))
      // Trimmed by the transport, so whitespace never reads as a value.
      expect(JSON.parse(String(patches[0]!.init.body))).toEqual({
        status: 'shipped',
        trackingNumber: 'RR123456789IL',
      })
    })

    it('confirming with the field EMPTY ships without one — REQ-F-047 says "where one exists"', async () => {
      const patches = routed(page([processingRow()]), {
        status: 200,
        body: { orderId: 'o1', status: 'shipped', changed: true, restoredStock: false },
      })
      renderPage()
      fireEvent.click(await screen.findByRole('button', { name: /move to shipped/i }))
      fireEvent.click(screen.getByRole('button', { name: /move to shipped/i }))

      await waitFor(() => expect(patches).toHaveLength(1))
      // 🔴 No `trackingNumber` key AT ALL — an empty string would be a 400.
      expect(JSON.parse(String(patches[0]!.init.body))).toEqual({ status: 'shipped' })
    })

    it('backing out sends nothing and restores the buttons', async () => {
      const patches = routed(page([processingRow()]))
      renderPage()
      fireEvent.click(await screen.findByRole('button', { name: /move to shipped/i }))
      fireEvent.click(await screen.findByRole('button', { name: /^back$/i }))

      expect(await screen.findByRole('button', { name: /move to cancelled/i })).toBeTruthy()
      expect(screen.queryByLabelText(/tracking number/i)).toBeNull()
      expect(patches).toHaveLength(0)
    })

    it('🔴 opening the tracking question moves focus TO the input — the pressed trigger unmounts', async () => {
      // The unmount-on-action family from browser-verification.md: without a
      // deliberate move, focus fell to <body> and the admin tabbed from the
      // top of the document to reach the field they were just asked to fill.
      routed(page([processingRow()]))
      renderPage()
      fireEvent.click(await screen.findByRole('button', { name: /move to shipped/i }))

      const input = await screen.findByLabelText(/tracking number \(optional\)/i)
      expect(document.activeElement).toBe(input)
    })

    it('🔴 backing out returns focus to the re-rendered ship trigger', async () => {
      routed(page([processingRow()]))
      renderPage()
      fireEvent.click(await screen.findByRole('button', { name: /move to shipped/i }))
      fireEvent.click(await screen.findByRole('button', { name: /^back$/i }))

      const trigger = await screen.findByRole('button', { name: /move to shipped/i })
      expect(document.activeElement).toBe(trigger)
    })

    it('🔴 confirming lands focus on the ROW — the whole panel unmounts', async () => {
      routed(page([processingRow()]), {
        status: 200,
        body: { orderId: 'o1', status: 'shipped', changed: true, restoredStock: false },
      })
      renderPage()
      fireEvent.click(await screen.findByRole('button', { name: /move to shipped/i }))
      fireEvent.click(screen.getByRole('button', { name: /move to shipped/i }))

      const rows = await screen.findAllByRole('listitem')
      await waitFor(() => expect(document.activeElement).toBe(rows[0]))
    })

    it('a STALE draft never leaks into the next order — reopening starts empty', async () => {
      const patches = routed(page([processingRow()]))
      renderPage()
      fireEvent.click(await screen.findByRole('button', { name: /move to shipped/i }))
      fireEvent.change(await screen.findByLabelText(/tracking number \(optional\)/i), {
        target: { value: 'STALE-1' },
      })
      fireEvent.click(await screen.findByRole('button', { name: /^back$/i }))
      fireEvent.click(await screen.findByRole('button', { name: /move to shipped/i }))

      const input = (await screen.findByLabelText(/tracking number \(optional\)/i)) as HTMLInputElement
      expect(input.value).toBe('')
      expect(patches).toHaveLength(0)
    })
  })

  it('🔴 a second row cannot be re-enabled by the FIRST row-s response', async () => {
    // `setBusyRow(null)` cleared whichever row was busy rather than the one
    // that finished, so B's buttons came back while B's PATCH was in flight —
    // one more click, one duplicate PATCH.
    const release: { fn: () => void } = { fn: () => {} }
    const slow = new Promise<void>((resolve) => {
      release.fn = resolve
    })
    let patchCount = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'PATCH') {
          patchCount += 1
          // 🔴 The FIRST patch is row B's, because B is clicked first — an
          // earlier version delayed the second and therefore delayed the wrong
          // row, so the assertion was measuring nothing.
          if (patchCount === 1) await slow
          return { status: 200, json: async () => ({ orderId: 'x', status: 'processing', changed: true, restoredStock: false }) } as unknown as Response
        }
        return {
          status: 200,
          json: async () => page([row(), row({ id: 'o2', orderNumber: 'VS-20260813-SECOND' })]),
        } as unknown as Response
      }),
    )
    renderPage()
    const buttons = await screen.findAllByRole('button', { name: /move to picking/i })
    fireEvent.click(buttons[1]!) // row B — its response is the slow one
    fireEvent.click(buttons[0]!) // row A — resolves first

    await waitFor(() => expect(patchCount).toBe(2))
    // B is still in flight, so B's button must still be disabled.
    const after = await screen.findAllByRole('button', { name: /move to picking/i })
    expect((after[1] as HTMLButtonElement).disabled).toBe(true)
    release.fn()
  })

  it('🔴 the refresh after a move is QUIET — no loading screen, row stays put', async () => {
    /*
     * A loud reload sets the page to `loading`, which unmounts the whole list:
     * the button just pressed disappears, focus drops to <body>, and a
     * keyboard user tabs from the top of the document for every order.
     *
     * ⚠️ THE SECOND LIST FETCH IS DELIBERATELY SLOW. An earlier version of
     * this test let it resolve instantly and asserted element identity — and
     * it passed with the fix REMOVED, because React reconciled loading→ready
     * inside one flush and reused the same nodes. The difference only exists
     * while the reload is in flight, so the test has to look during it.
     */
    const release: { fn: () => void } = { fn: () => {} }
    const slowList = new Promise<void>((resolve) => {
      release.fn = resolve
    })
    let listCalls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'PATCH') {
          return { status: 200, json: async () => ({ orderId: 'o1', status: 'processing', changed: true, restoredStock: false }) } as unknown as Response
        }
        /*
         * ⚠️ THE STUCK-ORDER COUNT IS NOT A LIST CALL. Checkpoint G3 added a
         * second GET on mount (ISSUE-082's read half, DEC-069), and these
         * fixtures counted EVERY non-PATCH request — so the counter meant
         * something different from what its name said and both tests broke.
         * Answered separately and left out of the count.
         */
        if (String(url).includes('/stuck')) {
          return { status: 200, json: async () => ({ count: 0, orders: [] }) } as unknown as Response
        }
        listCalls += 1
        if (listCalls === 2) await slowList
        return { status: 200, json: async () => page([row()]) } as unknown as Response
      }),
    )

    renderPage()
    const item = (await screen.findAllByRole('listitem'))[0]!
    fireEvent.click(screen.getByRole('button', { name: /move to picking/i }))

    // The reload is now in flight and will not answer until released.
    await waitFor(() => expect(listCalls).toBe(2))

    expect(screen.queryByText(/loading orders/i)).toBeNull()
    expect(document.body.contains(item)).toBe(true)
    release.fn()
  })

  it('🔴 announces a SECOND identical result — the live-region bail-out', async () => {
    /*
     * Two orders moved to the same status produce the same sentence. React
     * bails out on identical text, the DOM never changes, and `aria-live`
     * never fires — so a screen-reader admin hears about the first order and
     * nothing after it.
     */
    routed(page([row(), row({ id: 'o2', orderNumber: 'VS-20260813-SECOND' })]))
    renderPage()
    const buttons = await screen.findAllByRole('button', { name: /move to picking/i })

    fireEvent.click(buttons[0]!)
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/moved to/i))
    const first = screen.getByRole('status').textContent

    fireEvent.click((await screen.findAllByRole('button', { name: /move to picking/i }))[1]!)
    // The TEXT must differ from last time, or nothing is announced.
    await waitFor(() => expect(screen.getByRole('status').textContent).not.toBe(first))
  })

  it('offers a REFRESH once loaded, since four failures tell the admin to refresh', async () => {
    routed(page([row()]))
    renderPage()
    expect(await screen.findByRole('button', { name: /refresh the list/i })).toBeTruthy()
  })

  it('renders the order date, so the newest-first ordering is visible', async () => {
    routed(page([row()]))
    renderPage()
    expect(await screen.findByText(/placed/i)).toBeTruthy()
  })

  it('a 429 says to wait rather than reading as a server fault', async () => {
    routed(page([row()]), { status: 429, body: { error: { code: 'TOO_MANY_REQUESTS' } } })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /move to picking/i }))
    expect(await rowText(/too many actions/i)).toBeTruthy()
  })

  it('announces the result through a live region that was already present', async () => {
    routed(page([row()]))
    renderPage()
    // Present from first render — a region inserted WITH its text is commonly
    // not announced at all.
    const region = screen.getByRole('status')
    expect(region.textContent).toBe('')
    fireEvent.click(await screen.findByRole('button', { name: /move to picking/i }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/moved to/i))
  })

  it('🔴 RELOADS the list after a move, so stale buttons cannot linger', async () => {
    // The row's allowed moves were computed for the status it HAD. Leaving
    // them on screen offers moves that now 409.
    let listCalls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'PATCH') {
          return { status: 200, json: async () => ({ orderId: 'o1', status: 'processing', changed: true, restoredStock: false }) } as unknown as Response
        }
        /*
         * ⚠️ THE STUCK-ORDER COUNT IS NOT A LIST CALL. Checkpoint G3 added a
         * second GET on mount (ISSUE-082's read half, DEC-069), and these
         * fixtures counted EVERY non-PATCH request — so the counter meant
         * something different from what its name said and both tests broke.
         * Answered separately and left out of the count.
         */
        if (String(url).includes('/stuck')) {
          return { status: 200, json: async () => ({ count: 0, orders: [] }) } as unknown as Response
        }
        listCalls += 1
        return { status: 200, json: async () => page([row()]) } as unknown as Response
      }),
    )
    renderPage()
    await screen.findByRole('button', { name: /move to picking/i })
    expect(listCalls).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: /move to picking/i }))
    await waitFor(() => expect(listCalls).toBe(2))
  })

  it.each([
    ['TERMINAL', /already complete/i],
    ['NOT_A_TRANSITION', /changed status since the list loaded/i],
    ['CONCURRENT_TRANSITION', /someone else updated/i],
  ])('🔴 409 %s gets its own sentence', async (code, expected) => {
    routed(page([row()]), { status: 409, body: { error: { code } } })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /move to picking/i }))
    expect(await rowText(expected)).toBeTruthy()
  })

  it('a 404 says the list is out of date rather than reporting a fault', async () => {
    routed(page([row()]), { status: 404, body: { error: { code: 'ORDER_NOT_FOUND' } } })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /move to picking/i }))
    expect(await rowText(/list may be out of date/i)).toBeTruthy()
  })

  it('an unchanged move says so rather than claiming a change', async () => {
    routed(page([row()]), {
      status: 200,
      body: { orderId: 'o1', status: 'processing', changed: false, restoredStock: false },
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /move to picking/i }))
    expect(await rowText(/already in that status/i)).toBeTruthy()
  })
})

describe('Hebrew', () => {
  it('labels the buttons with the Hebrew status names from F0', async () => {
    await i18n.changeLanguage('he')
    routed(page([row()]))
    renderPage()
    // `processing` is בליקוט — the specification's own word, shared with the
    // checkout confirmation and, later, order history.
    expect(await screen.findByRole('button', { name: /בליקוט/ })).toBeTruthy()
  })
})
