// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { AdminOrdersPage } from './AdminOrdersPage'

/**
 * MILESTONE-008 Checkpoint G3 — ISSUE-082's trigger on the admin screen.
 * DEC-069.
 *
 * 🔴 THE REPAIR MARKS ORDERS PAID, in a batch, with no per-order review. So the
 * tests that matter are: it asks first, it does not run on load, and the count
 * beside it comes from the READ — which changes nothing and is therefore safe
 * to fire without being asked.
 */

const ORDER = {
  id: 'o1',
  orderNumber: 'VS-20260814-ABC123',
  createdAt: '2026-08-14T10:00:00.000Z',
  status: 'paid',
  totalAmount: '230.00',
  customerEmail: 'shopper@example.test',
  itemCount: 2,
  allowedTransitions: ['processing', 'cancelled'],
}

const PAGE = { page: 1, totalItems: 1, totalPages: 1, orders: [ORDER] }

/**
 * Answers the list, the stuck count and the repair; records every POST.
 *
 * 🔴 THE COUNT DROPS TO ZERO ONCE THE REPAIR HAS RUN, and that is the whole
 * reason this fixture was rewritten. The first version answered the SAME count
 * forever, so the post-repair refresh could never change anything — which made
 * the panel's disappearance UNREACHABLE in tests, and the one case that was
 * broken in production (a fully successful sweep) was the one case no test
 * covered. Found in review.
 */
function routed(stuckCount: number, repair?: () => Promise<Response>) {
  const posts: string[] = []
  let repaired = false
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url)
      if (init?.method === 'POST') {
        posts.push(path)
        const answer =
          (await repair?.()) ??
          ({
            status: 200,
            json: async () => ({ examined: 2, repaired: 2, failed: [], remaining: 0 }),
          } as unknown as Response)
        repaired = true
        return answer
      }
      if (path.includes('/stuck')) {
        return {
          status: 200,
          json: async () => ({
            count: repaired ? 0 : stuckCount,
            orders: Array.from({ length: repaired ? 0 : stuckCount }, (_, index) => ({
              id: `s${index}`,
              orderNumber: `VS-STUCK-${index}`,
              createdAt: '2026-08-14T09:00:00.000Z',
            })),
          }),
        } as unknown as Response
      }
      return { status: 200, json: async () => PAGE } as unknown as Response
    }),
  )
  return posts
}

