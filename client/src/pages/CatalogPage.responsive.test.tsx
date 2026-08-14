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
import { EMPTY_CATALOG_URL_STATE } from '../features/catalog/catalogUrlState'
import { CatalogPage } from './CatalogPage'

/**
 * Slice 9 Checkpoint F — durable responsive/directionality invariants for
 * the six integrated catalogue states. Deliberately NOT pixel-snapshot
 * tests (brittle, forbidden by the checkpoint scope) — these assert two
 * structural contracts that a live Playwright pass confirmed hold today
 * and that a future change could silently break:
 *
 *   1. The loading skeleton's grid and the ready-state product grid share
 *      the exact same Tailwind breakpoint/column classes — if one changes
 *      without the other, the skeleton stops previewing the real layout.
 *   2. No rendered class anywhere in any of the six states uses a
 *      physical-direction utility — CLAUDE.md rule 4 / design/
 *      DESIGN_SYSTEM.md §11 requires the logical-direction family (ms-/
 *      me-/ps-/pe-, text-start/text-end, start-/end-, border-s/border-e)
 *      so RTL and LTR share one implementation. Checked mechanically
 *      instead of only by code review, over the exact forbidden family
 *      §11 names — margin/padding (ml-/mr-/pl-/pr-, including variant
 *      prefixes and negative forms), text alignment (text-left/
 *      text-right), inset/positioning (left-/right-, including negative
 *      and arbitrary-value forms), and border sides (border-l/border-r).
 *      No family beyond §11's own list is invented here.
 *
 * Same no-jsdom/no-Testing-Library technique as `CatalogPage.a11y.test.tsx`
 * (self-contained per that file's own stated reasoning — importing from
 * another `*.test.tsx` would re-execute its `describe` blocks).
 */

void i18next.use(initReactI18next).init({
  lng: 'he',
  fallbackLng: 'he',
  resources: { he: { catalog: catalogHe, layout: layoutHe } },
  defaultNS: 'catalog',
  interpolation: { escapeValue: false },
})

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

const CATEGORY_VITAMINS: CatalogCategoryDto = { slug: 'vitamins', nameHe: 'ויטמינים', nameEn: 'Vitamins' }
const CATEGORIES = [CATEGORY_VITAMINS]

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
    // Checkpoint I additions — the response-reported page numbers.
    page: 1,
    totalPages: 0,
    fallback: null,
    urlState: EMPTY_CATALOG_URL_STATE,
    retry: vi.fn(),
    ...result,
  })
}

// 🔴 ISSUE-096 — static import, not `import()` inside the test: the dynamic
// form billed the whole CatalogPage module-graph transform to the FIRST
// test's 5s timeout, which is the under-load-only flake. See the fuller
// note in CatalogPage.a11y.test.tsx.
function renderCatalog(url = '/catalog'): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[url]}>
      <CatalogPage />
    </MemoryRouter>,
  )
}

/**
 * The exact physical-direction utility families design/DESIGN_SYSTEM.md
 * §11 forbids — no more, no fewer:
 *
 *   margin/padding   ml-* mr-* pl-* pr-*
 *   text alignment   text-left  text-right
 *   inset/position   left-*  right-*
 *   border side      border-l  border-l-*  border-r  border-r-*
 *
 * Their logical counterparts (ms-/me-/ps-/pe-, text-start/text-end,
 * start-/end-, border-s/border-e) are explicitly allowed and must never
 * be flagged.
 */
const FORBIDDEN_EXACT = new Set(['text-left', 'text-right'])
const FORBIDDEN_PREFIX_PATTERNS = [
  /^(ml|mr|pl|pr)-/, // margin/padding, incl. arbitrary values like pl-[10px]
  /^(left|right)-/, // inset/positioning, incl. arbitrary values like left-[10px]
  /^border-[lr](-|$)/, // border-l, border-l-2, border-r, border-r-4 — not border-s/border-e/border-t/...
]

/**
 * Strips every Tailwind variant prefix (responsive/state/rtl/ltr/etc,
 * chained or single — `sm:`, `md:hover:`, `rtl:`, `ltr:`) by cutting at
 * the first colon repeatedly, then strips one leading `-` (the negative-
 * value modifier, e.g. `-ml-2`, `sm:-mr-4`) to reach the base utility.
 */
function baseUtility(token: string): string {
  let rest = token
  let colonIndex = rest.indexOf(':')
  while (colonIndex !== -1) {
    rest = rest.slice(colonIndex + 1)
    colonIndex = rest.indexOf(':')
  }
  return rest.startsWith('-') ? rest.slice(1) : rest
}

