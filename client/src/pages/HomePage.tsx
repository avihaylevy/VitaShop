import { useTranslation } from 'react-i18next'
import { useCatalogCategories } from '../hooks/useCatalogCategories'
import { CategoryShelf } from '../components/catalog'
import { Button } from '../components/ui/Button'

/**
 * Production home page. Category navigation only — no product grid, no
 * featured products, no search (technical/UI_IMPLEMENTATION_PLAN.md step 6,
 * Slice 6 Checkpoint D). Sends exactly one GET /api/categories request per
 * load; never GET /api/products.
 */
export function HomePage() {
  const { t } = useTranslation(['common', 'catalog'])
  const { loading, categories, error, retry } = useCatalogCategories()

  return (
    <div className="px-7 py-8">
      <h1 className="text-2xl font-semibold text-text-ink">{t('app.name', { ns: 'common' })}</h1>

      {loading && (
        <p className="mt-6 text-sm text-text-muted" role="status">
          {t('home.loading', { ns: 'catalog' })}
        </p>
      )}

      {!loading && error && (
        <div className="mt-6 flex flex-col items-start gap-3">
          <p className="text-sm text-state-error" role="alert">
            {t('home.error', { ns: 'catalog' })}
          </p>
          <Button variant="secondary" onClick={retry}>
            {t('home.retry', { ns: 'catalog' })}
          </Button>
        </div>
      )}

      {!loading && !error && (
        <CategoryShelf categories={categories} className="mt-6" />
      )}
    </div>
  )
}
