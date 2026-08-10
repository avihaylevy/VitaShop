import i18next from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { initReactI18next } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CatalogApiError } from '../lib/catalogApi'
import catalogHe from '../locales/he/catalog.json'
import layoutHe from '../locales/he/layout.json'
import type { ProductDetailModel } from '../types/product'
import type { UseProductDetailResult } from '../hooks/useProductDetail'

/**
 * MILESTONE-005 Checkpoint J — the Product Details accessibility and
 * contract surface (§7, §7a, §7b, §7c), exercised through the real page so
 * integration-level defects are caught, not just component shapes.
 *
 * Same technique and same constraint as `CatalogPage.a11y.test.tsx`:
 * `renderToStaticMarkup` under vitest's default `node` environment, with a
 * test-local i18next instance (the app singleton touches `document` at
 * import time). Interaction, real focus movement and computed CSS are the
 * Playwright pass's job, not this file's.
 */

void i18next.use(initReactI18next).init({
  lng: 'he',
  fallbackLng: 'he',
  resources: { he: { catalog: catalogHe, layout: layoutHe } },
  defaultNS: 'catalog',
  interpolation: { escapeValue: false },
})

// Typed with the hook's real parameters so the mock cannot drift from the
// call site it stands in for.
const mockUseProductDetail = vi.fn<(slug: string, language: string) => UseProductDetailResult>()
vi.mock('../hooks/useProductDetail', () => ({
  useProductDetail: (slug: string, language: string) => mockUseProductDetail(slug, language),
}))

