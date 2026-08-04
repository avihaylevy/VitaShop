import { useCallback, useEffect, useMemo, useState } from 'react'
import { CatalogApiError, fetchCatalogCategories, fetchCatalogProducts } from '../lib/catalogApi.js'
import { mapCatalogProduct } from '../lib/mapCatalogProduct.js'
import type { CatalogCategoryDto, CatalogProductDto } from '../types/catalog.js'
import type { ProductCardModel } from '../types/product.js'
import type { SupportedLanguage } from '../i18n/index.js'

export interface UseCatalogDataResult {
  loading: boolean
  products: ProductCardModel[]
  categories: CatalogCategoryDto[]
  error: CatalogApiError | null
  retry: () => void
}

/**
 * Owns exactly one products request and one categories request per load
 * (mount, or an explicit `retry()`). Raw DTOs are kept in state and
 * remapped to `ProductCardModel` locally on language change — a UI
 * language toggle must never trigger a network refetch.
 */
export function useCatalogData(language: SupportedLanguage): UseCatalogDataResult {
  const [productDtos, setProductDtos] = useState<CatalogProductDto[]>([])
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
        const [products, categoriesResult] = await Promise.all([
          fetchCatalogProducts(controller.signal),
          fetchCatalogCategories(controller.signal),
        ])
        setProductDtos(products)
        setCategories(categoriesResult)
        setLoading(false)
      } catch (err) {
        // An aborted request (unmount, or a retry superseding this cycle)
        // is not a user-visible failure — it simply never resolves.
        if (err instanceof Error && err.name === 'AbortError') return
        setError(err instanceof CatalogApiError ? err : new CatalogApiError('UNKNOWN_ERROR', 'An unexpected error occurred.'))
        setLoading(false)
      }
    })()

    return () => controller.abort()
  }, [attempt])

  const products = useMemo(() => productDtos.map((dto) => mapCatalogProduct(dto, language)), [productDtos, language])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  return { loading, products, categories, error, retry }
}
