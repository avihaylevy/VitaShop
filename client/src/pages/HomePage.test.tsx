// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { HomePage } from './HomePage'
import { NEW_ARRIVALS_COUNT } from '../hooks/useNewArrivals'

/**
 * MILESTONE-008 Checkpoint F4 — DEC-064's NEW ARRIVALS, resolving ISSUE-054.
 *
 * 🔴 THE HOME PAGE PREVIOUSLY DECLARED "never GET /api/products" in its own
 * header. That contract is changed here deliberately, which is why the tests
 * name it.
 */

function product(index: number) {
  return {
    slug: `product-${index}`,
    nameHe: `מוצר ${index}`,
    nameEn: `Product ${index}`,
    categoryNameHe: 'ויטמינים',
    categoryNameEn: 'Vitamins',
    // 🔴 `categorySlug` is REQUIRED by `isCatalogProductDto`. The first
    // fixture omitted it, the envelope was rejected as malformed, and three
    // tests failed reporting "product not rendered" — which looked like a
    // rendering bug and was a fixture that did not match the real contract.
    categorySlug: 'vitamins',
    brandName: 'Brand',
    price: '95.00',
    stockQuantity: 10,
    lowStockThreshold: 3,
    imageFile: null,
    dosageForm: 'CAPSULE',
    packageQuantity: 60,
  }
}

const CATEGORIES = [{ id: 'vitamins', slug: 'vitamins', nameHe: 'ויטמינים', nameEn: 'Vitamins' }]

/** Answers categories always; products according to `productsAnswer`. */
function routed(productsAnswer: () => Promise<Response>) {
  const urls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(String(url))
      if (String(url).includes('/api/products')) return productsAnswer()
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: CATEGORIES }),
      } as unknown as Response
    }),
  )
  return urls
}

function ok(items: unknown[]) {
  return async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({
        items,
        page: 1,
        pageSize: 24,
        totalItems: items.length,
        totalPages: 1,
        fallback: null,
      }),
    }) as unknown as Response
}

function renderHome() {
  return render(
    <MemoryRouter>
      <HomePage />
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

describe('the New Arrivals shelf', () => {
  it('🔴 asks for the NEWEST products — DEC-064 rejected best sellers', async () => {
    // `sort=popularity` exists, but the seed has zero orders, so every product
    // scores 0 and the result is the tie-break order wearing a meaningful
    // label. `createdAt` is real data.
    const urls = routed(ok([product(1)]))
    renderHome()
    await waitFor(() => expect(urls.some((u) => u.includes('/api/products'))).toBe(true))
    const productsUrl = urls.find((u) => u.includes('/api/products'))!
    expect(productsUrl).toContain('sort=newest')
    expect(productsUrl).not.toContain('popularity')
  })

  it(`shows at most ${NEW_ARRIVALS_COUNT}, even though a page carries 24`, async () => {
    routed(ok(Array.from({ length: 24 }, (_, i) => product(i + 1))))
    renderHome()
    await screen.findByText('Product 1')
    // The server has no page-size parameter, so the slice happens here.
    expect(screen.queryByText(`Product ${NEW_ARRIVALS_COUNT}`)).toBeTruthy()
    expect(screen.queryByText(`Product ${NEW_ARRIVALS_COUNT + 1}`)).toBeNull()
  })

  it('🔴 the cards LINK and do not add to cart', async () => {
    // Buying belongs to the catalogue, which owns the drawer and the
    // return-focus choreography. A second copy here would be two
    // implementations of one behaviour.
    routed(ok([product(1)]))
    renderHome()
    const link = await screen.findByRole('link', { name: 'Product 1' })
    expect(link.getAttribute('href')).toBe('/product/product-1')
    expect(screen.queryByRole('button', { name: /add to cart/i })).toBeNull()
  })

  it('🔴 A FAILED SHELF DOES NOT BREAK THE PAGE — the categories still render', async () => {
    routed(async () => {
      throw new TypeError('network')
    })
    renderHome()

    // The categories are the page's actual navigation.
    expect(await screen.findByRole('link', { name: /vitamins/i })).toBeTruthy()
    expect(screen.getByText(/could not be loaded right now/i)).toBeTruthy()
  })

  it('🔴 the shelf message lives in a LIVE REGION, so a retry outcome is announced', async () => {
    /*
     * Loading and failure were separate conditional blocks and the failure one
     * carried no live-region role at all: pressing Retry unmounted the focused
     * button, focus fell to <body>, and whether it worked was announced
     * nowhere. `status` is polite — the "do not shout" intent stated properly
     * rather than by omission.
     */
    routed(async () => {
      throw new TypeError('network')
    })
    renderHome()
    const message = await screen.findByText(/could not be loaded right now/i)
    expect(message.getAttribute('role')).toBe('status')
  })

  it('🔴 THE CONTROL — a working shelf renders no error', async () => {
    // Without this, "the failure is quiet" would pass against a page that
    // showed the error message unconditionally.
    routed(ok([product(1)]))
    renderHome()
    await screen.findByText('Product 1')
    expect(screen.queryByText(/could not be loaded right now/i)).toBeNull()
  })

  it('🔴 RETRY actually re-requests — the path nothing exercised', async () => {
    /*
     * Seven tests covered sort, slice, links, the quiet failure, the control,
     * empty and the heading — and none pressed Retry. The button could have
     * been a no-op with the suite green, which is the "check that verifies
     * nothing" family this project keeps recording.
     */
    let attempt = 0
    const urls = routed(async () => {
      attempt += 1
      if (attempt === 1) throw new TypeError('network')
      return ok([product(1)])()
    })
    renderHome()

    const retry = await screen.findByRole('button', { name: /try again/i })
    const before = urls.filter((u) => u.includes('/api/products')).length
    fireEvent.click(retry)

    await screen.findByText('Product 1')
    expect(urls.filter((u) => u.includes('/api/products')).length).toBe(before + 1)
  })

  it('🔴 a LANGUAGE SWITCH re-renders without re-requesting', async () => {
    /*
     * The DTO carries both names, so the toggle needs no network. Re-fetching
     * blanked a loaded shelf to "Loading…" and, if the network dropped in
     * between, turned working content into an error — a language toggle that
     * can lose the page.
     */
    const urls = routed(ok([product(1)]))
    renderHome()
    await screen.findByText('Product 1')
    const before = urls.filter((u) => u.includes('/api/products')).length

    await act(async () => {
      await i18n.changeLanguage('he')
    })

    expect(await screen.findByText('מוצר 1')).toBeTruthy()
    expect(urls.filter((u) => u.includes('/api/products')).length).toBe(before)
  })

  it('says so when there is nothing new, rather than rendering an empty grid', async () => {
    routed(ok([]))
    renderHome()
    expect(await screen.findByText(/no new products to show yet/i)).toBeTruthy()
  })

  it('carries its own heading, separate from the categories', async () => {
    routed(ok([product(1)]))
    renderHome()
    expect(await screen.findByRole('heading', { name: /new in store/i })).toBeTruthy()
  })
})
