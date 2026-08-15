// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { CartProvider } from '../state/CartContext'
import { CartDrawer } from '../components/cart/CartDrawer'
import { ProductGrid } from '../components/catalog/ProductGrid'
import { DRAWER_SHOWN_SESSION_KEY, useAddToCart } from './useAddToCart'
import type { ProductCardModel } from '../types/product'

// ISSUE-115 — the card reads favourites from context; inert here.
vi.mock('../state/FavouritesContext', () => ({
  useFavourites: () => ({ count: 0, isFavourite: () => false, toggle: async () => 'added' as const }),
}))

/**
 * 🔴 THIS FILE EXISTS BECAUSE THE BEHAVIOUR IT COVERS HAD NO TEST AT ALL.
 *
 * The add-to-cart choreography — the drawer opening only on a confirmed
 * success, the return-focus owner written only on the closed -> open
 * transition (DEC-047-A R1), the announcement carrying the cart-wide count —
 * is some of the most heavily commented code in this project, earned from real
 * defects across Slice 8. When ISSUE-105 moved it out of `CatalogPage` into a
 * shared hook, a grep for `CartDrawer` and `returnFocus` across every
 * `*.test.tsx` returned NOTHING.
 *
 * ⚠️ SO THE REFACTOR HAD NO REGRESSION NET, and neither did the original. The
 * suite would have stayed green if the drawer had stopped opening, if it had
 * opened on a REFUSAL, or if focus had never returned anywhere.
 */

const PRODUCT: ProductCardModel = {
  slug: 'probiotic',
  name: 'Probiotic Intense',
  categoryNameHe: 'פרוביוטיקה',
  categoryName: 'Probiotics',
  brandName: 'Altman',
  price: '94.90',
  packageQuantity: 30,
  imageFile: null,
  stockQuantity: 8,
  lowStockThreshold: 3,
}

/** A minimal surface that uses the hook exactly as both real pages do. */
function Surface() {
  const { handleAddToCart, drawerOpen, closeDrawer, returnFocusRef, gridRef, announced } =
    useAddToCart()
  return (
    <div>
      <div ref={gridRef}>
        <ProductGrid products={[PRODUCT]} onAddToCart={handleAddToCart} />
      </div>
      <p role="status">{announced ? `announced ${announced.slug} ${announced.count}` : ''}</p>
      {/*
        🔴 THE HOOK'S OWN STATE, surfaced because the DRAWER'S DOM CANNOT
        ANSWER THIS in jsdom. `drawerOpen` (DEC-073: a boolean — the panel
        shows the whole cart) is the thing DEC-047 D1 is actually about.
      */}
      <p data-testid="drawer-state">{drawerOpen ? 'open' : 'closed'}</p>
      <button type="button" data-testid="close-drawer" onClick={closeDrawer}>
        close
      </button>
      <CartDrawer open={drawerOpen} onClose={closeDrawer} returnFocusRef={returnFocusRef} />
    </div>
  )
}

function cartBody(totalQuantity: number) {
  return {
    items: [
      {
        id: 'line-1',
        productId: 'p1',
        slug: 'probiotic',
        nameHe: 'פרוביוטיק',
        nameEn: 'Probiotic Intense',
        brandName: 'Altman',
        packageQuantity: 30,
        imageFile: null,
        quantity: totalQuantity,
        unitPrice: '94.90',
        lineTotal: '94.90',
        isActive: true,
        stockQuantity: 8,
        lowStockThreshold: 3,
      },
    ],
    totalQuantity,
    subtotal: '94.90',
    hasBlockingLine: false,
    shipping: {
      basis: '94.90',
      cost: '30.00',
      isFree: false,
      threshold: '249.00',
      remainingForFree: '154.10',
      hasShippableLines: true,
      noDeliveryRequired: false,
    },
  }
}

/**
 * ⚠️ THE WIRE ENVELOPE, not a bare cart — `readMutation` requires `cart` AND a
 * numeric `quantity`, and returns null otherwise. A fixture that sent the cart
 * alone made every add look like a refusal, which is how the first version of
 * this file "proved" the drawer never opens.
 */
function mutation(totalQuantity: number, extras: Record<string, unknown> = {}) {
  return { cart: cartBody(totalQuantity), quantity: totalQuantity, ...extras }
}

function renderSurface() {
  return render(
    /*
     * 🔴 STRICTMODE, LIKE THE REAL APP — added after the browser matrix
     * caught a defect every test here missed: the open decision lived inside
     * a setState UPDATER with a side effect (stamping the session flag), and
     * StrictMode's double-invoke made the second call read its own stamp and
     * decline to open. Without StrictMode, jsdom stayed green while the
     * running app never opened the drawer at all.
     */
    <StrictMode>
      <MemoryRouter>
        <CartProvider>
          <Surface />
        </CartProvider>
      </MemoryRouter>
    </StrictMode>,
  )
}

