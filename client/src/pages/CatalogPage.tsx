import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'
import { useCatalogData } from '../hooks/useCatalogData'
import { CategoryShelf } from '../components/catalog'
import { ProductGrid } from '../components/catalog/ProductGrid'
import { Button } from '../components/ui/Button'
import { Surface } from '../components/ui/Surface'
import { FOCUS_RING } from '../components/ui/focusRing'
import type { SupportedLanguage } from '../i18n/index'

// Shared, visible explanation for every disabled add-to-cart button on this
// page (Slice 6 Checkpoint A/E — cart ships in Slice 7). One DOM node,
// referenced by every card's aria-describedby via this fixed id.
const ADD_TO_CART_UNAVAILABLE_ID = 'catalog-add-to-cart-unavailable'

const SKELETON_COUNT = 8

// Every card on this page always has addToCartUnavailableId set, so the
// button is always disabled — this is structurally unreachable. Not a
// silent no-op: it fails loudly if the disabled contract is ever violated.
function handleAddToCartUnreachable(): never {
  throw new Error(
    'onAddToCart must be unreachable on CatalogPage: every ProductCard here has addToCartUnavailableId set (Slice 6 Checkpoint E — cart ships in Slice 7).',
  )
}

function ProductGridSkeleton() {
  return (
    <ul className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 md:gap-4" aria-hidden="true">
      {Array.from({ length: SKELETON_COUNT }, (_, index) => (
        <li key={index}>
          <Surface variant="section" bordered className="flex flex-col gap-3 p-4">
            <div className="aspect-[4/3] w-full animate-pulse rounded-card bg-well motion-reduce:animate-none" />
            <div className="h-4 w-3/4 animate-pulse rounded-compact bg-surface-sunken motion-reduce:animate-none" />
            <div className="h-4 w-1/2 animate-pulse rounded-compact bg-surface-sunken motion-reduce:animate-none" />
            <div className="h-11 w-full animate-pulse rounded-card bg-surface-sunken motion-reduce:animate-none" />
          </Surface>
        </li>
      ))}
    </ul>
  )
}

function BackToAllProductsLink({ label }: { label: string }) {
  return (
    <Link to="/catalog" className={`${FOCUS_RING} inline-flex min-h-11 items-center rounded-compact text-sm font-medium text-brand-teal underline`}>
      {label}
    </Link>
  )
}

/**
 * Production /catalog route. Category filtering is entirely client-side
 * (Slice 6 Checkpoint A): the server sends no query parameters, and the
 * ?category= URL param is matched against the already-fetched categories
 * list rather than carried through the fetch — ProductCardModel does not
 * carry a categorySlug (Checkpoint C deliberately kept it narrow), so the
 * join key is categoryNameHe, exactly as getCategoryTone already uses.
 */
export function CatalogPage() {
  const { t, i18n } = useTranslation(['layout', 'catalog'])
  const language = i18n.language as SupportedLanguage
  const [searchParams] = useSearchParams()
  const categorySlug = searchParams.get('category') ?? undefined
  const { loading, products, categories, error, retry } = useCatalogData(language)

  const activeCategory = categorySlug ? categories.find((c) => c.slug === categorySlug) : undefined
  const isInvalidCategory = categorySlug !== undefined && !loading && !error && activeCategory === undefined
  const filteredProducts = activeCategory
    ? products.filter((product) => product.categoryNameHe === activeCategory.nameHe)
    : products

  const gridHeading = isInvalidCategory
    ? t('catalogPage.invalidCategoryHeading', { ns: 'catalog' })
    : activeCategory
      ? language === 'he'
        ? activeCategory.nameHe
        : activeCategory.nameEn
      : t('categoryShelf.allProducts', { ns: 'catalog' })

  return (
    <div className="px-7 py-8">
      <h1 className="text-2xl font-semibold text-text-ink">{t('nav.catalog', { ns: 'layout' })}</h1>

      {loading && (
        <p className="mt-6 text-sm text-text-muted" role="status">
          {t('catalogPage.loading', { ns: 'catalog' })}
        </p>
      )}

      {!loading && error && (
        <div className="mt-6 flex flex-col items-start gap-3">
          <p className="text-sm text-state-error" role="alert">
            {t('catalogPage.error', { ns: 'catalog' })}
          </p>
          <Button variant="secondary" onClick={retry}>
            {t('catalogPage.retry', { ns: 'catalog' })}
          </Button>
        </div>
      )}

      {!loading && !error && (
        <>
          <CategoryShelf categories={categories} activeCategorySlug={categorySlug} className="mt-6" />

          <section aria-labelledby="catalog-grid-heading" className="mt-8">
            <h2 id="catalog-grid-heading" className="text-lg font-semibold text-text-ink">
              {gridHeading}
            </h2>

            {isInvalidCategory ? (
              <div className="mt-4 flex flex-col items-start gap-3">
                <p className="text-sm text-text-muted">{t('catalogPage.invalidCategoryMessage', { ns: 'catalog' })}</p>
                <BackToAllProductsLink label={t('catalogPage.backToAll', { ns: 'catalog' })} />
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="mt-4 flex flex-col items-start gap-3">
                <p className="text-sm text-text-muted">
                  {t('catalogPage.emptyCategoryMessage', {
                    ns: 'catalog',
                    category: language === 'he' ? activeCategory?.nameHe : activeCategory?.nameEn,
                  })}
                </p>
                <BackToAllProductsLink label={t('catalogPage.backToAll', { ns: 'catalog' })} />
              </div>
            ) : (
              <>
                <p id={ADD_TO_CART_UNAVAILABLE_ID} className="mt-4 text-xs text-text-muted">
                  {t('addToCartUnavailable', { ns: 'catalog' })}
                </p>
                <ProductGrid
                  products={filteredProducts}
                  onAddToCart={handleAddToCartUnreachable}
                  addToCartUnavailableId={ADD_TO_CART_UNAVAILABLE_ID}
                />
              </>
            )}
          </section>
        </>
      )}

      {loading && <ProductGridSkeleton />}
    </div>
  )
}
