import i18next from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { initReactI18next } from 'react-i18next'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CatalogApiError } from '../lib/catalogApi'
import { CatalogPage } from './CatalogPage'
import catalogHe from '../locales/he/catalog.json'
import layoutHe from '../locales/he/layout.json'
import type { CatalogCategoryDto, CatalogFacetsDto } from '../types/catalog'
import type { ProductCardModel } from '../types/product'
import type { UseCatalogDataResult } from '../hooks/useCatalogData'
import { EMPTY_CATALOG_URL_STATE } from '../features/catalog/catalogUrlState'

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

const mockUseCatalogCategories = vi.fn()
vi.mock('../hooks/useCatalogCategories', () => ({
  useCatalogCategories: () => mockUseCatalogCategories(),
}))

const mockUseCart = vi.fn()
vi.mock('../state/CartContext', () => ({
  useCart: () => mockUseCart(),
}))

// Checkpoint I — the facet payload drives the filter fieldsets. Mocked for
// the same reason `useCatalogCategories` is: this file renders the real
// page, and an unmocked hook would leave the option set empty for every
// test rather than letting each one state what it needs.
const mockUseCatalogFacets = vi.fn()
vi.mock('../hooks/useCatalogFacets', () => ({
  useCatalogFacets: () => mockUseCatalogFacets(),
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
    error: null,
    invalidCategory: false,
    hasNarrowingQuery: false,
    totalItems: 0,
    page: 1,
    totalPages: 0,
    fallback: null,
    urlState: EMPTY_CATALOG_URL_STATE,
    retry: vi.fn(),
    ...result,
  })
}

const EMPTY_FACETS: CatalogFacetsDto = { brands: [], ingredients: [], healthGoals: [], dosageForms: [] }

function setFacets(facets: Partial<CatalogFacetsDto> = {}) {
  mockUseCatalogFacets.mockReturnValue({
    loading: false,
    facets: { ...EMPTY_FACETS, ...facets },
    error: null,
    retry: vi.fn(),
  })
}

/**
 * 🔴 ISSUE-096 — STATIC IMPORT, NOT `import('./CatalogPage')` IN THE TEST.
 * The dynamic form made the FIRST test in this file pay the entire
 * CatalogPage module-graph transform+evaluation INSIDE its own 5s timeout —
 * free in isolation, seconds under a contended full-suite worker pool, which
 * is exactly the "times out under load, passes alone" flake. `vi.mock` is
 * hoisted above static imports, so the mocks bind either way; the graph now
 * loads at file-collection time, outside any test's budget.
 *
 * ⚠️ THE WRAPPER SHAPE OF THE FACTORIES IS NOW LOAD-BEARING, not stylistic
 * (second review round). Each factory returns `() => mockUseX()` — a closure
 * over the module-level `const` — rather than the mock itself. Hoisted
 * factories run during GRAPH LOAD, before this module body initializes those
 * consts, so the "simpler" `{ useCatalogData: mockUseCatalogData }` form —
 * which happened to work under the old dynamic import — would now throw a
 * TDZ ReferenceError at collection. Keep the wrappers.
 */
function renderCatalog(url = '/catalog'): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[url]}>
      <CatalogPage />
    </MemoryRouter>,
  )
}

function count(html: string, needle: string): number {
  return html.split(needle).length - 1
}

beforeEach(() => {
  mockUseCatalogData.mockReset()
  mockUseCatalogCategories.mockReset()
  mockUseCatalogCategories.mockReturnValue({ loading: false, categories: CATEGORIES, error: null, retry: vi.fn() })
  mockUseCart.mockReset()
  // DEC-073: the drawer is an editing panel reading the full cart shape, so
  // this mock carries what it reads even though it renders closed here.
  mockUseCart.mockReturnValue({
    addItem: vi.fn(),
    setLineQuantity: vi.fn(),
    removeLine: vi.fn(),
    pending: false,
    outcome: null,
    cart: { items: [], subtotal: '0.00', totalQuantity: 0, hasBlockingLine: false },
    items: [],
    totalQuantity: 0,
  })
  mockUseCatalogFacets.mockReset()
  setFacets()
})

