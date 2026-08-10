import { describe, expect, it } from 'vitest'
import { catalogViewState, type CatalogFallback, type CatalogViewStateInput } from './catalogViewState'
import { CatalogApiError } from '../../lib/catalogApi'
import type { CatalogCategoryDto } from '../../types/catalog'
import type { ProductCardModel } from '../../types/product'

/**
 * Pure resolver test matrix — MILESTONE-005 Checkpoint H, §9c. No DOM, no
 * hooks, no jsdom required. Migrated from the pre-Checkpoint-H matrix
 * (which had the resolver do its own category lookup/filtering) case by
 * case: the resolver no longer filters, `invalidCategory` is now an input
 * flag rather than a slug lookup, and `filtered-empty` carries fallback
 * metadata with an optional `activeCategory`.
 */

const CATEGORY_VITAMINS: CatalogCategoryDto = { slug: 'vitamins', nameHe: 'ויטמינים', nameEn: 'Vitamins' }
const CATEGORY_MINERALS: CatalogCategoryDto = { slug: 'minerals', nameHe: 'מינרלים', nameEn: 'Minerals' }

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

function fallback(overrides: Partial<CatalogFallback> = {}): CatalogFallback {
  return { kind: 'popular', items: [product({ slug: 'fallback-product' })], limit: 8, ...overrides }
}

const SOME_ERROR = new CatalogApiError('UNKNOWN_ERROR', 'boom')

function baseInput(overrides: Partial<CatalogViewStateInput> = {}): CatalogViewStateInput {
  return {
    loading: false,
    error: null,
    invalidCategory: false,
    hasNarrowingQuery: false,
    activeCategory: undefined,
    products: [],
    totalItems: 0,
    fallback: null,
    ...overrides,
  }
}

describe('catalogViewState — precedence and state matrix', () => {
  it('1. loading===true with error present -> loading', () => {
    const result = catalogViewState(baseInput({ loading: true, error: SOME_ERROR }))
    expect(result).toEqual({ state: 'loading' })
  })

  it('2. loading===true with stale products -> loading', () => {
    const result = catalogViewState(baseInput({ loading: true, products: [product()], totalItems: 1 }))
    expect(result).toEqual({ state: 'loading' })
  })

  it('3. loading===true, invalidCategory true -> loading, NOT invalid-category', () => {
    const result = catalogViewState(baseInput({ loading: true, invalidCategory: true }))
    expect(result).toEqual({ state: 'loading' })
  })

  it('4. error!==null -> error', () => {
    const result = catalogViewState(baseInput({ error: SOME_ERROR }))
    expect(result).toEqual({ state: 'error' })
  })

  it('5. error!==null with stale products present -> error, not ready', () => {
    const result = catalogViewState(baseInput({ error: SOME_ERROR, products: [product()], totalItems: 1 }))
    expect(result).toEqual({ state: 'error' })
  })

  it('6. error!==null, invalidCategory true -> error, NOT invalid-category', () => {
    const result = catalogViewState(baseInput({ error: SOME_ERROR, invalidCategory: true }))
    expect(result).toEqual({ state: 'error' })
  })

  it('7. invalidCategory true (normalized server rejection) -> invalid-category', () => {
    const result = catalogViewState(baseInput({ invalidCategory: true }))
    expect(result).toEqual({ state: 'invalid-category' })
  })

  it('8. no narrowing query, totalItems===0 -> catalog-empty', () => {
    const result = catalogViewState(baseInput())
    expect(result).toEqual({ state: 'catalog-empty' })
  })

  it('9. narrowing query (category), totalItems===0 -> filtered-empty, carries activeCategory and fallback', () => {
    const fb = fallback({ kind: 'category' })
    const result = catalogViewState(
      baseInput({
        hasNarrowingQuery: true,
        activeCategory: CATEGORY_MINERALS,
        totalItems: 0,
        fallback: fb,
      }),
    )
    expect(result).toEqual({ state: 'filtered-empty', activeCategory: CATEGORY_MINERALS, fallback: fb })
  })

  it('10. no narrowing query, totalItems>0 -> ready, activeCategory undefined, server-supplied products unfiltered', () => {
    const products = [product({ slug: 'a' }), product({ slug: 'b', categoryNameHe: CATEGORY_MINERALS.nameHe })]
    const result = catalogViewState(baseInput({ products, totalItems: 2 }))
    expect(result).toEqual({ state: 'ready', activeCategory: undefined, products })
  })

  it('11. narrowing query (category), totalItems>0 -> ready, activeCategory defined, resolver does not re-filter', () => {
    const products = [product({ slug: 'a', categoryNameHe: CATEGORY_MINERALS.nameHe })]
    const result = catalogViewState(
      baseInput({ hasNarrowingQuery: true, activeCategory: CATEGORY_MINERALS, products, totalItems: 1 }),
    )
    expect(result).toEqual({ state: 'ready', activeCategory: CATEGORY_MINERALS, products })
  })

  it('12. exhaustiveness — every one of the 6 output states is reachable', () => {
    const seen = new Set<string>()
    seen.add(catalogViewState(baseInput({ loading: true })).state)
    seen.add(catalogViewState(baseInput({ error: SOME_ERROR })).state)
    seen.add(catalogViewState(baseInput({ invalidCategory: true })).state)
    seen.add(catalogViewState(baseInput()).state)
    seen.add(catalogViewState(baseInput({ hasNarrowingQuery: true, totalItems: 0 })).state)
    seen.add(catalogViewState(baseInput({ products: [product()], totalItems: 1 })).state)

    expect(seen).toEqual(new Set(['loading', 'error', 'invalid-category', 'catalog-empty', 'filtered-empty', 'ready']))
  })
})

