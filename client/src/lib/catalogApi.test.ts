import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CatalogApiError,
  fetchCatalogCategories,
  fetchCatalogFacets,
  fetchCatalogProducts,
  fetchProductDetail,
} from './catalogApi.js'
import type { CatalogProductDto } from '../types/catalog.js'

const BASE_URL = 'http://localhost:3000'

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

function validProduct(overrides: Partial<CatalogProductDto> = {}): CatalogProductDto {
  return {
    slug: 'solgar-omega-3',
    nameHe: 'אומגה 3',
    nameEn: 'Omega 3',
    categoryNameHe: 'אומגה ושומנים',
    categoryNameEn: 'Omega & Fats',
    categorySlug: 'omega-fats',
    brandName: 'סולגאר',
    brandNameEn: 'Solgar',
    dosageForm: 'CAPSULE',
    packageQuantity: 100,
    price: '94.90',
    stockQuantity: 60,
    lowStockThreshold: 5,
    imageFile: 'solgar-omega-3.jpg',
  shortDescriptionHe: 'תקציר בדיקה',
  shortDescriptionEn: 'Fixture short description',
    ...overrides,
  }
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', BASE_URL)
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('fetchCatalogProducts', () => {
  it('resolves with the full envelope on a valid 200 response', async () => {
    const product = validProduct()
    const envelope = { items: [product], page: 1, pageSize: 24, totalItems: 1, totalPages: 1, fallback: null }
    fetchMock.mockResolvedValue(mockResponse(200, envelope))
    await expect(fetchCatalogProducts()).resolves.toEqual(envelope)
  })

  it('resolves with a populated fallback when the server includes one', async () => {
    const fallbackItem = validProduct({ slug: 'fallback-product' })
    const envelope = {
      items: [],
      page: 1,
      pageSize: 24,
      totalItems: 0,
      totalPages: 0,
      fallback: { kind: 'popular', items: [fallbackItem], limit: 8 },
    }
    fetchMock.mockResolvedValue(mockResponse(200, envelope))
    await expect(fetchCatalogProducts()).resolves.toEqual(envelope)
  })

  it('sends no query parameters when called without params', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, { items: [], page: 1, pageSize: 24, totalItems: 0, totalPages: 0, fallback: null }))
    await fetchCatalogProducts()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url] = fetchMock.mock.calls[0] as [string, unknown]
    expect(url).toBe(`${BASE_URL}/api/products`)
  })

  it('forwards a non-empty params string as the query', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, { items: [], page: 1, pageSize: 24, totalItems: 0, totalPages: 0, fallback: null }))
    const params = new URLSearchParams()
    params.append('category', 'vitamins')
    params.append('sort', 'price-asc')
    await fetchCatalogProducts(params)
    const [url] = fetchMock.mock.calls[0] as [string, unknown]
    expect(url).toBe(`${BASE_URL}/api/products?category=vitamins&sort=price-asc`)
  })

  it('rejects with INVALID_RESPONSE_SHAPE on a malformed envelope (items not an array)', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, { items: 'not-an-array', page: 1, pageSize: 24, totalItems: 0, totalPages: 0, fallback: null }))
    await expect(fetchCatalogProducts()).rejects.toMatchObject({ code: 'INVALID_RESPONSE_SHAPE' })
  })

  it('rejects with INVALID_RESPONSE_SHAPE when fallback is malformed', async () => {
    fetchMock.mockResolvedValue(
      mockResponse(200, { items: [], page: 1, pageSize: 24, totalItems: 0, totalPages: 0, fallback: { kind: 'bogus', items: [], limit: 8 } }),
    )
    await expect(fetchCatalogProducts()).rejects.toMatchObject({ code: 'INVALID_RESPONSE_SHAPE' })
  })

  it('rejects the whole response when a single product item is malformed — no partial acceptance', async () => {
    const good = validProduct()
    const bad = validProduct({ slug: 'bad', price: '94.9' }) // not two-decimal
    fetchMock.mockResolvedValue(mockResponse(200, { items: [good, bad], page: 1, pageSize: 24, totalItems: 2, totalPages: 1, fallback: null }))
    await expect(fetchCatalogProducts()).rejects.toBeInstanceOf(CatalogApiError)
  })

  it('rejects with a typed error carrying the server code/message/fields on a non-2xx structured error', async () => {
    fetchMock.mockResolvedValue(
      mockResponse(400, { error: { code: 'UNSUPPORTED_QUERY_PARAMETER', message: 'Unsupported query parameter(s): foo', fields: ['foo'] } }),
    )
    await expect(fetchCatalogProducts()).rejects.toMatchObject({
      code: 'UNSUPPORTED_QUERY_PARAMETER',
      message: 'Unsupported query parameter(s): foo',
      fields: ['foo'],
      status: 400,
    })
  })

  it('rejects with MISSING_CONFIG and never calls fetch when the API base URL is not configured', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '')
    await expect(fetchCatalogProducts()).rejects.toMatchObject({ code: 'MISSING_CONFIG' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('propagates an AbortError unchanged, not wrapped as a CatalogApiError, when the signal is actually aborted', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError')
    fetchMock.mockRejectedValue(abortError)
    const controller = new AbortController()
    controller.abort()
    const promise = fetchCatalogProducts(undefined, controller.signal)
    await expect(promise).rejects.toBe(abortError)
    await promise.catch((err: unknown) => {
      expect(err).not.toBeInstanceOf(CatalogApiError)
      expect((err as Error).name).toBe('AbortError')
    })
  })

  it('wraps a rejection as NETWORK_ERROR when the signal was never aborted, even if the rejection reason looks like an AbortError (correction #3 — signal.aborted is the source of truth, not error.name)', async () => {
    const abortLikeError = new DOMException('The operation was aborted.', 'AbortError')
    fetchMock.mockRejectedValue(abortLikeError)
    const controller = new AbortController()
    // Deliberately never aborted.
    await expect(fetchCatalogProducts(undefined, controller.signal)).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
  })

  it('rejects with NETWORK_ERROR when fetch itself fails for a non-abort reason', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(fetchCatalogProducts()).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
  })
})

