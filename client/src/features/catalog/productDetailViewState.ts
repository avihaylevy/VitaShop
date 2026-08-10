import type { CatalogApiError } from '../../lib/catalogApi.js'
import type { ProductDetailModel } from '../../types/product.js'

/**
 * MILESTONE-005 Checkpoint J — the Product Details view state (§7).
 *
 * 🔴 Four states, and they are DETAIL-PAGE-LOCAL: `loading` · `error` ·
 * `not-found` · `ready`. §7 is explicit that this set is "separate from
 * `catalogViewState`'s six (§9c). No shared union, no seventh catalogue
 * state." Nothing here imports or extends `CatalogViewState`, and
 * `catalogViewState.ts` is untouched by this checkpoint.
 *
 * Pure: no React, no hooks, no fetch, no routing, no i18n. Same input ->
 * same output.
 */
export type ProductDetailViewState =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'not-found' }
  | { state: 'ready'; product: ProductDetailModel }

export interface ProductDetailViewStateInput {
  loading: boolean
  /** 🔴 Mutually exclusive with `notFound` — see `normalizeProductDetailError`. */
  error: CatalogApiError | null
  notFound: boolean
  product: ProductDetailModel | null
}

export interface NormalizedProductDetailFailure {
  notFound: boolean
  error: CatalogApiError | null
}

/**
 * Splits a request failure into "this product does not exist" and
 * "something went wrong", mutually exclusively — the same invariant §9e
 * freezes for the catalogue's invalid-category case, applied to the detail
 * endpoint's 404.
 *
 * 🔴 A 404 is only `not-found` when it carries the server's own
 * `PRODUCT_NOT_FOUND` code AND status 404. A bare HTTP 404 from something
 * else on the path (a misconfigured base URL, a proxy) is a genuine failure
 * and must surface as one — silently rendering "product not found" for it
 * would tell the user a true-sounding thing for a false reason.
 *
 * 🔴 An inactive product produces exactly this same 404 (§7), so the client
 * cannot tell it apart from an absent one — which is the point: it must not
 * try to.
 */
export function normalizeProductDetailError(error: CatalogApiError): NormalizedProductDetailFailure {
  if (error.status === 404 && error.code === 'PRODUCT_NOT_FOUND') {
    return { notFound: true, error: null }
  }
  return { notFound: false, error }
}

/**
 * Precedence: loading > error > not-found > ready.
 *
 * `error` outranks `not-found` for the same reason it outranks
 * `invalid-category` in the catalogue resolver: a real failure must never be
 * presented as a definitive answer about the product. The normalizer above
 * is what keeps the two from ever both being set.
 *
 * `ready` requires a product. A null product with no failure is treated as
 * `loading` rather than fabricating an empty page — it is a state the data
 * layer should never produce, and guessing would render a product-shaped
 * page describing nothing.
 */
export function productDetailViewState(input: ProductDetailViewStateInput): ProductDetailViewState {
  const { loading, error, notFound, product } = input

  if (loading) {
    return { state: 'loading' }
  }

  if (error !== null) {
    return { state: 'error' }
  }

  if (notFound) {
    return { state: 'not-found' }
  }

  if (product === null) {
    return { state: 'loading' }
  }

  return { state: 'ready', product }
}
