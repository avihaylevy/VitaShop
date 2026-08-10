import type { CatalogApiError } from '../../lib/catalogApi.js'
import type { CatalogCategoryDto } from '../../types/catalog.js'
import type { ProductCardModel } from '../../types/product.js'

/**
 * Client-mapped catalogue fallback (§6b) — the DTO's `items` already
 * remapped to `ProductCardModel` by the data layer, via the same
 * `mapCatalogProduct` the primary `items` list uses. Never substituted
 * into `products`/`totalItems` — carried as metadata on `filtered-empty`.
 */
export interface CatalogFallback {
  kind: 'category' | 'popular'
  items: ProductCardModel[]
  limit: number
}

/**
 * Pure catalogue view-state resolver — MILESTONE-005 Checkpoint H, §9c. No
 * React, no hooks, no i18n, no fetch, no routing, no side effects. Same
 * input shape -> same output shape, always.
 *
 * This resolver no longer performs category filtering itself — filtering
 * happens server-side (Checkpoint D). `products` here is already the exact
 * page the server returned; `invalidCategory` is the normalized server
 * rejection (§9e), never a local slug-guess against a categories list.
 */
export interface CatalogViewStateInput {
  loading: boolean
  error: CatalogApiError | null
  invalidCategory: boolean
  /** True whenever the current query narrows the catalogue at all (q, category, brand, dosageForm, ingredient, healthGoal, minPrice, maxPrice, inStock). Sort/page do not count — they reorder/paginate, they do not narrow. */
  hasNarrowingQuery: boolean
  activeCategory: CatalogCategoryDto | undefined
  products: ProductCardModel[]
  totalItems: number
  fallback: CatalogFallback | null
}

export type CatalogViewState =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'invalid-category' }
  | { state: 'catalog-empty' }
  | { state: 'filtered-empty'; activeCategory: CatalogCategoryDto | undefined; fallback: CatalogFallback | null }
  | { state: 'ready'; activeCategory: CatalogCategoryDto | undefined; products: ProductCardModel[] }

/**
 * Precedence, exactly §9c: loading > error > invalid-category >
 * catalog-empty > filtered-empty > ready. Written as a single ordered
 * if/else-if chain so it stays defensively correct even if a future
 * data-layer change stops guaranteeing today's useCatalogData invariants
 * (e.g. loading and error never being true simultaneously).
 *
 * `catalog-empty` = no narrowing query AND totalItems === 0 (the whole
 * active catalogue is empty). `filtered-empty` = a narrowing query
 * returned zero primary matches — `activeCategory` is OPTIONAL here since a
 * no-category narrowing query (e.g. a brand filter) can also be empty.
 * There is no seventh discriminant: the fallback is metadata carried on
 * `filtered-empty`, never a state of its own.
 */
export function catalogViewState(input: CatalogViewStateInput): CatalogViewState {
  const { loading, error, invalidCategory, hasNarrowingQuery, activeCategory, products, totalItems, fallback } = input

  if (loading) {
    return { state: 'loading' }
  }

  if (error !== null) {
    return { state: 'error' }
  }

  if (invalidCategory) {
    return { state: 'invalid-category' }
  }

  if (totalItems === 0) {
    if (!hasNarrowingQuery) {
      return { state: 'catalog-empty' }
    }
    return { state: 'filtered-empty', activeCategory, fallback }
  }

  return { state: 'ready', activeCategory, products }
}