/**
 * 🔴 Checkpoint I changed this file's live-region contract, deliberately and
 * with the plan behind it — §10 requires "result count in a POLITE live
 * region". Before Checkpoint I the page had exactly one `role="status"`
 * (the add-to-cart confirmation); it now has a SECOND one carrying the
 * settled result count.
 *
 * The count region is mounted in every state, including loading and error,
 * and is EMPTY in those states. That is not an oversight: a live region
 * must already exist in the DOM before its content changes, or assistive
 * technology can miss the very first announcement. So the assertions below
 * changed from "no live region" to "a live region that says nothing" —
 * which is the same user-facing guarantee (nothing is announced), proven at
 * the level that actually matters.
 *
 * No previous state's copy, heading structure, action or alert contract was
 * changed; every one of those assertions is preserved verbatim.
 */
const EMPTY_COUNT_REGION = '<p role="status" class=""></p>'

describe('CatalogPage accessibility — loading', () => {
  it('renders exactly one role="status", sr-only, and no role="alert"; no stale products leak through', async () => {
    setCatalogData({ loading: true, products: [product()], totalItems: 1 })
    const html = await renderCatalog()

    // Two now: the loading state's own status region, plus the Checkpoint I
    // count region — which must be EMPTY here, so nothing is announced for
    // a query that has not settled.
    expect(count(html, 'role="status"')).toBe(2)
    expect(html).toContain(EMPTY_COUNT_REGION)
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
    // The only status region is the Checkpoint I count region, and it says
    // nothing — an error is announced by the alert, never as a count.
    expect(count(html, 'role="status"')).toBe(1)
    expect(html).toContain(EMPTY_COUNT_REGION)
    expect(html).toMatch(/<button[^>]*>[\s\S]*?נסה שוב[\s\S]*?<\/button>/)
    // Stale products must not leak through the error branch either.
    expect(html).not.toContain('Some Product')
  })
})

describe('CatalogPage accessibility — invalid-category', () => {
  it('renders exactly one heading, an unnamed section (no redundant label), a real back-to-all button, and no live region', async () => {
    setCatalogData({
      products: [product()],
      invalidCategory: true,
      urlState: { ...EMPTY_CATALOG_URL_STATE, category: 'not-a-real-category' },
    })
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
    // The desktop filter rail adds its own <h2> ("Filters") at Checkpoint I,
    // so the count is now 2 — the invariant this test exists for is
    // unchanged: exactly ONE heading inside the results section, i.e. no
    // duplicated "Category not found".
    expect(count(html, '<h2')).toBe(2)
    expect(count(html, 'הקטגוריה לא נמצאה')).toBe(1)
    expect(html).not.toContain('aria-label="הקטגוריה לא נמצאה"')
    expect(html).not.toContain('aria-labelledby="catalog-grid-heading"')
    // No OTHER aria-label leaked onto the section either — not just this
    // specific redundant string, the whole mechanism must be absent.
    expect(html).not.toMatch(/<section[^>]*aria-label=/)
    // Only the Checkpoint I count region, empty: an invalid category
    // produced no count, so nothing is announced.
    expect(count(html, 'role="status"')).toBe(1)
    expect(html).toContain(EMPTY_COUNT_REGION)
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
    // The count region is the only one, and it DOES speak here — the query
    // settled with zero results, which is a countable outcome (§10).
    expect(count(html, 'role="status"')).toBe(1)
    // The numeral is LTR-isolated (correction, finding 4).
    expect(html).toContain('נמצאו <span dir="ltr">0</span> מוצרים')
    expect(html).not.toContain('role="alert"')
    // No action for catalog-empty (Checkpoint A/B: informational only).
    expect(html).not.toMatch(/<button[^>]*>[\s\S]*?חזרה לכל המוצרים[\s\S]*?<\/button>/)
  })
})