beforeEach(async () => {
  vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000')
  /*
   * ⚠️ jsdom HAS NO `matchMedia`, and `usePresence` (the drawer's motion
   * handling) calls it. Nothing had ever rendered `CartDrawer` in a test, so
   * nothing had ever needed this — which is itself the point of this file.
   * Reduced motion is reported as OFF so the drawer animates as in production.
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
  // DEC-073: the first-add-of-a-session flag must not leak between tests.
  window.sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('the shared add-to-cart choreography', () => {
  it('🔴 opens the drawer ONLY on a confirmed server success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === 'POST'
          ? ({ ok: true, status: 200, json: async () => mutation(1) } as unknown as Response)
          : ({ ok: true, status: 200, json: async () => ({ cart: cartBody(0) }) } as unknown as Response),
      ),
    )
    renderSurface()

    fireEvent.click(await screen.findByRole('button', { name: /add to cart/i }))
    await waitFor(() => expect(screen.getByTestId('drawer-state').textContent).toBe('open'))
  })

  it('does NOT open the drawer when the add is REFUSED — ⚠️ NOT MUTATION-PROVEN', async () => {
    /*
     * DEC-047 D1 — never from the click handler, never optimistically, never
     * on a refusal.
     *
     * 🔴 THIS TEST DOES NOT PROVE THAT, AND SAYING SO IS THE POINT. Mutating
     * the hook to open the drawer straight from the click handler — the exact
     * defect D1 forbids — leaves it GREEN. Verified three ways: waiting a
     * microtask, waiting 60ms, and asserting the hook's own `drawerSlug`
     * rather than the drawer's DOM. The mutation was confirmed present in the
     * file each time (two `setDrawerSlug` blocks), and the test still passed.
     *
     * ⚠️ I DO NOT YET KNOW WHY, and an explanation invented here would be
     * worse than the gap. What is certain: this file's other three assertions
     * are mutation-proven, and this one is a placeholder that must not be read
     * as coverage of D1. The property is real and worth protecting — it needs
     * either a different seam or the browser matrix.
     */
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === 'POST'
          ? ({ ok: false, status: 409, json: async () => ({ error: { code: 'OUT_OF_STOCK' } }) } as unknown as Response)
          : ({ ok: true, status: 200, json: async () => ({ cart: cartBody(0) }) } as unknown as Response),
      ),
    )
    renderSurface()

    fireEvent.click(await screen.findByRole('button', { name: /add to cart/i }))

    /*
     * ⚠️ LONG ENOUGH FOR A DRAWER TO APPEAR IF IT WAS GOING TO. The first
     * version flushed a single microtask and asserted immediately — and a
     * mutation that opened the drawer straight from the CLICK handler (the
     * exact defect DEC-047 D1 forbids) left it GREEN, because the drawer's
     * presence had not mounted yet at that instant. Checking too early is a
     * check that verifies nothing.
     */
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60))
    })
    expect(screen.getByTestId('drawer-state').textContent).toBe('closed')
  })

  it('🔴 announces the CART-WIDE count from the response, not a local guess', async () => {
    // The spoken number has to match the header badge, which renders the same
    // server figure. A locally incremented count drifts the moment anything
    // else changes the cart.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === 'POST'
          ? ({ ok: true, status: 200, json: async () => mutation(7) } as unknown as Response)
          : ({ ok: true, status: 200, json: async () => ({ cart: cartBody(0) }) } as unknown as Response),
      ),
    )
    renderSurface()

    fireEvent.click(await screen.findByRole('button', { name: /add to cart/i }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('announced probiotic 7'))
  })

  it('🔴 CLOSING is the caller’s to trigger, and it clears the slug', async () => {
    /*
     * 🔴 THE DRAWER'S OWN DOM IS NOT ASSERTED ANYWHERE IN THIS FILE, and that
     * is deliberate: jsdom never renders `[role=dialog]` for `CartDrawer` even
     * when it is open, so every assertion about it was passing or failing for
     * reasons unrelated to the code under test. The hook owns `drawerSlug`;
     * the drawer's rendering and its focus trap belong to the browser matrix.
     *
     * ⚠️ MEASURED IN CHROMIUM against the running site, 2026-08-14, because
     * the suite cannot see it: clicking add-to-cart opened `[role=dialog]`,
     * and clicking the drawer's close button returned focus to the exact
     * BUTTON carrying data-add-to-cart="naturalis-magnesium-citrate-120".
     */
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === 'POST'
          ? ({ ok: true, status: 200, json: async () => mutation(1) } as unknown as Response)
          : ({ ok: true, status: 200, json: async () => ({ cart: cartBody(0) }) } as unknown as Response),
      ),
    )
    renderSurface()

    fireEvent.click(await screen.findByRole('button', { name: /add to cart/i }))
    await waitFor(() => expect(screen.getByTestId('drawer-state').textContent).toBe('open'))

    fireEvent.click(screen.getByTestId('close-drawer'))
    expect(screen.getByTestId('drawer-state').textContent).toBe('closed')
  })

  it('🔴 DEC-073 — the drawer auto-opens on the FIRST add of a session ONLY', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === 'POST'
          ? ({ ok: true, status: 200, json: async () => mutation(1) } as unknown as Response)
          : ({ ok: true, status: 200, json: async () => ({ cart: cartBody(0) }) } as unknown as Response),
      ),
    )
    renderSurface()

    // First add: opens, and stamps the session.
    fireEvent.click(await screen.findByRole('button', { name: /add to cart/i }))
    await waitFor(() => expect(screen.getByTestId('drawer-state').textContent).toBe('open'))
    expect(window.sessionStorage.getItem(DRAWER_SHOWN_SESSION_KEY)).toBe('1')

    // The shopper closes it and keeps shopping.
    fireEvent.click(screen.getByTestId('close-drawer'))
    expect(screen.getByTestId('drawer-state').textContent).toBe('closed')

    // Second add: QUIET — announced (the region updates with the new count),
    // never re-opened.
    fireEvent.click(screen.getByRole('button', { name: /add to cart/i }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('announced probiotic 1'))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60)) // same budget as the D1 test
    })
    expect(screen.getByTestId('drawer-state').textContent).toBe('closed')
  })

  it('🔴 review finding — a CLAMPED quiet re-add RE-OPENS the drawer instead of losing the clamp silently', async () => {
    // The drawer is the only surface on these pages that renders the outcome.
    // A quiet add that the server clamped (or refused at max) changed nothing
    // and would otherwise say nothing — §7.16's silent loss. Quiet means not
    // nagging about SUCCESSES.
    let post = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          post += 1
          return {
            ok: true, status: 200,
            json: async () => (post === 1 ? mutation(1) : mutation(1, { alreadyAtMaximum: true })),
          } as unknown as Response
        }
        return { ok: true, status: 200, json: async () => ({ cart: cartBody(0) }) } as unknown as Response
      }),
    )
    renderSurface()

    fireEvent.click(await screen.findByRole('button', { name: /add to cart/i }))
    await waitFor(() => expect(screen.getByTestId('drawer-state').textContent).toBe('open'))
    fireEvent.click(screen.getByTestId('close-drawer'))

    // The clamped re-add must NOT stay quiet.
    fireEvent.click(screen.getByRole('button', { name: /add to cart/i }))
    await waitFor(() => expect(screen.getByTestId('drawer-state').textContent).toBe('open'))
  })

  it('🔴 review finding — a REFUSED add keeps the chosen quantity; the stepper resets only on a FULL take', async () => {
    // The Promise<boolean> gate exists for exactly this: the server took
    // NOTHING (alreadyAtMaximum), so the shopper's chosen 3 must survive
    // for the retry the re-opened drawer invites — never snap back to 1.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === 'POST'
          ? ({
              ok: true, status: 200,
              json: async () => mutation(2, { alreadyAtMaximum: true }),
            } as unknown as Response)
          : ({ ok: true, status: 200, json: async () => ({ cart: cartBody(0) }) } as unknown as Response),
      ),
    )
    renderSurface()

    const increase = await screen.findByRole('button', { name: /increase quantity/i })
    fireEvent.click(increase)
    fireEvent.click(increase)
    expect(screen.getByText('3')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /add to cart/i }))
    await waitFor(() => expect(screen.getByTestId('drawer-state').textContent).toBe('open'))
    expect(screen.getByText('3')).toBeTruthy()
  })

  it('DEC-073 — an add while the drawer is ALREADY open keeps it open (D8: content only)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === 'POST'
          ? ({ ok: true, status: 200, json: async () => mutation(2) } as unknown as Response)
          : ({ ok: true, status: 200, json: async () => ({ cart: cartBody(0) }) } as unknown as Response),
      ),
    )
    renderSurface()

    fireEvent.click(await screen.findByRole('button', { name: /add to cart/i }))
    await waitFor(() => expect(screen.getByTestId('drawer-state').textContent).toBe('open'))

    fireEvent.click(screen.getByRole('button', { name: /add to cart/i }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('announced probiotic 2'))
    expect(screen.getByTestId('drawer-state').textContent).toBe('open')
  })
})
