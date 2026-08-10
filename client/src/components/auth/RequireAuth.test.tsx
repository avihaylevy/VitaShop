// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../i18n'
import App from '../../App'
import { SessionProvider } from '../../state/SessionContext'
import { CartProvider } from '../../state/CartContext'
import { FavouritesProvider } from '../../state/FavouritesContext'
import { RequireAuth } from './RequireAuth'

/**
 * MILESTONE-006 clause A10 / REQ-F-034 — the gate, and above all what it must
 * NOT do.
 *
 * 🔴 THE REGRESSION THAT MATTERS HERE IS THE WALL APPEARING, not the wall
 * failing to appear. Registration is required for favourites and checkout
 * ONLY; browsing, searching, filtering, product details and the cart are open
 * to guests. A login wall in front of the catalogue would break the product
 * for every visitor who has not signed up — which is most of them.
 */

const fetchMock = vi.fn()

beforeEach(() => {
  // Every call answers "guest". Any wall that appears below is therefore the
  // gate over-applying, not an authentication failure.
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/auth/session')) {
      return new Response(JSON.stringify({ authenticated: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    // Catalogue endpoints: enough shape to render without crashing.
    return new Response(JSON.stringify({ items: [], page: 1, pageSize: 24, totalItems: 0, totalPages: 0 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

function renderAt(path: string) {
  return render(
    <SessionProvider>
      <CartProvider>
        <FavouritesProvider>
          <MemoryRouter initialEntries={[path]}>
            <App />
          </MemoryRouter>
        </FavouritesProvider>
      </CartProvider>
    </SessionProvider>,
  )
}

describe('🔴 REQ-F-034 — guests are NOT walled out of the open routes', () => {
  const openRoutes = ['/', '/catalog', '/cart', '/product/solgar-omega-3']

  it.each(openRoutes)('a guest reaches %s without a login prompt', async (path) => {
    renderAt(path)

    // Give any session check and its state update time to land — a wall that
    // appears asynchronously is still a wall.
    await waitFor(() => {
      expect(document.getElementById('auth-gate-title')).toBeNull()
    })
  })

  it('🔴 no open route mounts the gate at all', async () => {
    // Stronger than "no prompt is visible": the gate's own heading id must not
    // exist anywhere in the tree for these routes.
    for (const path of openRoutes) {
      const { unmount } = renderAt(path)
      await waitFor(() => {
        expect(document.getElementById('auth-gate-title')).toBeNull()
      })
      unmount()
    }
  })
})

describe('RequireAuth — the mechanism itself', () => {
  it('shows the prompt to a guest', async () => {
    render(
      <SessionProvider>
      <MemoryRouter>
        <RequireAuth>
          <p>protected</p>
        </RequireAuth>
      </MemoryRouter>
      </SessionProvider>,
    )

    await waitFor(() => {
      expect(document.getElementById('auth-gate-title')).not.toBeNull()
    })
    expect(screen.queryByText('protected')).toBeNull()
  })

  it('renders the children once the session says authenticated', async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ authenticated: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )

    render(
      <SessionProvider>
      <MemoryRouter>
        <RequireAuth>
          <p>protected</p>
        </RequireAuth>
      </MemoryRouter>
      </SessionProvider>,
    )

    await waitFor(() => {
      expect(screen.queryByText('protected')).not.toBeNull()
    })
    expect(document.getElementById('auth-gate-title')).toBeNull()
  })

  it('🔴 shows NEITHER the prompt nor the children while the check is in flight', async () => {
    // A flash of "log in" for a user who IS authenticated is the failure mode
    // a redirect-based gate has; this one must render nothing decisive yet.
    fetchMock.mockImplementation(() => new Promise(() => {}))

    render(
      <SessionProvider>
      <MemoryRouter>
        <RequireAuth>
          <p>protected</p>
        </RequireAuth>
      </MemoryRouter>
      </SessionProvider>,
    )

    expect(document.getElementById('auth-gate-title')).toBeNull()
    expect(screen.queryByText('protected')).toBeNull()
  })
})