describe('CatalogPage accessibility — filtered-empty', () => {
  it('interpolates the category name readably, and a real back-to-all button is present', async () => {
    setCatalogData({
      products: [],
      hasNarrowingQuery: true,
      totalItems: 0,
      urlState: { ...EMPTY_CATALOG_URL_STATE, category: 'probiotics' },
    })
    const html = await renderCatalog('/catalog?category=probiotics')

    expect(html).toContain('אין כרגע מוצרים בקטגוריה &quot;פרוביוטיקה&quot;')
    expect(count(html, 'role="status"')).toBe(1)
    // The numeral is LTR-isolated (correction, finding 4).
    expect(html).toContain('נמצאו <span dir="ltr">0</span> מוצרים')
    expect(html).not.toContain('role="alert"')
    expect(html).toMatch(/<button[^>]*>[\s\S]*?חזרה לכל המוצרים[\s\S]*?<\/button>/)
  })
})

describe('CatalogPage accessibility — ready', () => {
  it('renders exactly two role="status" regions (add-to-cart + result count) and no role="alert"', async () => {
    setCatalogData({ products: [product()], totalItems: 1 })
    const html = await renderCatalog()

    expect(count(html, 'role="status"')).toBe(2)
    // The add-to-cart region is still empty on load — nothing was added yet.
    expect(html).toContain('נמצא מוצר אחד')
    expect(html).not.toContain('role="alert"')
    expect(html).toContain('Some Product')
  })
})

/**
 * MILESTONE-005 Checkpoint I — the query-control surface (§10). These
 * assertions are about SEMANTICS, not styling: roles, accessible names,
 * native grouping, and the §6b primary-vs-fallback separation. Interaction,
 * real focus movement and computed visibility are covered by the Playwright
 * pass, not here (no jsdom in this file).
 */
