import { describe, expect, it } from 'vitest'
import { CatalogApiError } from '../../lib/catalogApi'
import { normalizeProductDetailError, productDetailViewState } from './productDetailViewState'
import type { ProductDetailModel } from '../../types/product'

/**
 * MILESTONE-005 Checkpoint J — the detail-page-local state set (§7).
 * Deliberately proven independently of `catalogViewState`: the two share no
 * union, and this file must fail if someone later tries to merge them.
 */

function product(overrides: Partial<ProductDetailModel> = {}): ProductDetailModel {
  return {
    slug: 'solgar-omega-3',
    name: 'אומגה 3',
    categoryNameHe: 'אומגה ושומנים',
    categoryName: 'Omega & Fats',
    price: '94.90',
    stockQuantity: 60,
    lowStockThreshold: 5,
    brandName: 'סולגאר',
    dosageForm: 'כמוסות',
    packageQuantity: 100,
    imageFile: 'omega.jpg',
    serialNumber: 'a5f3-uuid',
    usageInstructions: 'כמוסה אחת ביום',
    images: ['omega.jpg'],
    description: 'תיאור',
    warningsAllergens: 'אין',
    allergenInfoIncomplete: false,
    ingredients: [{ name: 'EPA', amount: '180.00', unit: 'mg' }],
    healthGoals: ['לב וכלי דם'],
    targetAudience: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('normalizeProductDetailError — §7 not-found vs failure', () => {
  it('maps the server 404 PRODUCT_NOT_FOUND to not-found, with no error', () => {
    const result = normalizeProductDetailError(
      new CatalogApiError('PRODUCT_NOT_FOUND', 'nope', { status: 404 }),
    )
    expect(result).toEqual({ notFound: true, error: null })
  })

  it('treats a bare 404 without the contract code as a real failure', () => {
    // A misconfigured base URL or a proxy can produce an HTTP 404 that says
    // nothing about the product. Rendering "product not found" for it would
    // state something true-sounding for a false reason.
    const error = new CatalogApiError('HTTP_ERROR', 'not found', { status: 404 })
    const result = normalizeProductDetailError(error)
    expect(result).toEqual({ notFound: false, error })
  })

  it('treats the contract code with a non-404 status as a real failure', () => {
    const error = new CatalogApiError('PRODUCT_NOT_FOUND', 'nope', { status: 500 })
    expect(normalizeProductDetailError(error)).toEqual({ notFound: false, error })
  })

  it.each([
    new CatalogApiError('NETWORK_ERROR', 'x'),
    new CatalogApiError('INVALID_RESPONSE_SHAPE', 'x'),
    new CatalogApiError('CATALOG_DATA_INTEGRITY', 'x', { status: 500 }),
    new CatalogApiError('UNSUPPORTED_QUERY_PARAMETER', 'x', { status: 400 }),
    new CatalogApiError('UNKNOWN_ERROR', 'x'),
  ])('classifies %s as a failure, never as not-found', (error) => {
    expect(normalizeProductDetailError(error)).toEqual({ notFound: false, error })
  })

  it('🔴 never returns notFound AND error together, across the whole failure domain', () => {
    const errors = [
      new CatalogApiError('PRODUCT_NOT_FOUND', 'x', { status: 404 }),
      new CatalogApiError('PRODUCT_NOT_FOUND', 'x', { status: 400 }),
      new CatalogApiError('HTTP_ERROR', 'x', { status: 404 }),
      new CatalogApiError('NETWORK_ERROR', 'x'),
      new CatalogApiError('UNKNOWN_ERROR', 'x', { status: 500 }),
    ]
    for (const error of errors) {
      const result = normalizeProductDetailError(error)
      expect(result.notFound && result.error !== null).toBe(false)
    }
  })
})

describe('productDetailViewState — precedence', () => {
  it('loading outranks everything, including a resolved product', () => {
    expect(
      productDetailViewState({ loading: true, error: new CatalogApiError('X', 'x'), notFound: true, product: product() }),
    ).toEqual({ state: 'loading' })
  })

  it('error outranks not-found — a failure is never presented as a definitive answer', () => {
    expect(
      productDetailViewState({ loading: false, error: new CatalogApiError('X', 'x'), notFound: true, product: null }),
    ).toEqual({ state: 'error' })
  })

  it('error suppresses a stale product entirely', () => {
    expect(
      productDetailViewState({ loading: false, error: new CatalogApiError('X', 'x'), notFound: false, product: product() }),
    ).toEqual({ state: 'error' })
  })

  it('not-found suppresses a stale product too', () => {
    expect(productDetailViewState({ loading: false, error: null, notFound: true, product: product() })).toEqual({
      state: 'not-found',
    })
  })

  it('ready carries the product through unchanged', () => {
    const model = product()
    expect(productDetailViewState({ loading: false, error: null, notFound: false, product: model })).toEqual({
      state: 'ready',
      product: model,
    })
  })

  it('falls back to loading rather than inventing an empty page when there is no product and no failure', () => {
    expect(productDetailViewState({ loading: false, error: null, notFound: false, product: null })).toEqual({
      state: 'loading',
    })
  })

  it('resolves to exactly one of the four states for every input combination', () => {
    const allowed = new Set(['loading', 'error', 'not-found', 'ready'])
    for (const loading of [true, false]) {
      for (const error of [null, new CatalogApiError('X', 'x')]) {
        for (const notFound of [true, false]) {
          for (const model of [null, product()]) {
            const result = productDetailViewState({ loading, error, notFound, product: model })
            expect(allowed.has(result.state)).toBe(true)
          }
        }
      }
    }
  })
})
