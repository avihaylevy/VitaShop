import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CatalogApiError, fetchCatalogCategories, fetchCatalogProducts } from './catalogApi.js'
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
    dosageForm: 'CAPSULE',
    packageQuantity: 100,
    price: '94.90',
    stockQuantity: 60,
    lowStockThreshold: 5,
    imageFile: 'solgar-omega-3.jpg',
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
  it('resolves with items on a valid 200 response', async () => {
    const product = validProduct()
    fetchMock.mockResolvedValue(mockResponse(200, { items: [product], page: 1, pageSize: 24, totalItems: 1, totalPages: 1 }))
    await expect(fetchCatalogProducts()).resolves.toEqual([product])
  })

  it('sends no query parameters', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, { items: [], page: 1, pageSize: 24, totalItems: 0, totalPages: 0 }))
    await fetchCatalogProducts()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url] = fetchMock.mock.calls[0] as [string, unknown]
    expect(url).toBe(`${BASE_URL}/api/products`)
  })

  it('rejects with INVALID_RESPONSE_SHAPE on a malformed envelope (items not an array)', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, { items: 'not-an-array', page: 1, pageSize: 24, totalItems: 0, totalPages: 0 }))
    await expect(fetchCatalogProducts()).rejects.toMatchObject({ code: 'INVALID_RESPONSE_SHAPE' })
  })

  it('rejects the whole response when a single product item is malformed — no partial acceptance', async () => {
    const good = validProduct()
    const bad = validProduct({ slug: 'bad', price: '94.9' }) // not two-decimal
    fetchMock.mockResolvedValue(mockResponse(200, { items: [good, bad], page: 1, pageSize: 24, totalItems: 2, totalPages: 1 }))
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

  it('propagates an AbortError unchanged, not wrapped as a CatalogApiError', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError')
    fetchMock.mockRejectedValue(abortError)
    const controller = new AbortController()
    const promise = fetchCatalogProducts(controller.signal)
    await expect(promise).rejects.toBe(abortError)
    await promise.catch((err: unknown) => {
      expect(err).not.toBeInstanceOf(CatalogApiError)
      expect((err as Error).name).toBe('AbortError')
    })
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