describe('CatalogPage accessibility — query controls (Checkpoint I)', () => {
  it('renders one search landmark, a labelled native sort select with exactly the four frozen values', async () => {
    setCatalogData({ products: [product()], totalItems: 1 })
    const html = await renderCatalog()

    expect(count(html, 'role="search"')).toBe(1)
    // A real <select> with a real <label for>, not a custom listbox (§10).
    expect(html).toMatch(/<label for="[^"]+"[^>]*>מיון<\/label>/)
    expect(count(html, '<select')).toBe(1)
    expect(html).not.toContain('role="listbox"')
    for (const option of ['החדשים ביותר', 'מחיר: מהנמוך לגבוה', 'מחיר: מהגבוה לנמוך', 'הפופולריים ביותר']) {
      expect(count(html, option)).toBe(1)
    }
  })

  it('reflects the current q in the search field rather than starting empty (§10)', async () => {
    setCatalogData({
      products: [product()],
      totalItems: 1,
      hasNarrowingQuery: true,
      urlState: { ...EMPTY_CATALOG_URL_STATE, q: 'ויטמין' },
    })
    const html = await renderCatalog('/catalog?q=' + encodeURIComponent('ויטמין'))

    expect(html).toMatch(/<input[^>]*type="search"[^>]*value="ויטמין"/)
  })

  it('conveys filter grouping semantically — fieldset/legend, ID-valued checkboxes, facet labels', async () => {
    setFacets({
      brands: [{ id: 'brand-uuid-1', label: 'Solgar' }],
      dosageForms: [{ value: 'CAPSULE', labelHe: 'כמוסות', labelEn: 'Capsules' }],
    })
    setCatalogData({ products: [product()], totalItems: 1 })
    const html = await renderCatalog()

    // Brand + dosage form + price + availability = 4 fieldsets; the two
    // facet groups with no options render no fieldset at all (§9d — never
    // an option that can match nothing).
    expect(count(html, '<fieldset')).toBe(4)
    expect(count(html, '<legend')).toBe(4)
    expect(html).toContain('>מותג<')
    expect(html).toContain('>צורת מתן<')
    expect(html).not.toContain('>רכיב פעיל<')
    expect(html).not.toContain('>יעד בריאותי<')
    // 🔴 The label renders, the ID is what would be submitted — the label
    // never becomes a value.
    expect(html).toContain('Solgar')
    expect(html).toContain('type="checkbox"')
  })

  it('renders pagination as a named nav of real buttons with aria-current, and none for a single page', async () => {
    setCatalogData({ products: [product()], totalItems: 100, page: 2, totalPages: 5 })
    const paginated = await renderCatalog('/catalog?page=2')

    expect(paginated).toMatch(/<nav[^>]*aria-label="ניווט בין עמודי התוצאות"/)
    // Scoped to the pagination nav itself: the category shelf legitimately
    // carries its own aria-current="page", so a document-wide count would
    // assert nothing about this control.
    const paginationNav = paginated.slice(paginated.indexOf('aria-label="ניווט בין עמודי התוצאות"'))
    const navMarkup = paginationNav.slice(0, paginationNav.indexOf('</nav>'))
    expect(count(navMarkup, 'aria-current="page"')).toBe(1)
    expect(navMarkup).toContain('העמוד הקודם')
    expect(navMarkup).toContain('העמוד הבא')
    // Every page target is a real button — never bare clickable text (§10).
    expect(navMarkup).not.toContain('<a ')
    expect(count(navMarkup, '<button')).toBeGreaterThan(2)

    setCatalogData({ products: [product()], totalItems: 1, page: 1, totalPages: 1 })
    const single = await renderCatalog()
    expect(single).not.toContain('ניווט בין עמודי התוצאות')
  })

  it('renders the fallback as its own named region, never inside the results grid (§6b)', async () => {
    setCatalogData({
      products: [],
      totalItems: 0,
      hasNarrowingQuery: true,
      urlState: { ...EMPTY_CATALOG_URL_STATE, q: 'nothing-matches' },
      fallback: { kind: 'popular', limit: 8, items: [product({ slug: 'suggested', name: 'Suggested Product' })] },
    })
    const html = await renderCatalog('/catalog?q=nothing-matches')

    // Announced as suggestions, with its own heading and its own honest
    // count — never as results.
    expect(html).toContain('מוצרים פופולריים בקטלוג')
    expect(html).toContain('אלו הצעות, לא תוצאות החיפוש.')
    expect(html).toContain('מוצגת הצעה אחת')
    expect(html).toContain('Suggested Product')
    // The primary count stays truthful: zero results, despite one suggestion.
    // The numeral is LTR-isolated (correction, finding 4).
    expect(html).toContain('נמצאו <span dir="ltr">0</span> מוצרים')
    // Separate region: the fallback heading is NOT inside the results section.
    const resultsSection = html.slice(html.indexOf('<section aria-labelledby="catalog-grid-heading"'))
    const fallbackIndex = resultsSection.indexOf('מוצרים פופולריים בקטלוג')
    const sectionEnd = resultsSection.indexOf('</section>')
    expect(fallbackIndex).toBeGreaterThan(sectionEnd)
  })

  it('states what was searched in the zero-results copy (§10)', async () => {
    setCatalogData({
      products: [],
      totalItems: 0,
      hasNarrowingQuery: true,
      urlState: { ...EMPTY_CATALOG_URL_STATE, q: 'ויטמין C' },
    })
    const html = await renderCatalog('/catalog?q=' + encodeURIComponent('ויטמין C'))

    expect(html).toContain('לא נמצאו מוצרים התואמים לחיפוש &quot;ויטמין C&quot;')
  })
})

/**
 * Regression for a defect the Checkpoint I browser pass caught: a
 * zero-result SEARCH was rendering the category-specific empty heading
 * ("no products in this category") although no category was selected.
 */
