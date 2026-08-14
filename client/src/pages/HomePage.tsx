import { useTranslation } from 'react-i18next'
import { useCatalogCategories } from '../hooks/useCatalogCategories'
import { useNewArrivals } from '../hooks/useNewArrivals'
import { CategoryShelf } from '../components/catalog'
import { ProductGrid } from '../components/catalog/ProductGrid'
import { Button } from '../components/ui/Button'

/**
 * Production home page.
 *
 * ⚠️ THE OLD CONTRACT HERE READ "never GET /api/products", and Checkpoint F4
 * changes it deliberately. ISSUE-054 recorded that this page showed category
 * chips and no products at all; DEC-064 answered it with NEW ARRIVALS, so the
 * page now makes a second request.
 *
 * 🔴 THE SHELF IS NAVIGATIONAL — cards LINK, they do not add to cart. Buying
 * belongs to the catalogue, which owns the drawer, the return-focus
 * choreography and the announcement; a second copy of that machinery here
 * would be two implementations of one behaviour.
 *
 * 🔴 AND IT CANNOT BREAK THE PAGE. The categories are the actual navigation;
 * if new arrivals fail to load, the page still works and says so quietly.
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

      <NewArrivals />
    </div>
  )
}

/**
 * DEC-064's shelf. Its own component so a failure here is visibly separate
 * from the categories above — they are fetched independently and fail
 * independently.
 */
function NewArrivals() {
  const { t } = useTranslation('catalog')
  const state = useNewArrivals()

  return (
    <section className="mt-10" aria-labelledby="new-arrivals-heading">
      <h2 id="new-arrivals-heading" className="text-lg font-semibold text-text-ink">
        {t('home.newArrivalsTitle')}
      </h2>

      {/*
        🔴 ONE MESSAGE SLOT, ALWAYS MOUNTED, `role="status"`.
        Loading and failure were separate conditional blocks, so pressing
        Retry unmounted the focused button — focus fell to <body> — and the
        outcome was announced nowhere: the failure block carried no live
        region at all. `status` is polite rather than assertive, which is the
        "do not shout" intent stated properly instead of by omission.
      */}
      <p role="status" className="mt-4 text-sm text-text-muted">
        {state.status === 'loading' ? t('home.newArrivalsLoading') : ''}
        {state.status === 'failed' ? t('home.newArrivalsError') : ''}
      </p>

      {state.status === 'failed' && (
        <Button variant="secondary" className="mt-3" onClick={state.retry}>
          {t('home.retry')}
        </Button>
      )}

      {state.status === 'ready' && (
        <div className="mt-4">
          {/*
            🔴 `navigational` — the cards LINK and do not add to cart. The
            union makes that a choice a caller must state, not a prop it can
            forget. And `emptyState` is ProductGrid's own: hand-rolling the
            empty branch here put the same decision in two places.
          */}
          <ProductGrid
            products={state.products}
            navigational
            emptyState={<p className="text-sm text-text-muted">{t('home.newArrivalsEmpty')}</p>}
          />
        </div>
      )}

    </section>
  )
}
