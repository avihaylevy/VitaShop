import { useCallback, useEffect, useRef, useState } from 'react'
import { CatalogApiError, fetchProductDetail } from '../lib/catalogApi.js'
import { mapProductDetail } from '../lib/mapProductDetail.js'
import { normalizeProductDetailError } from '../features/catalog/productDetailViewState.js'
import type { SupportedLanguage } from '../i18n/index.js'
import type { ProductDetailDto } from '../types/catalog.js'
import type { ProductDetailModel } from '../types/product.js'

export interface UseProductDetailResult {
  loading: boolean
  product: ProductDetailModel | null
  error: CatalogApiError | null
  notFound: boolean
  retry: () => void
}

/**
 * MILESTONE-005 Checkpoint J — the Product Details data layer (§7).
 *
 * Deliberately mirrors `useCatalogData`'s already-reviewed lifecycle rather
 * than inventing a second one:
 *
 * - one request per distinct slug (or an explicit `retry()`);
 * - an `AbortController` AND a monotonic request id together, so neither a
 *   superseded response nor a late one can overwrite newer state (§9b);
 * - expected cancellation is a lifecycle event, never an outcome — it sets
 *   no error, no `notFound`, and produces no terminal state. Detected via
 *   `controller.signal.aborted`, which is realm-independent, unlike an
 *   `err instanceof Error && err.name === 'AbortError'` check (Checkpoint H
 *   correction #3: jsdom's `DOMException` does not extend `Error`);
 * - the DTO is stored raw and re-mapped per render, so a language toggle
 *   re-resolves the copy WITHOUT refetching (§9b's existing behaviour).
 */
export function useProductDetail(slug: string, language: SupportedLanguage): UseProductDetailResult {
  const [dto, setDto] = useState<ProductDetailDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<CatalogApiError | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [attempt, setAttempt] = useState(0)

  const requestIdRef = useRef(0)

  useEffect(() => {
    const controller = new AbortController()
    const requestId = ++requestIdRef.current
    setLoading(true)
    setError(null)
    setNotFound(false)

    void (async () => {
      try {
        const result = await fetchProductDetail(slug, controller.signal)
        if (requestId !== requestIdRef.current) return

        setDto(result)
        setNotFound(false)
        setError(null)
        setLoading(false)
      } catch (err) {
        if (controller.signal.aborted) return
        if (requestId !== requestIdRef.current) return

        const apiError =
          err instanceof CatalogApiError ? err : new CatalogApiError('UNKNOWN_ERROR', 'An unexpected error occurred.')
        const normalized = normalizeProductDetailError(apiError)
        // 🔴 The previous product is cleared on failure: a stale product
        // must never render underneath an error or a not-found state, the
        // same rule §9a states for the catalogue list.
        setDto(null)
        setNotFound(normalized.notFound)
        setError(normalized.error)
        setLoading(false)
      }
    })()

    return () => controller.abort()
  }, [slug, attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  return {
    loading,
    product: dto ? mapProductDetail(dto, language) : null,
    error,
    notFound,
    retry,
  }
}