function isForbiddenPhysicalDirection(token: string): boolean {
  const base = baseUtility(token)
  return FORBIDDEN_EXACT.has(base) || FORBIDDEN_PREFIX_PATTERNS.some((pattern) => pattern.test(base))
}

/** Every class token, anywhere in a class="..." attribute, that violates §11. */
function physicalDirectionClasses(html: string): string[] {
  const found: string[] = []
  for (const match of html.matchAll(/class="([^"]*)"/g)) {
    for (const token of match[1].split(/\s+/)) {
      if (token && isForbiddenPhysicalDirection(token)) {
        found.push(token)
      }
    }
  }
  return found
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
})

describe('CatalogPage responsive — skeleton/grid breakpoint parity', () => {
  it('the loading skeleton grid and the ready product grid use the exact same Tailwind grid/column classes', async () => {
    setCatalogData({ loading: true })
    const loadingHtml = await renderCatalog()
    const skeletonUl = /<ul class="([^"]*grid[^"]*)" aria-hidden="true">/.exec(loadingHtml)?.[1]
    expect(skeletonUl).toBeDefined()

    setCatalogData({ products: [product()], totalItems: 1 })
    const readyHtml = await renderCatalog()
    const readyUl = /<ul class="([^"]*grid[^"]*)">/.exec(readyHtml)?.[1]
    expect(readyUl).toBeDefined()

    expect(skeletonUl).toBe(readyUl)
    expect(skeletonUl).toContain('grid-cols-1')
    expect(skeletonUl).toContain('min-[420px]:grid-cols-2')
    expect(skeletonUl).toContain('lg:grid-cols-3')
    expect(skeletonUl).toContain('xl:grid-cols-4')
  })
})

type PhysicalDirectionCase = { name: string; data: Partial<UseCatalogDataResult>; url?: string }

const PHYSICAL_DIRECTION_CASES: PhysicalDirectionCase[] = [
  { name: 'loading', data: { loading: true } },
  { name: 'error', data: { error: new CatalogApiError('UNKNOWN_ERROR', 'boom') } },
  {
    name: 'invalid-category',
    data: { products: [product()], invalidCategory: true, urlState: { ...EMPTY_CATALOG_URL_STATE, category: 'not-a-real-category' } },
    url: '/catalog?category=not-a-real-category',
  },
  { name: 'catalog-empty', data: { products: [] } },
  {
    name: 'filtered-empty',
    data: { products: [], hasNarrowingQuery: true, totalItems: 0, urlState: { ...EMPTY_CATALOG_URL_STATE, category: 'vitamins' } },
    url: '/catalog?category=vitamins',
  },
  { name: 'ready', data: { products: [product()], totalItems: 1 } },
]

describe('CatalogPage responsive — no physical-direction CSS (design/DESIGN_SYSTEM.md §11)', () => {
  it.each(PHYSICAL_DIRECTION_CASES)('$name state renders no forbidden physical-direction class', async ({ data, url }) => {
    setCatalogData(data)
    const html = await renderCatalog(url)

    expect(physicalDirectionClasses(html)).toEqual([])
  })
})

/**
 * `physicalDirectionClasses` unit contract — Codex Major correction.
 * The original detector only matched a bare `^(ml|mr|pl|pr)-` prefix, so
 * it silently missed variant-prefixed forms (`sm:ml-2`), negative forms
 * (`-ml-2`, `sm:-mr-4`), and every non-margin/padding family §11 also
 * forbids (text-left/text-right, left-/right-, border-l/border-r). These
 * tests exercise the detector directly against synthetic markup — proving
 * the function's contract, not just today's rendered output, which could
 * happen to avoid every gap by coincidence.
 */