function renderAdmin() {
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

describe('the stuck-order trigger', () => {
  it('🔴 NEVER runs the repair on load — only the safe count', async () => {
    /*
     * The whole hazard of this feature. `reconcileStuckOrders` marks orders
     * PAID; a page that swept on mount would settle orders every time an admin
     * opened the queue, with nobody having asked for it.
     */
    const posts = routed(2)
    renderAdmin()

    expect(await screen.findByText(/2 orders have been awaiting payment/i)).toBeTruthy()
    expect(posts).toEqual([])
  })

  it('🔴 ASKS FIRST, and the question names what will happen', async () => {
    const posts = routed(2)
    renderAdmin()

    fireEvent.click(await screen.findByRole('button', { name: /repair stuck orders/i }))
    expect(posts).toEqual([]) // still nothing sent
    expect(screen.getByText(/marks the stuck orders as paid/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /yes, repair them/i }))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).toContain('/api/admin/orders/reconcile')
  })

  it('backing out sends nothing', async () => {
    const posts = routed(2)
    renderAdmin()

    fireEvent.click(await screen.findByRole('button', { name: /repair stuck orders/i }))
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))

    expect(posts).toEqual([])
    expect(screen.queryByText(/marks the stuck orders as paid/i)).toBeNull()
  })

  it('shows NOTHING when no order is stuck', async () => {
    // The control: without it, "the banner appears" would pass against a screen
    // that showed the repair button unconditionally.
    routed(0)
    renderAdmin()

    await screen.findByText('VS-20260814-ABC123')
    expect(screen.queryByRole('button', { name: /repair stuck orders/i })).toBeNull()
  })

  it('🔴 reports a PARTIAL repair as a partial repair, not as success', async () => {
    // `failed` carries the orders the table or the write refused. Reporting
    // only the repaired count would hide which ones are still stuck.
    routed(3, async () =>
      ({
        status: 200,
        json: async () => ({
          examined: 3,
          repaired: 1,
          failed: [
            { orderNumber: 'VS-STUCK-1', reason: 'CONCURRENT_TRANSITION' },
            { orderNumber: 'VS-STUCK-2', reason: 'TERMINAL' },
          ],
          remaining: 2,
        }),
      }) as unknown as Response,
    )
    renderAdmin()

    fireEvent.click(await screen.findByRole('button', { name: /repair stuck orders/i }))
    fireEvent.click(screen.getByRole('button', { name: /yes, repair them/i }))

    /*
     * TWICE: visibly beside the banner, and in the page's always-mounted
     * `sr-only` live region. Both are required — the second is what is SPOKEN,
     * and the nonce beside it is what makes two identical reports announce
     * twice rather than once.
     */
    const spoken = await screen.findAllByText(/1 repaired, 2 failed/i)
    expect(spoken.length).toBe(2)
    expect(spoken.some((node) => node.className.includes('sr-only'))).toBe(true)
  })

  it('🔴 A FULLY SUCCESSFUL SWEEP STILL SHOWS ITS REPORT — the panel must not vanish', async () => {
    /*
     * 🔴 THE HIGH FINDING OF THE G3 REVIEW, and the case no test covered. The
     * panel was gated on `count > 0`; a successful repair refreshed the count
     * to ZERO, so the whole section unmounted — taking the "2 orders repaired"
     * line with it, and the focused confirm button too, dropping focus to
     * <body>. ISSUE-098 for the THIRD time, in the commit whose own test was
     * written to prevent it.
     *
     * ⚠️ A PARTIAL repair survived, because the count stayed above zero. That
     * is exactly why the defect looked fine in testing.
     */
    routed(2)
    renderAdmin()

    fireEvent.click(await screen.findByRole('button', { name: /repair stuck orders/i }))
    fireEvent.click(screen.getByRole('button', { name: /yes, repair them/i }))

    const reported = await screen.findAllByText(/2 orders repaired/i)
    expect(reported.length).toBe(2) // visible, and spoken
    expect(reported.some((node) => node.className.includes('sr-only'))).toBe(true)

    // And the count has genuinely refreshed to zero underneath it.
    await waitFor(() =>
      expect(screen.queryByText(/have been awaiting payment/i)).toBeNull(),
    )
  })

  it('🔴 focus lands on the panel heading, not on <body>', async () => {
    // The confirm button unmounts the moment the confirmation closes, so
    // without a deliberate landing the admin tabs from the top of the document.
    routed(2)
    renderAdmin()

    fireEvent.click(await screen.findByRole('button', { name: /repair stuck orders/i }))
    const confirm = screen.getByRole('button', { name: /yes, repair them/i })
    confirm.focus()
    fireEvent.click(confirm)

    await screen.findAllByText(/2 orders repaired/i)
    expect(document.activeElement).toBe(document.getElementById('reconcile-heading'))
  })

  it('🔴 a FAILED COUNT still offers the repair, and says the count is unknown', async () => {
    // The panel was gated entirely on the count, so a 503 from the diagnostic
    // hid a perfectly healthy repair with nothing on screen to explain it.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return {
            status: 200,
            json: async () => ({ examined: 0, repaired: 0, failed: [], remaining: 0 }),
          } as unknown as Response
        }
        if (String(url).includes('/stuck')) {
          return { status: 503, json: async () => ({}) } as unknown as Response
        }
        return { status: 200, json: async () => PAGE } as unknown as Response
      }),
    )
    renderAdmin()

    expect(await screen.findByText(/count is unavailable/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /repair stuck orders/i })).toBeTruthy()
  })

  it('🔴 says how many REMAIN when a sweep hits its cap', async () => {
    // One run repairs at most 100. Without this the report reads as complete.
    routed(3, async () =>
      ({
        status: 200,
        json: async () => ({ examined: 100, repaired: 100, failed: [], remaining: 300 }),
      }) as unknown as Response,
    )
    renderAdmin()

    fireEvent.click(await screen.findByRole('button', { name: /repair stuck orders/i }))
    fireEvent.click(screen.getByRole('button', { name: /yes, repair them/i }))

    expect((await screen.findAllByText(/300 orders are still stuck/i)).length).toBeGreaterThan(0)
  })

  it('🔴 the in-flight confirm button is aria-disabled, NEVER disabled', async () => {
    // ISSUE-098: `disabled` blurs the focused element, and the confirm block
    // then unmounts, so focus is lost on a batch write that marks orders paid.
    let resolveRepair: (value: Response) => void = () => {}
    routed(2, () => new Promise<Response>((resolve) => {
      resolveRepair = resolve
    }))
    renderAdmin()

    fireEvent.click(await screen.findByRole('button', { name: /repair stuck orders/i }))
    fireEvent.click(screen.getByRole('button', { name: /yes, repair them/i }))

    const confirm = screen.getByRole('button', { name: /yes, repair them/i })
    expect(confirm.hasAttribute('disabled')).toBe(false)
    expect(confirm.getAttribute('aria-disabled')).toBe('true')

    await act(async () => {
      resolveRepair({
        status: 200,
        json: async () => ({ examined: 2, repaired: 2, failed: [] }),
      } as unknown as Response)
    })
  })

  it('a refused repair says WHICH refusal — 403 is not "it broke"', async () => {
    routed(2, async () =>
      ({ status: 403, json: async () => ({ error: { code: 'ADMIN_REQUIRED' } }) }) as unknown as Response,
    )
    renderAdmin()

    fireEvent.click(await screen.findByRole('button', { name: /repair stuck orders/i }))
    fireEvent.click(screen.getByRole('button', { name: /yes, repair them/i }))

    expect((await screen.findAllByText(/administrators only/i)).length).toBeGreaterThan(0)
  })
})