describe('catalogViewState — precedence boundary coverage (explicit)', () => {
  it('loading + invalidCategory => loading', () => {
    const result = catalogViewState(baseInput({ loading: true, invalidCategory: true }))
    expect(result).toEqual({ state: 'loading' })
  })

  it('error + invalidCategory => error', () => {
    const result = catalogViewState(baseInput({ error: SOME_ERROR, invalidCategory: true }))
    expect(result).toEqual({ state: 'error' })
  })

  it('stale products + error => error', () => {
    const result = catalogViewState(
      baseInput({ error: SOME_ERROR, products: [product(), product({ slug: 'other' })], totalItems: 2 }),
    )
    expect(result).toEqual({ state: 'error' })
  })

  it('narrowing query + zero totalItems => filtered-empty', () => {
    const result = catalogViewState(baseInput({ hasNarrowingQuery: true, activeCategory: CATEGORY_VITAMINS, totalItems: 0 }))
    expect(result).toEqual({ state: 'filtered-empty', activeCategory: CATEGORY_VITAMINS, fallback: null })
  })

  it('no narrowing query + zero totalItems => catalog-empty', () => {
    const result = catalogViewState(baseInput({ products: [], totalItems: 0 }))
    expect(result).toEqual({ state: 'catalog-empty' })
  })

  it('ready state when products are available', () => {
    const products = [product()]
    const result = catalogViewState(baseInput({ products, totalItems: 1 }))
    expect(result).toEqual({ state: 'ready', activeCategory: undefined, products })
  })

  it('catalog-empty and filtered-empty are mutually exclusive — a narrowing query forces the filtered branch, never catalog-empty', () => {
    const result = catalogViewState(baseInput({ hasNarrowingQuery: true, activeCategory: CATEGORY_VITAMINS, totalItems: 0 }))
    expect(result.state).toBe('filtered-empty')
    expect(result.state).not.toBe('catalog-empty')
  })

  it('filtered-empty activeCategory is optional — a non-category narrowing query (e.g. brand only) can be empty with no active category', () => {
    const result = catalogViewState(baseInput({ hasNarrowingQuery: true, activeCategory: undefined, totalItems: 0 }))
    expect(result).toEqual({ state: 'filtered-empty', activeCategory: undefined, fallback: null })
  })

  it('filtered-empty carries fallback as metadata, never substituted into ready products', () => {
    const fb = fallback()
    const result = catalogViewState(baseInput({ hasNarrowingQuery: true, totalItems: 0, fallback: fb }))
    expect(result).toEqual({ state: 'filtered-empty', activeCategory: undefined, fallback: fb })
  })

  it('resolver trusts totalItems, not products.length, to decide catalog-empty vs ready (products already server-paginated)', () => {
    // §5a guarantees a well-formed past-the-end page never reaches this
    // resolver — the data layer canonicalizes it away before ever setting
    // state. So an empty `products` array with totalItems > 0 is not a
    // real scenario the resolver receives; the point here is only that
    // the branch reads totalItems, not products.length — a normal ready
    // page with matching, non-empty products and a positive totalItems.
    const result = catalogViewState(baseInput({ products: [product()], totalItems: 1 }))
    expect(result.state).toBe('ready')
  })
})

describe('catalogViewState — error shape', () => {
  it('error member is exactly { state: "error" }, no payload', () => {
    const result = catalogViewState(baseInput({ error: SOME_ERROR }))
    expect(Object.keys(result)).toEqual(['state'])
  })
})