describe('physicalDirectionClasses — detector contract', () => {
  it('detects a variant-prefixed margin/padding utility (sm:ml-2)', () => {
    expect(physicalDirectionClasses('<div class="sm:ml-2 flex"></div>')).toEqual(['sm:ml-2'])
  })

  it('detects a chained-variant margin/padding utility (md:hover:pr-4)', () => {
    expect(physicalDirectionClasses('<div class="md:hover:pr-4"></div>')).toEqual(['md:hover:pr-4'])
  })

  it('detects rtl:/ltr: variant-prefixed forms (rtl:mr-1, ltr:pl-3)', () => {
    expect(physicalDirectionClasses('<div class="rtl:mr-1 ltr:pl-3"></div>')).toEqual(['rtl:mr-1', 'ltr:pl-3'])
  })

  it('detects negative margin/padding forms (-ml-2, sm:-mr-4)', () => {
    expect(physicalDirectionClasses('<div class="-ml-2 sm:-mr-4"></div>')).toEqual(['-ml-2', 'sm:-mr-4'])
  })

  it('detects physical text alignment, including variant-prefixed (text-left, sm:text-right)', () => {
    expect(physicalDirectionClasses('<p class="text-left"></p>')).toEqual(['text-left'])
    expect(physicalDirectionClasses('<p class="sm:text-right"></p>')).toEqual(['sm:text-right'])
  })

  it('detects physical inset/positioning, including negative, arbitrary-value, and variant-prefixed forms', () => {
    expect(physicalDirectionClasses('<div class="left-2"></div>')).toEqual(['left-2'])
    expect(physicalDirectionClasses('<div class="right-4"></div>')).toEqual(['right-4'])
    expect(physicalDirectionClasses('<div class="left-[10px]"></div>')).toEqual(['left-[10px]'])
    expect(physicalDirectionClasses('<div class="-left-4"></div>')).toEqual(['-left-4'])
    expect(physicalDirectionClasses('<div class="sm:right-2"></div>')).toEqual(['sm:right-2'])
  })

  it('detects physical border-side utilities, bare and with a width modifier, including variant-prefixed', () => {
    expect(physicalDirectionClasses('<div class="border-l"></div>')).toEqual(['border-l'])
    expect(physicalDirectionClasses('<div class="border-l-2"></div>')).toEqual(['border-l-2'])
    expect(physicalDirectionClasses('<div class="border-r"></div>')).toEqual(['border-r'])
    expect(physicalDirectionClasses('<div class="border-r-4"></div>')).toEqual(['border-r-4'])
    expect(physicalDirectionClasses('<div class="md:border-l"></div>')).toEqual(['md:border-l'])
  })

  it('does not flag the logical-direction alternatives §11 explicitly allows', () => {
    const html =
      '<div class="ms-2 me-4 ps-3 pe-4 -ms-2 sm:me-2 start-2 end-4 border-s border-e text-start text-end"></div>'
    expect(physicalDirectionClasses(html)).toEqual([])
  })

  it('does not flag unrelated utilities that merely contain similar substrings', () => {
    // mt-/mb-/gap-/grid-cols- must never be mistaken for ml-/mr-/pl-/pr-,
    // and border-t/border-b/border-x/border-y/border-color must never be
    // mistaken for border-l/border-r.
    const html =
      '<div class="mt-2 mb-4 gap-3 grid-cols-4 border-t border-b border-x border-y border collapse"></div>'
    expect(physicalDirectionClasses(html)).toEqual([])
  })
})

/**
 * MILESTONE-005 Checkpoint I — the responsive filter surface. One panel,
 * two mountings: a desktop rail and (below `md`) the shared `Drawer`.
 * The breakpoint here is `md` (768px) deliberately, because
 * `useCloseAboveBreakpoint` — which closes the drawer when the viewport
 * grows — hardcodes that same `md` query. If the trigger were hidden at a
 * DIFFERENT breakpoint than the auto-close, there would be a band of widths
 * where the drawer is open with its trigger invisible, or closed while the
 * rail is still hidden.
 */
describe('CatalogPage responsive — filter surface breakpoint parity (Checkpoint I)', () => {
  it('hides the mobile filter trigger and shows the rail at exactly the same breakpoint useCloseAboveBreakpoint uses', async () => {
    setCatalogData({ products: [product()], totalItems: 1 })
    const html = await renderCatalog()

    // The trigger: visible below md, hidden from md up.
    expect(html).toMatch(/<button[^>]*aria-haspopup="dialog"[^>]*class="[^"]*md:hidden/)
    // The rail: hidden below md, shown from md up — the exact complement.
    expect(html).toMatch(/<aside[^>]*class="hidden [^"]*md:block/)
  })

  it('renders the filter panel exactly once in the accessibility tree (the drawer copy is unmounted while closed)', async () => {
    setCatalogData({ products: [product()], totalItems: 1 })
    const html = await renderCatalog()

    // Only the rail's copy exists; Drawer mounts nothing while closed, so
    // the availability fieldset — present in every panel — appears once.
    expect(html.split('רק מוצרים במלאי').length - 1).toBe(1)
    expect(html).not.toContain('role="dialog"')
  })

  it('renders fallback suggestions through the same grid as the primary results', async () => {
    setCatalogData({
      products: [],
      totalItems: 0,
      hasNarrowingQuery: true,
      urlState: { ...EMPTY_CATALOG_URL_STATE, q: 'no-match' },
      fallback: { kind: 'popular', limit: 8, items: [product({ slug: 'suggested' })] },
    })
    const html = await renderCatalog('/catalog?q=no-match')

    // The same responsive column contract as the primary grid — one grid
    // implementation, not a second one for suggestions.
    expect(html).toContain('grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 md:gap-4')
    expect(physicalDirectionClasses(html)).toEqual([])
  })
})