function product(overrides: Partial<ProductDetailModel> = {}): ProductDetailModel {
  return {
    slug: 'solgar-omega-3',
    name: 'אומגה 3',
    categoryNameHe: 'אומגה ושומנים',
    categoryName: 'אומגה ושומנים',
    price: '94.90',
    stockQuantity: 60,
    lowStockThreshold: 5,
    brandName: 'סולגאר',
    dosageForm: 'כמוסות',
    packageQuantity: 100,
    imageFile: 'אומגה 3 של חברת סולגאר.jpg',
    serialNumber: 'b7c1e0a2-uuid',
    usageInstructions: 'כמוסה אחת ביום עם ארוחה',
    // 🔴 Real basenames from `lib/productImages.ts`. A filename with no
    // imported asset makes `ProductImage` degrade to its empty well — which
    // renders no <img> and therefore no alt text at all — so a fabricated
    // filename here would silently make the alt-text assertions below
    // unfalsifiable.
    images: ['אומגה 3 של חברת סולגאר.jpg', 'סולגר טבליות ויטמין B12.jpg'],
    description: 'תיאור המוצר בעברית',
    warningsAllergens: 'מכיל דגים',
    ingredients: [
      { name: 'EPA', amount: '180.00', unit: 'mg' },
      { name: 'DHA', amount: '120.00', unit: 'mg' },
    ],
    healthGoals: ['לב וכלי דם', 'מוח וזיכרון'],
    targetAudience: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function setDetail(result: Partial<UseProductDetailResult>) {
  mockUseProductDetail.mockReturnValue({
    loading: false,
    product: null,
    error: null,
    notFound: false,
    retry: vi.fn(),
    ...result,
  })
}

function renderPage(slug = 'solgar-omega-3') {
  return import('./ProductDetailsPage').then(({ ProductDetailsPage }) =>
    renderToStaticMarkup(
      <MemoryRouter initialEntries={[`/product/${slug}`]}>
        <Routes>
          <Route path="/product/:slug" element={<ProductDetailsPage />} />
        </Routes>
      </MemoryRouter>,
    ),
  )
}

function count(html: string, needle: string): number {
  return html.split(needle).length - 1
}

beforeEach(() => {
  mockUseProductDetail.mockReset()
})

describe('ProductDetailsPage — the four §7 states', () => {
  it('loading: a polite status region, no alert, no product content', async () => {
    setDetail({ loading: true, product: product() })
    const html = await renderPage()

    expect(count(html, 'role="status"')).toBe(1)
    expect(html).toContain('טוען את פרטי המוצר')
    expect(html).not.toContain('role="alert"')
    // 🔴 No stale product renders underneath the loading state.
    expect(html).not.toContain('אומגה 3')
    expect(html).not.toContain('b7c1e0a2-uuid')
  })

  it('error: one alert, a real retry button, no product content and no raw error text', async () => {
    setDetail({ error: new CatalogApiError('NETWORK_ERROR', 'connection refused to 10.0.0.5'), product: product() })
    const html = await renderPage()

    expect(count(html, 'role="alert"')).toBe(1)
    expect(html).toContain('לא ניתן לטעון את פרטי המוצר')
    expect(html).toMatch(/<button[^>]*>[\s\S]*?נסה שוב[\s\S]*?<\/button>/)
    // The error's own message must never reach the page.
    expect(html).not.toContain('connection refused')
    expect(html).not.toContain('אומגה 3')
  })

  it('not-found: one heading, an explanation, a real back control, no alert', async () => {
    setDetail({ notFound: true })
    const html = await renderPage('does-not-exist')

    expect(html).toContain('המוצר לא נמצא')
    expect(html).toContain('אינו קיים או אינו זמין יותר')
    expect(count(html, '<h1')).toBe(1)
    expect(html).toMatch(/<button[^>]*>[\s\S]*?חזרה לקטלוג[\s\S]*?<\/button>/)
    expect(html).not.toContain('role="alert"')
  })

  it('not-found says the same thing for an absent and an inactive product (§7)', async () => {
    // The client cannot tell them apart — the server returns an identical
    // 404 for both — so there must be exactly ONE not-found presentation.
    setDetail({ notFound: true })
    const absent = await renderPage('never-existed')
    const inactive = await renderPage('soft-deleted-product')

    const stripSlug = (html: string) => html.replace(/never-existed|soft-deleted-product/g, 'SLUG')
    expect(stripSlug(absent)).toBe(stripSlug(inactive))
  })

  it('ready: renders the product', async () => {
    setDetail({ product: product() })
    const html = await renderPage()

    expect(html).toContain('אומגה 3')
    expect(html).not.toContain('role="alert"')
    expect(html).not.toContain('role="status"')
  })
})

describe('ProductDetailsPage — §7a/§7b field surface', () => {
  it('renders every field the DTO carries that has a place on the page', async () => {
    setDetail({ product: product({ targetAudience: 'מבוגרים' }) })
    const html = await renderPage()

    expect(html).toContain('אומגה 3') // 02
    expect(html).toContain('אומגה ושומנים') // 03
    expect(html).toContain('סולגאר') // 04
    expect(html).toContain('כמוסות') // 05
    expect(html).toContain('100') // 06
    expect(html).toContain('כמוסה אחת ביום עם ארוחה') // 07
    expect(html).toContain('94.90') // 08
    expect(html).toContain('תיאור המוצר בעברית') // 11
    expect(html).toContain('מכיל דגים') // 12
    expect(html).toContain('EPA') // 13
    expect(html).toContain('180.00') // 13
    expect(html).toContain('לב וכלי דם') // 14
    expect(html).toContain('מבוגרים') // 15
    expect(html).toContain('2026-01-01') // 16
  })

  it('shows serialNumber as read-only text — never an input, a link or a form value (§7b)', async () => {
    setDetail({ product: product() })
    const html = await renderPage()

    expect(html).toContain('b7c1e0a2-uuid')
    // It appears exactly once, inside a <dd>, and nowhere that could send
    // it back to the server.
    expect(count(html, 'b7c1e0a2-uuid')).toBe(1)
    expect(html).not.toMatch(/<input[^>]*b7c1e0a2-uuid/)
    expect(html).not.toMatch(/<a[^>]*b7c1e0a2-uuid/)
    expect(html).not.toMatch(/href="[^"]*b7c1e0a2-uuid/)
    expect(html).not.toContain('<form')
  })

  it('omits a null targetAudience entirely rather than rendering an empty row', async () => {
    setDetail({ product: product({ targetAudience: null }) })
    const html = await renderPage()
    expect(html).not.toContain('קהל יעד')
  })

  it('renders no ingredients or health-goal section when those sets are empty', async () => {
    setDetail({ product: product({ ingredients: [], healthGoals: [] }) })
    const html = await renderPage()

    expect(html).not.toContain('רכיבים פעילים')
    expect(html).not.toContain('יעדי בריאות')
    expect(html).not.toContain('<table')
  })
})

describe('ProductDetailsPage — accessibility structure', () => {
  it('has exactly one h1 and no skipped heading level', async () => {
    setDetail({ product: product() })
    const html = await renderPage()

    expect(count(html, '<h1')).toBe(1)
    expect(count(html, '<h2')).toBeGreaterThan(0)
    // No h3+ exists, so no level can have been skipped past h2.
    expect(html).not.toContain('<h3')
    expect(html).not.toContain('<h4')
  })

  it('names every section it labels, and gives each image a distinct alt', async () => {
    setDetail({ product: product() })
    const html = await renderPage()

    expect(html).toMatch(/<section[^>]*aria-label="תמונות המוצר"/)
    expect(count(html, 'aria-labelledby="product-description"')).toBe(1)
    expect(count(html, 'aria-labelledby="product-ingredients"')).toBe(1)

    // Per-image alt text naming the product and the position — never an
    // empty alt, never the same string twice.
    expect(html).toContain('alt="אומגה 3 — תמונה 1 מתוך 2"')
    expect(html).toContain('alt="אומגה 3 — תמונה 2 מתוך 2"')
    expect(html).not.toContain('alt=""')
  })

  it('uses real table semantics for the ingredient table', async () => {
    setDetail({ product: product() })
    const html = await renderPage()

    expect(html).toContain('<table')
    expect(html).toContain('<caption')
    expect(count(html, 'scope="col"')).toBe(2)
    expect(html).toContain('<tbody>')
    // Two ingredients -> two body rows.
    expect(count(html, '<tr')).toBe(3)
  })

  it('uses a description list, not a table, for the single-product specifications', async () => {
    setDetail({ product: product() })
    const html = await renderPage()

    expect(html).toContain('<dl')
    expect(count(html, '<dt')).toBeGreaterThanOrEqual(5)
    expect(count(html, '<dt')).toBe(count(html, '<dd'))
  })

  it('LTR-isolates numerals and the serial number inside Hebrew RTL text', async () => {
    setDetail({ product: product() })
    const html = await renderPage()

    expect(html).toMatch(/<dd[^>]*dir="ltr"[^>]*>100<\/dd>/)
    expect(html).toMatch(/<time[^>]*dir="ltr"/)
    expect(html).toMatch(/<span dir="ltr">180\.00 mg<\/span>/)
    expect(html).toMatch(/<dd[^>]*dir="ltr"[^>]*>b7c1e0a2-uuid<\/dd>/)
  })

  it('carries a machine-readable datetime on the date-added value', async () => {
    setDetail({ product: product() })
    const html = await renderPage()
    // Case-insensitive: React serializes this attribute as `dateTime`, and
    // HTML attribute names are case-insensitive to the parser either way.
    expect(html).toMatch(/datetime="2026-01-01T00:00:00\.000Z"/i)
  })

  it('uses only logical-direction utilities — no physical ml/mr/pl/pr/left/right', async () => {
    setDetail({ product: product() })
    const html = await renderPage()

    const classes = [...html.matchAll(/class="([^"]*)"/g)].flatMap((match) => match[1].split(/\s+/))
    const physical = classes.filter((cls) =>
      /^-?(?:[a-z]+:)*-?(?:ml|mr|pl|pr)-|^(?:[a-z]+:)*(?:text-left|text-right|left-|right-|border-l|border-r)/.test(cls),
    )
    expect(physical).toEqual([])
  })
})

describe('ProductDetailsPage — §7c i18n', () => {
  it('resolves every visible label through the catalog namespace — no missing-key leakage', async () => {
    setDetail({ product: product({ targetAudience: 'מבוגרים' }) })
    const html = await renderPage()

    // A missing i18next key renders as the raw key path; none may appear.
    expect(html).not.toContain('productDetails.')
    expect(html).not.toContain('catalog:')
    for (const label of ['מותג', 'קטגוריה', 'צורת מתן', 'יחידות באריזה', 'תאריך הוספה', 'מספר סידורי']) {
      expect(html).toContain(label)
    }
  })

  it('renders no English UI chrome while in Hebrew — the labels come from the locale, not the code', async () => {
    setDetail({ product: product() })
    const html = await renderPage()

    for (const hardcoded of ['Brand', 'Category', 'Serial number', 'Back to the catalogue', 'How to use']) {
      expect(html).not.toContain(hardcoded)
    }
  })
})
