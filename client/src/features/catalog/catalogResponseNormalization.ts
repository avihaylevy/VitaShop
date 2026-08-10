import type { CatalogApiError } from '../../lib/catalogApi.js'

/**
 * MILESTONE-005 Checkpoint H — §9e invalid-category/error normalization
 * invariant. Pure. No React, no fetch, no side effects.
 *
 * `error` and `invalidCategory` are mutually exclusive: a category-specific
 * HTTP 400 INVALID_QUERY_PARAMETER (fields includes 'category') normalizes
 * to `invalidCategory: true, error: null`; every other real failure
 * normalizes to `invalidCategory: false, error: <the original error>`. The
 * status check matters — a 500 that happened to carry the same code/fields
 * (not producible by today's server, but not this normalizer's job to
 * assume) must never be swallowed as invalidCategory.
 *
 * Expected cancellation (an AbortError from unmount or a superseded
 * request) is deliberately OUT OF SCOPE for this function — callers must
 * check `error.name === 'AbortError'` and return before ever calling this,
 * so a cancellation never enters either branch below.
 */
export interface CatalogErrorNormalization {
  invalidCategory: boolean
  error: CatalogApiError | null
}

export function normalizeCatalogError(error: CatalogApiError): CatalogErrorNormalization {
  const isInvalidCategory =
    error.status === 400 &&
    error.code === 'INVALID_QUERY_PARAMETER' &&
    (error.fields?.includes('category') ?? false)

  if (isInvalidCategory) {
    return { invalidCategory: true, error: null }
  }
  return { invalidCategory: false, error }
}
