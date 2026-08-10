import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { CatalogApiError, fetchCatalogProducts } from '../lib/catalogApi.js'
import { mapCatalogProduct } from '../lib/mapCatalogProduct.js'
import { normalizeCatalogError } from '../features/catalog/catalogResponseNormalization.js'
import type { CatalogFallback } from '../features/catalog/catalogViewState.js'
import {
  buildCatalogSearchParams,
  canonicalizePastTheEndPage,
  DEFAULT_PAGE,
  parseCatalogUrlState,
  type CatalogUrlState,
} from '../features/catalog/catalogUrlState.js'
import { hasActiveFilters } from '../features/catalog/catalogQueryControls.js'
import type { SupportedLanguage } from '../i18n/index.js'
import type { CatalogFallbackDto, CatalogProductDto } from '../types/catalog.js'
import type { ProductCardModel } from '../types/product.js'

export interface UseCatalogDataResult {
  loading: boolean
  products: ProductCardModel[]
  error: CatalogApiError | null
  invalidCategory: boolean
  hasNarrowingQuery: boolean
  totalItems: number
  /**
   * MILESTONE-005 Checkpoint I (additive) — the page the SERVER reported
   * for the currently rendered result set, and the total page count from
   * the same response. Deliberately the response's values, not
   * `urlState.page`: the two can differ for one render after a §5a
   * canonicalizing navigation, and the pagination control must describe the
   * results actually on screen, never a page that is still in flight.
   */
  page: number
  totalPages: number
  fallback: CatalogFallback | null
  urlState: CatalogUrlState
  retry: () => void
}

// 🔴 Checkpoint I correction, finding 2: the narrowing predicate is
// DEFINED ONCE, in catalogQueryControls.ts's `hasActiveFilters`, and
// imported here. It previously existed twice — once here, once there —
// with the second copy only documenting that it had to match the first.
// That is exactly the shape of Checkpoint H's finding 2 (two presence
// rules that silently disagreed once one changed), and a divergence here
// would be quiet: the resolver would pick `catalog-empty` while the UI
// still offered "Clear filters", or the reverse. One definition removes
// the possibility rather than restating the obligation.
//
// §9c/§5 semantics are unchanged by the move: sort and page reorder or
// paginate, they never narrow, so neither counts.

/**
 * MILESTONE-005 Checkpoint H — the catalogue data layer. Owns: parsing the
 * URL into `CatalogUrlState` (§5), building the request from it, one
 * products request per distinct query (mount, URL change, or an explicit
 * `retry()`), §5a past-the-end canonicalization via a replace-navigate,
 * §9e invalid-category/error normalization, and the §9b cancellation
 * contract (AbortController + a monotonic request id, together).
 *
 * Categories are deliberately NOT fetched here — §9b: "categories fetch
 * once, not per query." `useCatalogCategories` is the separate, single-fetch
 * hook for that; `CatalogPage` composes both and derives `activeCategory`
 * from `urlState.category` against its own categories list.
 */
export function useCatalogData(language: SupportedLanguage): UseCatalogDataResult {
  const [searchParams, setSearchParams] = useSearchParams()
  const urlState = parseCatalogUrlState(searchParams)

  const [productDtos, setProductDtos] = useState<CatalogProductDto[]>([])
  const [totalItems, setTotalItems] = useState(0)
  const [page, setPage] = useState(DEFAULT_PAGE)
  const [totalPages, setTotalPages] = useState(0)
  const [fallbackDto, setFallbackDto] = useState<CatalogFallbackDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<CatalogApiError | null>(null)
  const [invalidCategory, setInvalidCategory] = useState(false)
  const [attempt, setAttempt] = useState(0)

  const requestIdRef = useRef(0)
  const queryKey = buildCatalogSearchParams(urlState).toString()

  useEffect(() => {
    const controller = new AbortController()
    const requestId = ++requestIdRef.current
    setLoading(true)
    setError(null)

    void (async () => {
      try {
        const params = buildCatalogSearchParams(urlState)
        const envelope = await fetchCatalogProducts(params, controller.signal)
        if (requestId !== requestIdRef.current) return

        // §5a — a well-formed page landing past the real totalPages is
        // canonicalized via a REPLACE navigation, every other param
        // preserved byte-for-byte. The canonicalizing response is never
        // set into state: loading stays true, and the URL change re-enters
        // this same effect (queryKey changes) to fetch the canonical page.
        const canonical = canonicalizePastTheEndPage(urlState, envelope.totalItems, envelope.totalPages)
        if (canonical !== null) {
          setSearchParams(buildCatalogSearchParams(canonical), { replace: true })
          return
        }

        setProductDtos(envelope.items)
        setTotalItems(envelope.totalItems)
        // Set only on the non-canonicalizing path, alongside the items they
        // describe — a past-the-end response returns above without ever
        // reaching here, so these never describe a page that was discarded.
        setPage(envelope.page)
        setTotalPages(envelope.totalPages)
        setFallbackDto(envelope.fallback)
        setInvalidCategory(false)
        setError(null)
        setLoading(false)
      } catch (err) {
        // Expected cancellation (unmount, or a superseded request) — §9b:
        // produces NO normalized result at all, never error or
        // invalidCategory. Never enters the §9e normalization branches.
        // `controller.signal.aborted` answers "did we cancel this?"
        // directly and realm-independently — unlike `err instanceof
        // Error && err.name === 'AbortError'`, it does not depend on
        // whatever `DOMException` happens to inherit from in the
        // caller's environment (jsdom's does not extend `Error`; real
        // browsers' and Node's do — correction #3).
        if (controller.signal.aborted) return
        if (requestId !== requestIdRef.current) return

        const apiError = err instanceof CatalogApiError ? err : new CatalogApiError('UNKNOWN_ERROR', 'An unexpected error occurred.')
        const normalized = normalizeCatalogError(apiError)
        setInvalidCategory(normalized.invalidCategory)
        setError(normalized.error)
        setLoading(false)
      }
    })()

    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- queryKey is the canonical, stable identity of urlState; urlState itself is a fresh object every render.
  }, [queryKey, attempt])

  const products = productDtos.map((dto) => mapCatalogProduct(dto, language))
  const fallback: CatalogFallback | null = fallbackDto
    ? { kind: fallbackDto.kind, limit: fallbackDto.limit, items: fallbackDto.items.map((dto) => mapCatalogProduct(dto, language)) }
    : null

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  return {
    loading,
    products,
    error,
    invalidCategory,
    hasNarrowingQuery: hasActiveFilters(urlState),
    totalItems,
    page,
    totalPages,
    fallback,
    urlState,
    retry,
  }
}
