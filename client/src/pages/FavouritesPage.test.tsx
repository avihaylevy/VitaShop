// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { CartProvider } from '../state/CartContext'
import { FavouritesPage } from './FavouritesPage'
import type { CatalogProductDto } from '../types/catalog'

/**
 * Area 6 — the favourites page's OWN contract (this file is new with the
 * area; the page shipped at ISSUE-115 without one). Scope is deliberately
 * the area-6 surface: the count line (with its LTR numeric isolation),
 * the capped grid, and the empty state's LINK. The add/heart choreography
 * is the shared machinery, covered where it lives.
 */

const replaceAll = vi.fn()
vi.mock('../state/FavouritesContext', () => ({
  useFavourites: () => ({
    count: 0,
    isFavourite: () => true,
    toggle: async () => 'removed' as const,
    replaceAll,
  }),
}))

const EMPTY_ANSWER = async () => ({ ok: true as const, items: [] as CatalogProductDto[] })
let favouritesAnswer: (signal?: AbortSignal) => Promise<
  { ok: true; items: CatalogProductDto[] } | { ok: false; reason: 'failed' }
> = EMPTY_ANSWER
/** Captures the signal each load passes — the page's 🔴 every-load-aborts rule. */
const receivedSignals: (AbortSignal | undefined)[] = []
vi.mock('../lib/favouritesApi', () => ({
  fetchFavourites: (signal?: AbortSignal) => {
    receivedSignals.push(signal)
    return favouritesAnswer(signal)
  },
}))

// 🔴 A COMPLETE DTO, no `as` cast — a cast here let the fixture omit the
// required shortDescription pair (DEC-111), so every card in the suite
// rendered WITHOUT its teaser block: shorter cards than the server can
// ever produce, in the suite that exists to pin card sizing (review
// finding). The next required DTO field must break this file at compile.
function dto(index: number): CatalogProductDto {
  return {
    slug: `product-${index}`,
    nameHe: `מוצר ${index}`,
    nameEn: `Product ${index}`,
    categoryNameHe: 'ויטמינים',
    categoryNameEn: 'Vitamins',
    categorySlug: 'vitamins',
    brandName: 'Brand',
    brandNameEn: null,
    price: '95.00',
    stockQuantity: 10,
    lowStockThreshold: 3,
    imageFile: null,
    dosageForm: 'CAPSULE',
    packageQuantity: 60,
    shortDescriptionHe: `תיאור קצר ${index}`,
    shortDescriptionEn: `Short description ${index}`,
  }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <CartProvider>
        <FavouritesPage />
      </CartProvider>
    </MemoryRouter>,
  )
}

beforeEach(async () => {
  vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000')
  // CartProvider hydrates over fetch; an empty-cart answer keeps it quiet.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ items: [], totalQuantity: 0 }),
    })) as unknown as typeof fetch,
  )
  await i18n.changeLanguage('en')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  // A test that forgets to assign inherits a safe empty list, never the
  // previous test's closure (order-dependence guard).
  favouritesAnswer = EMPTY_ANSWER
  receivedSignals.length = 0
})

/** The product grid, anchored by content — never `querySelector('ul')`,
 *  which grabs the first list in document order and would pass vacuously
 *  against some other list if one ever mounts earlier. */
function gridOf(name: RegExp): HTMLElement {
  const list = screen.getByRole('link', { name }).closest('ul')
  if (!list) throw new Error('product card not inside a list')
  return list
}

describe('area 6 — count line and capped grid', () => {
  it('renders the count line and the CAPPED grid for a sparse list', async () => {
    favouritesAnswer = async () => ({ ok: true, items: [dto(1), dto(2)] })
    renderPage()

    await screen.findByText('Product 1')
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === '2 products in favourites')).toBeDefined()

    /*
     * The capped template is a LAYOUT fact jsdom cannot compute (no track
     * sizing), so the pin is the full class contract — the track pair AND
     * justify-start, whose absence would flip RTL packing with every
     * other assertion green — and the browser matrix carries the geometry
     * half (browser-verification.md). Pinned as a literal, not an import
     * of GRID_CLASS: comparing the constant to itself could never fail.
     */
    const grid = gridOf(/Product 1/)
    expect(grid.className).toBe(
      'grid grid-cols-[repeat(auto-fill,minmax(min(var(--card-track-min),100%),var(--card-track-max)))] justify-start gap-3 md:gap-4',
    )
    // Every load handed the API a real abort signal (the page's 🔴 rule:
    // a signal-less load can write a STALE list into the shared context).
    expect(receivedSignals.length).toBeGreaterThan(0)
    for (const signal of receivedSignals) expect(signal).toBeInstanceOf(AbortSignal)
  })

  it('speaks the Hebrew dual form', async () => {
    await act(async () => {
      await i18n.changeLanguage('he')
    })
    favouritesAnswer = async () => ({ ok: true, items: [dto(1), dto(2)] })
    renderPage()

    await screen.findByText('מוצר 1')
    expect(screen.getByText('שני מוצרים במועדפים')).toBeDefined()
  })

  it('🔴 the Hebrew digit count renders inside an LTR isolation span', async () => {
    // 3 items — Hebrew `other` form, the ONLY form that draws a digit in
    // an RTL run; the dual test above never exercises the isolation.
    await act(async () => {
      await i18n.changeLanguage('he')
    })
    favouritesAnswer = async () => ({ ok: true, items: [dto(1), dto(2), dto(3)] })
    const { container } = renderPage()

    await screen.findByText('מוצר 1')
    const isolated = container.querySelector('p > span[dir="ltr"]')
    expect(isolated?.textContent).toBe('3')
  })
})

describe('area 6 — the empty state', () => {
  it('🔴 the catalog CTA is a real LINK, not a button pretending', async () => {
    favouritesAnswer = async () => ({ ok: true, items: [] })
    renderPage()

    await screen.findByRole('heading', { name: /no favourites yet/i })
    const cta = screen.getByRole('link', { name: /browse all products/i })
    expect(cta.getAttribute('href')).toBe('/catalog')
    // THE CONTROL: no button wears the CTA label — the old navigate()
    // button would satisfy a bare text query and hide a regression.
    expect(screen.queryByRole('button', { name: /browse all products/i })).toBeNull()
    // No count line in the empty state.
    expect(screen.queryByText(/in favourites$/)).toBeNull()
  })
})
