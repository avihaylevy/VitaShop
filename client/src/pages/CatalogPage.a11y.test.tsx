import i18next from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { initReactI18next } from 'react-i18next'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CatalogApiError } from '../lib/catalogApi'
import catalogHe from '../locales/he/catalog.json'
import layoutHe from '../locales/he/layout.json'
import type { CatalogCategoryDto } from '../types/catalog'
import type { ProductCardModel } from '../types/product'
import type { UseCatalogDataResult } from '../hooks/useCatalogData'

/**
 * A test-local i18next instance — deliberately NOT the app's
 * `src/i18n/index.ts` singleton, which touches `document` at import time
 * (`applyDocumentDirection`) and would throw under vitest's default `node`
 * environment (no jsdom is installed — adding one is a dependency change,
 * out of Checkpoint E's scope). Hebrew only, since these tests assert
 * specific approved copy; language switching is already covered live by
 * the Checkpoint D/E browser passes.
 */
void i18next.use(initReactI18next).init({
  lng: 'he',
  fallbackLng: 'he',
  resources: { he: { catalog: catalogHe, layout: layoutHe } },
  defaultNS: 'catalog',
  interpolation: { escapeValue: false },
})

/**
 * Slice 9 Checkpoint E — accessibility contract for the six INTEGRATED
 * catalogue states, exercised through the real `CatalogPage` (not the
 * presentational components in isolation) so integration-level defects —
 * like a duplicated heading only visible once the resolver's output is
 * wired into the page — are caught. No jsdom/Testing Library dependency is
 * added: `renderToStaticMarkup` (the same technique already used by
 * `state/CartContext.test.tsx`) yields real server-rendered HTML we can
 * assert against as a string, without executing effects. `useCatalogData`
 * and `useCart` are mocked so each state can be driven directly; the
 * resolver itself (`catalogViewState`) is NOT mocked — the real function
 * runs, so this also proves the wiring, not just the presentational shape.
 *
 * What this file does NOT (and cannot, without jsdom) prove: interaction
 * (does clicking retry actually call the callback), real keyboard focus
 * order, or computed CSS visibility. Those are covered by the Checkpoint D
 * Playwright pass, re-verified live for the same states this checkpoint.
 */

const mockUseCatalogData = vi.fn<() => UseCatalogDataResult>()
vi.mock('../hooks/useCatalogData', () => ({
  useCatalogData: () => mockUseCatalogData(),
}))

const mockUseCart = vi.fn()
vi.mock('../state/CartContext', () => ({
  useCart: () => mockUseCart(),
}))

const CATEGORY_VITAMINS: CatalogCategoryDto = { slug: 'vitamins', nameHe: 'ויטמינים', nameEn: 'Vitamins' }
const CATEGORY_PROBIOTICS: CatalogCategoryDto = { slug: 'probiotics', nameHe: 'פרוביוטיקה', nameEn: 'Probiotics' }
const CATEGORIES = [CATEGORY_VITAMINS, CATEGORY_PROBIOTICS]

function product(overrides: Partial<ProductCardModel> = {}): ProductCardModel {
  return {
    slug: 'some-product',
    name: 'Some Product',
    categoryNameHe: CATEGORY_VITAMINS.nameHe,
    categoryName: CATEGORY_VITAMINS.nameEn,
    price: '10.00',
    stockQuantity: 5,
    lowStockThreshold: 2,
    imageFile: null,
    ...overrides,
  }
}

function setCatalogData(result: Partial<UseCatalogDataResult>) {
  mockUseCatalogData.mockReturnValue({
    loading: false,
    products: [],
    categories: CATEGORIES,
    error: null,
    retry: vi.fn(),
    ...result,
  })
}

function renderCatalog(url = '/catalog') {
  return import('./CatalogPage').then(({ CatalogPage }) =>
    renderToStaticMarkup(
      <MemoryRouter initialEntries={[url]}>
        <CatalogPage />
      </MemoryRouter>,
    ),
  )
}

function count(html: string, needle: string): number {
  return html.split(needle).length - 1
}

beforeEach(() => {
  mockUseCatalogData.mockReset()
  mockUseCart.mockReset()
  mockUseCart.mockReturnValue({ addItem: vi.fn(), items: [], totalQuantity: 0 })
})