describe('CatalogPage accessibility — zero-result heading honesty (Checkpoint I)', () => {
  it('uses the category heading only when a category is actually active', async () => {
    setCatalogData({
      products: [],
      totalItems: 0,
      hasNarrowingQuery: true,
      urlState: { ...EMPTY_CATALOG_URL_STATE, category: 'probiotics' },
    })
    const withCategory = await renderCatalog('/catalog?category=probiotics')
    expect(withCategory).toContain('אין מוצרים בקטגוריה הזו')
    expect(withCategory).not.toContain('לא נמצאו מוצרים')
  })

  it('uses a claim-free heading for a narrowing query with no category', async () => {
    setCatalogData({
      products: [],
      totalItems: 0,
      hasNarrowingQuery: true,
      urlState: { ...EMPTY_CATALOG_URL_STATE, q: 'zzz' },
    })
    const searchOnly = await renderCatalog('/catalog?q=zzz')
    expect(searchOnly).toContain('לא נמצאו מוצרים')
    expect(searchOnly).not.toContain('אין מוצרים בקטגוריה הזו')

    setCatalogData({
      products: [],
      totalItems: 0,
      hasNarrowingQuery: true,
      urlState: { ...EMPTY_CATALOG_URL_STATE, brand: ['brand-1'] },
    })
    const brandOnly = await renderCatalog('/catalog?brand=brand-1')
    expect(brandOnly).toContain('לא נמצאו מוצרים')
    expect(brandOnly).not.toContain('אין מוצרים בקטגוריה הזו')
  })
})

/**
 * MILESTONE-005 Checkpoint I correction — the four review findings, each
 * with a test that fails if the old behaviour returns.
 */
describe('CatalogPage — Checkpoint I correction regressions', () => {
  it('finding 1: the category shelf stays mounted during loading and error, so a category click cannot drop focus', async () => {
    setCatalogData({ loading: true, products: [product()], totalItems: 1 })
    const loading = await renderCatalog()
    expect(loading).toContain('ניווט קטגוריות')
    // …while still rendering no products (§9a unchanged).
    expect(loading).not.toContain('Some Product')

    setCatalogData({ loading: false, error: new CatalogApiError('UNKNOWN_ERROR', 'boom'), products: [product()] })
    const errored = await renderCatalog()
    expect(errored).toContain('ניווט קטגוריות')
    expect(errored).not.toContain('Some Product')
    expect(count(errored, 'role="alert"')).toBe(1)
  })

  it('finding 1: the shelf is rendered exactly once, not duplicated by the move', async () => {
    setCatalogData({ products: [product()], totalItems: 1 })
    const html = await renderCatalog()
    expect(count(html, 'ניווט קטגוריות')).toBe(1)
  })

  it('finding 3: the mobile trigger badge ignores q and category, which are not in the panel', async () => {
    setCatalogData({
      products: [product()],
      totalItems: 1,
      hasNarrowingQuery: true,
      urlState: { ...EMPTY_CATALOG_URL_STATE, q: 'omega', category: 'vitamins' },
    })
    const searchAndCategory = await renderCatalog('/catalog?q=omega&category=vitamins')
    // No count in the label, and no "N active filters" announcement.
    expect(searchAndCategory).toMatch(/<span aria-hidden="true">סינון<\/span>/)
    expect(searchAndCategory).not.toContain('מסננים פעילים')
    expect(searchAndCategory).not.toContain('מסנן אחד פעיל')

    setCatalogData({
      products: [product()],
      totalItems: 1,
      hasNarrowingQuery: true,
      urlState: { ...EMPTY_CATALOG_URL_STATE, brand: ['b1'] },
    })
    const brand = await renderCatalog('/catalog?brand=b1')
    expect(brand).toContain('סינון (1)')
    expect(brand).toContain('מסנן אחד פעיל')
  })

  it('finding 4: the interpolated result count is LTR-isolated', async () => {
    setCatalogData({ products: [product()], totalItems: 42 })
    const html = await renderCatalog()
    expect(html).toContain('נמצאו <span dir="ltr">42</span> מוצרים')
  })
})
