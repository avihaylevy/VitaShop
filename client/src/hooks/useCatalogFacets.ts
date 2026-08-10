import { useCallback, useEffect, useState } from 'react'
import { CatalogApiError, fetchCatalogFacets } from '../lib/catalogApi.js'
import type { CatalogFacetsDto } from '../types/catalog.js'

export interface UseCatalogFacetsResult {
  loading: boolean
  facets: CatalogFacetsDto
  error: CatalogApiError | null
  retry: () => void
}

/**
 * The empty facet payload — also the value exposed while loading or after a
 * failure, so consumers never branch on `undefined`. An empty facet group
 * renders no fieldset at all (§9d: "never an option that can match
 * nothing"), which is exactly the right behaviour when the options are not
 * known yet.
 */
export const EMPTY_CATALOG_FACETS: CatalogFacetsDto = {
  brands: [],
  ingredients: [],
  healthGoals: [],
  dosageForms: [],
}

/**
 * MILESTONE-005 Checkpoint I — the §9d facet options, fetched ONCE per
 * mount, deliberately separate from `useCatalogData`.
 *
 * 🔴 Facets must not refetch per query (§9b's "categories fetch once, not
 * per query" reasoning applies identically here): the option set is derived
 * from the whole ACTIVE catalogue, not from the current result page, so
 * refetching it on every filter change would both waste a request and let
 * the available options appear to shrink as the user narrows — options that
 * are still legal to select. Hence no dependency on the URL state.
 */
export function useCatalogFacets(): UseCatalogFacetsResult {
  const [facets, setFacets] = useState<CatalogFacetsDto>(EMPTY_CATALOG_FACETS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<CatalogApiError | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    void (async () => {
      try {
        const result = await fetchCatalogFacets(controller.signal)
        setFacets(result)
        setLoading(false)
      } catch (err) {
        // Expected cancellation (unmount) produces no state write at all.
        // `controller.signal.aborted` answers that directly and
        // realm-independently, unlike an `err instanceof Error &&
        // err.name === 'AbortError'` check — jsdom's `DOMException` does
        // not extend `Error`, real browsers' and Node's do (Checkpoint H
        // correction #3).
        if (controller.signal.aborted) return
        setError(err instanceof CatalogApiError ? err : new CatalogApiError('UNKNOWN_ERROR', 'An unexpected error occurred.'))
        setLoading(false)
      }
    })()

    return () => controller.abort()
  }, [attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  return { loading, facets, error, retry }
}