describe('fetchCatalogCategories', () => {
  it('resolves with items on a valid 200 response', async () => {
    const category = { slug: 'vitamins', nameHe: 'ויטמינים', nameEn: 'Vitamins' }
    fetchMock.mockResolvedValue(mockResponse(200, { items: [category] }))
    await expect(fetchCatalogCategories()).resolves.toEqual([category])
  })

  it('sends no query parameters', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, { items: [] }))
    await fetchCatalogCategories()
    const [url] = fetchMock.mock.calls[0] as [string, unknown]
    expect(url).toBe(`${BASE_URL}/api/categories`)
  })

  it('rejects with INVALID_RESPONSE_SHAPE on a malformed category item', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, { items: [{ slug: 'vitamins', nameHe: 'ויטמינים' }] }))
    await expect(fetchCatalogCategories()).rejects.toMatchObject({ code: 'INVALID_RESPONSE_SHAPE' })
  })
})

// MILESTONE-005 Checkpoint J — §7.
describe('fetchProductDetail', () => {
  function detail(overrides: Record<string, unknown> = {}) {
    return {
      ...validProduct(),
      serialNumber: 'uuid-1',
      usageInstructions: 'כמוסה אחת ביום',
      images: ['a.jpg', 'b.jpg'],
      descriptionHe: 'תיאור',
      descriptionEn: 'Description',
      warningsAllergens: 'מכיל דגים',
      allergenInfoIncomplete: false,
      ingredients: [{ name: 'EPA', amount: '180.00', unit: 'mg' }],
      healthGoals: [{ nameHe: 'לב', nameEn: 'Heart' }],
      targetAudience: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    }
  }

  it('resolves with the detail DTO on a valid 200 response', async () => {
    const body = detail()
    fetchMock.mockResolvedValue(mockResponse(200, body))
    await expect(fetchProductDetail('solgar-omega-3')).resolves.toEqual(body)
  })

  it('percent-encodes the slug into the path', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, detail()))
    await fetchProductDetail('ויטמין c/../admin')
    const [url] = fetchMock.mock.calls[0] as [string, unknown]
    expect(url).toBe(`${BASE_URL}/api/products/${encodeURIComponent('ויטמין c/../admin')}`)
    // The traversal segment cannot survive encoding into a real path.
    expect(url).not.toContain('/../')
  })

  it('surfaces the server 404 as PRODUCT_NOT_FOUND with its status intact', async () => {
    fetchMock.mockResolvedValue(
      mockResponse(404, { error: { code: 'PRODUCT_NOT_FOUND', message: 'The requested product was not found.' } }),
    )
    await expect(fetchProductDetail('nope')).rejects.toMatchObject({ code: 'PRODUCT_NOT_FOUND', status: 404 })
  })

  it('surfaces a data-integrity 500 unchanged', async () => {
    fetchMock.mockResolvedValue(mockResponse(500, { error: { code: 'CATALOG_DATA_INTEGRITY', message: 'boom' } }))
    await expect(fetchProductDetail('x')).rejects.toMatchObject({ code: 'CATALOG_DATA_INTEGRITY', status: 500 })
  })

  it('rejects a response missing serialNumber — field 01 is not optional', async () => {
    const { serialNumber: _omitted, ...withoutSerial } = detail()
    fetchMock.mockResolvedValue(mockResponse(200, withoutSerial))
    await expect(fetchProductDetail('x')).rejects.toMatchObject({ code: 'INVALID_RESPONSE_SHAPE' })
  })

  it('rejects an empty serialNumber', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, detail({ serialNumber: '' })))
    await expect(fetchProductDetail('x')).rejects.toMatchObject({ code: 'INVALID_RESPONSE_SHAPE' })
  })

  it('rejects a response that is only a LIST product — the detail half must be present', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, validProduct()))
    await expect(fetchProductDetail('x')).rejects.toMatchObject({ code: 'INVALID_RESPONSE_SHAPE' })
  })

  it('rejects a malformed ingredient row', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, detail({ ingredients: [{ name: 'EPA', amount: 180, unit: 'mg' }] })))
    await expect(fetchProductDetail('x')).rejects.toMatchObject({ code: 'INVALID_RESPONSE_SHAPE' })
  })

  it('rejects a health goal missing a language', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, detail({ healthGoals: [{ nameHe: 'לב' }] })))
    await expect(fetchProductDetail('x')).rejects.toMatchObject({ code: 'INVALID_RESPONSE_SHAPE' })
  })

  it('accepts a null targetAudience but rejects a missing one', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, detail({ targetAudience: null })))
    await expect(fetchProductDetail('x')).resolves.toMatchObject({ targetAudience: null })

    const { targetAudience: _dropped, ...withoutTarget } = detail()
    fetchMock.mockResolvedValue(mockResponse(200, withoutTarget))
    await expect(fetchProductDetail('x')).rejects.toMatchObject({ code: 'INVALID_RESPONSE_SHAPE' })
  })

  // DEC-032 DECISION B. 🔴 A MISSING flag must REJECT, never default to false:
  // false is the value that renders the allergen text as though it were the
  // manufacturer's complete declaration, so a silent default would turn a
  // server that forgot the field into a page that quietly overstates it.
  it('requires allergenInfoIncomplete — a missing or non-boolean flag is INVALID_RESPONSE_SHAPE', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, detail({ allergenInfoIncomplete: true })))
    await expect(fetchProductDetail('x')).resolves.toMatchObject({ allergenInfoIncomplete: true })

    const { allergenInfoIncomplete: _dropped, ...withoutFlag } = detail()
    fetchMock.mockResolvedValue(mockResponse(200, withoutFlag))
    await expect(fetchProductDetail('x')).rejects.toMatchObject({ code: 'INVALID_RESPONSE_SHAPE' })

    fetchMock.mockResolvedValue(mockResponse(200, detail({ allergenInfoIncomplete: 'yes' })))
    await expect(fetchProductDetail('x')).rejects.toMatchObject({ code: 'INVALID_RESPONSE_SHAPE' })
  })

  it('accepts empty ingredient and health-goal arrays', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, detail({ ingredients: [], healthGoals: [] })))
    await expect(fetchProductDetail('x')).resolves.toMatchObject({ ingredients: [], healthGoals: [] })
  })

  it('propagates an abort unchanged rather than wrapping it as a failure', async () => {
    const controller = new AbortController()
    controller.abort()
    fetchMock.mockRejectedValue(new DOMException('The operation was aborted.', 'AbortError'))
    await expect(fetchProductDetail('x', controller.signal)).rejects.not.toBeInstanceOf(CatalogApiError)
  })
})

