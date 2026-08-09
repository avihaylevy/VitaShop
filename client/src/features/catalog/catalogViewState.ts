import type { CatalogApiError } from '../../lib/catalogApi.js'
import type { CatalogCategoryDto } from '../../types/catalog.js'
import type { ProductCardModel } from '../../types/product.js'

/**
 * Pure catalogue view-state resolver — Slice 9 Checkpoint D,
 * technical/UI_SLICES.md §7. No React, no hooks, no i18n, no fetch, no
 * routing, no side effects. Same input shape -> same output shape, always.
 */
export interface CatalogViewStateInput {
  loading: boolean
  error: CatalogApiError | null
  categorySlug: string | undefined
  categories: CatalogCategoryDto[]
  products: ProductCardModel[]
}

export type CatalogViewState =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'invalid-category' }
  | { state: 'catalog-empty' }
  | { state: 'filtered-empty'; activeCategory: CatalogCategoryDto }
  | { state: 'ready'; activeCategory: CatalogCategoryDto | undefined; products: ProductCardModel[] }

/**
 * Precedence, exactly §2: loading > error > invalid-category >
 * catalog-empty > filtered-empty > ready. Written as a single ordered
 * if/else-if chain so it stays defensively correct even if a future
 * data-layer change stops guaranteeing today's useCatalogData invariants
 * (e.g. loading and error never being true simultaneously).
 */
export function catalogViewState(input: CatalogViewStateInput): CatalogViewState {
  const { loading, error, categorySlug, categories, products } = input

  if (loading) {
    return { state: 'loading' }
  }

  if (error !== null) {
    return { state: 'error' }
  }

  const activeCategory = categorySlug !== undefined ? categories.find((c) => c.slug === categorySlug) : undefined
  const isInvalidCategory = categorySlug !== undefined && activeCategory === undefined

  if (isInvalidCategory) {
    return { state: 'invalid-category' }
  }

  if (categorySlug === undefined) {
    if (products.length === 0) {
      return { state: 'catalog-empty' }
    }
    return { state: 'ready', activeCategory: undefined, products }
  }

  const filteredProducts = products.filter((product) => product.categoryNameHe === activeCategory!.nameHe)

  if (filteredProducts.length === 0) {
    return { state: 'filtered-empty', activeCategory: activeCategory! }
  }

  return { state: 'ready', activeCategory: activeCategory!, products: filteredProducts }
}
