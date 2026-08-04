import { useCallback, useEffect, useState } from 'react'
import { CatalogApiError, fetchCatalogCategories } from '../lib/catalogApi.js'
import type { CatalogCategoryDto } from '../types/catalog.js'

export interface UseCatalogCategoriesResult {
  loading: boolean
  categories: CatalogCategoryDto[]
  error: CatalogApiError | null
  retry: () => void
}

/**
 * Category-only data boundary — deliberately separate from
 * `useCatalogData` so a categories-only consumer (HomePage) never triggers
 * a products request just because the combined hook happens to fetch both.
 * Reuses `fetchCatalogCategories`'s own validation; no duplicated logic.
 */
export function useCatalogCategories(): UseCatalogCategoriesResult {
  const [categories, setCategories] = useState<CatalogCategoryDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<CatalogApiError | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    void (async () => {
      try {
        const result = await fetchCatalogCategories(controller.signal)
        setCategories(result)
        setLoading(false)
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
        setError(err instanceof CatalogApiError ? err : new CatalogApiError('UNKNOWN_ERROR', 'An unexpected error occurred.'))
        setLoading(false)
      }
    })()

    return () => controller.abort()
  }, [attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  return { loading, categories, error, retry }
}