// MILESTONE-005 Checkpoint I — §9d.
describe('fetchCatalogFacets', () => {
  const facets = {
    brands: [{ id: 'b1', label: 'סולגאר', labelEn: 'Solgar' }],
    ingredients: [{ id: 'i1', label: 'Omega 3' }],
    healthGoals: [{ id: 'g1', labelHe: 'חיזוק חיסוני', labelEn: 'Immune support' }],
    dosageForms: [{ value: 'CAPSULE', labelHe: 'כמוסות', labelEn: 'Capsules' }],
    dietary: [{ value: 'kosher', labelHe: 'כשר', labelEn: 'Kosher' }],
  }

  it('resolves with the UNWRAPPED payload — the server sends no items envelope here', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, facets))
    await expect(fetchCatalogFacets()).resolves.toEqual(facets)
  })

  it('accepts an entirely empty facet payload', async () => {
    const empty = { brands: [], ingredients: [], healthGoals: [], dosageForms: [], dietary: [] }
    fetchMock.mockResolvedValue(mockResponse(200, empty))
    await expect(fetchCatalogFacets()).resolves.toEqual(empty)
  })

  it('requests the frozen path and sends no query parameters (the server 400s on any)', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, facets))
    await fetchCatalogFacets()
    const [url] = fetchMock.mock.calls[0] as [string, unknown]
    expect(url).toBe(`${BASE_URL}/api/catalog/facets`)
  })

  it('rejects with INVALID_RESPONSE_SHAPE when a facet group is missing entirely', async () => {
    const { dosageForms: _omitted, ...withoutDosageForms } = facets
    fetchMock.mockResolvedValue(mockResponse(200, withoutDosageForms))
    await expect(fetchCatalogFacets()).rejects.toMatchObject({ code: 'INVALID_RESPONSE_SHAPE' })
  })

  it('rejects a brand/ingredient option missing its id or label', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, { ...facets, brands: [{ label: 'Solgar' }] }))
    await expect(fetchCatalogFacets()).rejects.toMatchObject({ code: 'INVALID_RESPONSE_SHAPE' })
  })

  it('rejects a health goal that carries only one language', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, { ...facets, healthGoals: [{ id: 'g1', labelHe: 'חיזוק חיסוני' }] }))
    await expect(fetchCatalogFacets()).rejects.toMatchObject({ code: 'INVALID_RESPONSE_SHAPE' })
  })

  it('rejects a dosage form outside the frozen enum — an unknown value would be an unusable filter', async () => {
    fetchMock.mockResolvedValue(
      mockResponse(200, { ...facets, dosageForms: [{ value: 'GUMMY', labelHe: 'סוכריות', labelEn: 'Gummies' }] }),
    )
    await expect(fetchCatalogFacets()).rejects.toMatchObject({ code: 'INVALID_RESPONSE_SHAPE' })
  })

  it('rejects a dietary value outside the frozen three — an unknown value would be an unusable filter', async () => {
    fetchMock.mockResolvedValue(
      mockResponse(200, { ...facets, dietary: [{ value: 'organic', labelHe: 'אורגני', labelEn: 'Organic' }] }),
    )
    await expect(fetchCatalogFacets()).rejects.toMatchObject({ code: 'INVALID_RESPONSE_SHAPE' })
  })

  it('surfaces a server error envelope unchanged', async () => {
    fetchMock.mockResolvedValue(
      mockResponse(400, { error: { code: 'UNSUPPORTED_QUERY_PARAMETER', message: 'nope', fields: ['x'] } }),
    )
    await expect(fetchCatalogFacets()).rejects.toMatchObject({ code: 'UNSUPPORTED_QUERY_PARAMETER', status: 400 })
  })

  it('propagates an abort unchanged rather than wrapping it as a failure', async () => {
    const controller = new AbortController()
    controller.abort()
    fetchMock.mockRejectedValue(new DOMException('The operation was aborted.', 'AbortError'))
    await expect(fetchCatalogFacets(controller.signal)).rejects.not.toBeInstanceOf(CatalogApiError)
  })
})