describe('CatalogPage accessibility — loading', () => {
  it('renders exactly one role="status", sr-only, and no role="alert"; no stale products leak through', async () => {
    setCatalogData({ loading: true, products: [product()] })
    const html = await renderCatalog()

    expect(count(html, 'role="status"')).toBe(1)
    expect(html).not.toContain('role="alert"')
    expect(html).toContain('sr-only')
    // The stale product's own name must not be rendered anywhere while loading.
    expect(html).not.toContain('Some Product')
  })
})

describe('CatalogPage accessibility — error', () => {
  it('renders exactly one role="alert", a real button with an accessible name, and no role="status"', async () => {
    setCatalogData({ loading: false, error: new CatalogApiError('UNKNOWN_ERROR', 'boom'), products: [product()] })
    const html = await renderCatalog()

    expect(count(html, 'role="alert"')).toBe(1)
    expect(html).not.toContain('role="status"')
    expect(html).toMatch(/<button[^>]*>[\s\S]*?נסה שוב[\s\S]*?<\/button>/)
    // Stale products must not leak through the error branch either.
    expect(html).not.toContain('Some Product')
  })
})

describe('CatalogPage accessibility — invalid-category', () => {
  it('renders exactly one heading, an unnamed section (no redundant label), a real back-to-all button, and no live region', async () => {
    setCatalogData({ products: [product()] })
    const html = await renderCatalog('/catalog?category=not-a-real-category')

    // Regression test, twice corrected:
    //   1. Checkpoint D's integration duplicated this exact heading TEXT as
    //      two separate <h2> elements (CatalogPage's own gridHeading +
    //      CatalogEmptyState's own heading).
    //   2. The first Checkpoint E fix replaced the outer <h2> with an
    //      aria-label carrying the SAME text — a Codex Major finding caught
    //      that this still duplicates the announcement (region accessible
    //      name + heading accessible name, both "Category not found"),
    //      just via a different mechanism than #1.
    // The actual fix: exactly one <h2>, and the section carries NO
    // accessible name of its own — no aria-label, no aria-labelledby
    // substitute for the removed heading. A landmark does not need an
    // accessible name to be usable; CatalogEmptyState's own <h2> is
    // sufficient on its own.
    expect(count(html, '<h2')).toBe(1)
    expect(html).not.toContain('aria-label="הקטגוריה לא נמצאה"')
    expect(html).not.toContain('aria-labelledby="catalog-grid-heading"')
    // No OTHER aria-label leaked onto the section either — not just this
    // specific redundant string, the whole mechanism must be absent.
    expect(html).not.toMatch(/<section[^>]*aria-label=/)
    expect(html).not.toContain('role="status"')
    expect(html).not.toContain('role="alert"')
    // Copy and action preserved exactly.
    expect(html).toContain('הקטגוריה המבוקשת אינה קיימת')
    expect(html).toMatch(/<button[^>]*>[\s\S]*?חזרה לכל המוצרים[\s\S]*?<\/button>/)
  })
})

describe('CatalogPage accessibility — catalog-empty', () => {
  it('renders informational heading/message with no action and no live region', async () => {
    setCatalogData({ products: [] })
    const html = await renderCatalog()

    expect(html).toContain('אין מוצרים להצגה כרגע')
    expect(html).not.toContain('role="status"')
    expect(html).not.toContain('role="alert"')
    // No action for catalog-empty (Checkpoint A/B: informational only).
    expect(html).not.toMatch(/<button[^>]*>[\s\S]*?חזרה לכל המוצרים[\s\S]*?<\/button>/)
  })
})

describe('CatalogPage accessibility — filtered-empty', () => {
  it('interpolates the category name readably, and a real back-to-all button is present', async () => {
    setCatalogData({ products: [product({ categoryNameHe: CATEGORY_VITAMINS.nameHe })] })
    const html = await renderCatalog('/catalog?category=probiotics')

    expect(html).toContain('אין כרגע מוצרים בקטגוריה &quot;פרוביוטיקה&quot;')
    expect(html).not.toContain('role="status"')
    expect(html).not.toContain('role="alert"')
    expect(html).toMatch(/<button[^>]*>[\s\S]*?חזרה לכל המוצרים[\s\S]*?<\/button>/)
  })
})

describe('CatalogPage accessibility — ready', () => {
  it('renders exactly one role="status" (the add-to-cart live region) and no role="alert"', async () => {
    setCatalogData({ products: [product()] })
    const html = await renderCatalog()

    expect(count(html, 'role="status"')).toBe(1)
    expect(html).not.toContain('role="alert"')
    expect(html).toContain('Some Product')
  })
})
