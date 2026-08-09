import { describe, expect, it } from 'vitest'
import { catalogViewState, type CatalogViewStateInput } from './catalogViewState'
import { CatalogApiError } from '../../lib/catalogApi'
import type { CatalogCategoryDto } from '../../types/catalog'
import type { ProductCardModel } from '../../types/product'

/**
 * Pure resolver test matrix — Slice 9 Checkpoint D, technical/UI_SLICES.md
 * §7/§9. No DOM, no hooks, no jsdom required.
 */

const CATEGORY_VITAMINS: CatalogCategoryDto = { slug: 'vitamins', nameHe: 'ויטמינים', nameEn: 'Vitamins' }
const CATEGORY_MINERALS: CatalogCategoryDto = { slug: 'minerals', nameHe: 'מינרלים', nameEn: 'Minerals' }
const CATEGORIES = [CATEGORY_VITAMINS, CATEGORY_MINERALS]

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

const SOME_ERROR = new CatalogApiError('UNKNOWN_ERROR', 'boom')

function baseInput(overrides: Partial<CatalogViewStateInput> = {}): CatalogViewStateInput {
  return {
    loading: false,
    error: null,
    categorySlug: undefined,
    categories: CATEGORIES,
    products: [],
    ...overrides,
  }
}

describe('catalogViewState — precedence and state matrix', () => {
  it('1. loading===true with error present -> loading', () => {
    const result = catalogViewState(baseInput({ loading: true, error: SOME_ERROR }))
    expect(result).toEqual({ state: 'loading' })
  })

  it('2. loading===true with stale products -> loading', () => {
    const result = catalogViewState(baseInput({ loading: true, products: [product()] }))
    expect(result).toEqual({ state: 'loading' })
  })

  it('3. loading===true, categorySlug unresolved -> loading, NOT invalid-category', () => {
    const result = catalogViewState(baseInput({ loading: true, categorySlug: 'not-a-real-category' }))
    expect(result).toEqual({ state: 'loading' })
  })

  it('4. error!==null -> error', () => {
    const result = catalogViewState(baseInput({ error: SOME_ERROR }))
    expect(result).toEqual({ state: 'error' })
  })

  it('5. error!==null with stale products present -> error, not ready', () => {
    const result = catalogViewState(baseInput({ error: SOME_ERROR, products: [product()] }))
    expect(result).toEqual({ state: 'error' })
  })

  it('6. error!==null, categorySlug unresolved -> error, NOT invalid-category', () => {
    const result = catalogViewState(baseInput({ error: SOME_ERROR, categorySlug: 'not-a-real-category' }))
    expect(result).toEqual({ state: 'error' })
  })

  it('7. categorySlug defined, not in categories -> invalid-category', () => {
    const result = catalogViewState(baseInput({ categorySlug: 'not-a-real-category' }))
    expect(result).toEqual({ state: 'invalid-category' })
  })

  it('8. categorySlug undefined, products.length===0 -> catalog-empty', () => {
    const result = catalogViewState(baseInput())
    expect(result).toEqual({ state: 'catalog-empty' })
  })

  it('9. categorySlug defined+valid, filtered===0 -> filtered-empty, carries activeCategory', () => {
    const result = catalogViewState(
      baseInput({
        categorySlug: CATEGORY_MINERALS.slug,
        products: [product({ categoryNameHe: CATEGORY_VITAMINS.nameHe })],
      }),
    )
    expect(result).toEqual({ state: 'filtered-empty', activeCategory: CATEGORY_MINERALS })
  })

  it('10. categorySlug undefined, products.length>0 -> ready, activeCategory undefined, unfiltered', () => {
    const products = [product({ slug: 'a' }), product({ slug: 'b', categoryNameHe: CATEGORY_MINERALS.nameHe })]
    const result = catalogViewState(baseInput({ products }))
    expect(result).toEqual({ state: 'ready', activeCategory: undefined, products })
  })

  it('11. categorySlug defined+valid, filtered>0 -> ready, activeCategory defined, filtered', () => {
    const matching = product({ slug: 'a', categoryNameHe: CATEGORY_MINERALS.nameHe })
    const other = product({ slug: 'b', categoryNameHe: CATEGORY_VITAMINS.nameHe })
    const result = catalogViewState(baseInput({ categorySlug: CATEGORY_MINERALS.slug, products: [matching, other] }))
    expect(result).toEqual({ state: 'ready', activeCategory: CATEGORY_MINERALS, products: [matching] })
  })

  it('12. exhaustiveness — every one of the 6 output states is reachable', () => {
    const seen = new Set<string>()
    seen.add(catalogViewState(baseInput({ loading: true })).state)
    seen.add(catalogViewState(baseInput({ error: SOME_ERROR })).state)
    seen.add(catalogViewState(baseInput({ categorySlug: 'unknown' })).state)
    seen.add(catalogViewState(baseInput()).state)
    seen.add(
      catalogViewState(
        baseInput({ categorySlug: CATEGORY_VITAMINS.slug, products: [product({ categoryNameHe: CATEGORY_MINERALS.nameHe })] }),
      ).state,
    )
    seen.add(catalogViewState(baseInput({ products: [product()] })).state)

    expect(seen).toEqual(new Set(['loading', 'error', 'invalid-category', 'catalog-empty', 'filtered-empty', 'ready']))
  })
})

describe('catalogViewState — precedence boundary coverage (explicit)', () => {
  it('loading + invalid category => loading', () => {
    const result = catalogViewState(baseInput({ loading: true, categorySlug: 'unknown' }))
    expect(result).toEqual({ state: 'loading' })
  })

  it('error + invalid category => error', () => {
    const result = catalogViewState(baseInput({ error: SOME_ERROR, categorySlug: 'unknown' }))
    expect(result).toEqual({ state: 'error' })
  })

  it('stale products + error => error', () => {
    const result = catalogViewState(baseInput({ error: SOME_ERROR, products: [product(), product({ slug: 'other' })] }))
    expect(result).toEqual({ state: 'error' })
  })

  it('valid category + zero matching products => filtered-empty', () => {
    const result = catalogViewState(
      baseInput({ categorySlug: CATEGORY_VITAMINS.slug, products: [product({ categoryNameHe: CATEGORY_MINERALS.nameHe })] }),
    )
    expect(result).toEqual({ state: 'filtered-empty', activeCategory: CATEGORY_VITAMINS })
  })

  it('no category + zero catalogue products => catalog-empty', () => {
    const result = catalogViewState(baseInput({ products: [] }))
    expect(result).toEqual({ state: 'catalog-empty' })
  })

  it('ready state when products are available', () => {
    const products = [product()]
    const result = catalogViewState(baseInput({ products }))
    expect(result).toEqual({ state: 'ready', activeCategory: undefined, products })
  })

  it('catalog-empty and filtered-empty are mutually exclusive — a categorySlug forces the filtered branch, never catalog-empty', () => {
    const result = catalogViewState(baseInput({ categorySlug: CATEGORY_VITAMINS.slug, products: [] }))
    expect(result.state).toBe('filtered-empty')
    expect(result.state).not.toBe('catalog-empty')
  })
})

describe('catalogViewState — error shape', () => {
  it('error member is exactly { state: "error" }, no payload', () => {
    const result = catalogViewState(baseInput({ error: SOME_ERROR }))
    expect(Object.keys(result)).toEqual(['state'])
  })
})
