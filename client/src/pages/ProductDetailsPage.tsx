import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { useProductDetail } from '../hooks/useProductDetail'
import { productDetailViewState } from '../features/catalog/productDetailViewState'
import { PriceBlock } from '../components/catalog/PriceBlock'
import { ProductImage } from '../components/catalog/ProductImage'
import { StockState } from '../components/catalog/StockState'
import { Button } from '../components/ui/Button'
import { FOCUS_RING } from '../components/ui/focusRing'
import type { ProductDetailModel } from '../types/product'
import type { SupportedLanguage } from '../i18n/index'

/**
 * MILESTONE-005 Checkpoint J — the Product Details page (§7, frozen at
 * Checkpoint A; nothing here is improvised).
 *
 * Route: `/product/:slug` — slug-keyed (DEC-033), the target
 * `ProductCard.tsx` has been linking to since Slice 6 (C8 / ISSUE-033).
 * `Product.id` is NEVER the route key: it appears only as the read-only
 * `serialNumber` value below (§7b).
 *
 * States are the detail-page-local four (loading · error · not-found ·
 * ready) — `catalogViewState`'s six are untouched and not reused (§7).
 *
 * i18n: every user-facing string resolves through the EXISTING `catalog`
 * namespace (§7c) — no `productDetails` namespace was created, and no raw
 * string is hardcoded here.
 *
 * 🔴 Not built here, deliberately: add-to-cart. The frozen §7 contract
 * covers the route, endpoint, DTO, states, i18n and a11y — it does not
 * place a cart control on this page, and Slice 8's add-to-cart queue,
 * drawer ownership and return-focus contract are `CatalogPage`'s. Adding
 * one would be inventing scope; it is recorded in the checkpoint closeout
 * instead.
 */
export function ProductDetailsPage() {
  const { t, i18n } = useTranslation('catalog')
  const language = i18n.language as SupportedLanguage
  const { slug = '' } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const { loading, product, error, notFound, retry } = useProductDetail(slug, language)

  const viewState = productDetailViewState({ loading, error, notFound, product })
  const goToCatalog = useCallback(() => navigate('/catalog'), [navigate])

  return (
    <div className="px-7 py-8">
      {viewState.state === 'loading' && (
        <p role="status" className="text-sm text-text-muted">
          {t('productDetails.loading')}
        </p>
      )}

      {viewState.state === 'error' && (
        <div className="flex flex-col items-start gap-3">
          {/*
            No error object, message or status is rendered — the same rule
            `CatalogErrorState` follows: the page cannot leak what it never
            receives. `retry` re-issues the same request; there is no local
            fallback copy of the product.
          */}
          <p role="alert" className="text-sm text-state-error">
            {t('productDetails.error')}
          </p>
          <Button variant="secondary" onClick={retry}>
            {t('productDetails.retry')}
          </Button>
        </div>
      )}

      {viewState.state === 'not-found' && (
        <div className="flex flex-col items-start gap-3">
          {/*
            🔴 One message for both an absent and an inactive product — the
            server sends an identical 404 for the two (§7), and the UI must
            not add a distinction the API deliberately withholds.
          */}
          <h1 className="text-2xl font-semibold text-text-ink">{t('productDetails.notFoundHeading')}</h1>
          <p className="text-sm text-text-muted">{t('productDetails.notFoundMessage')}</p>
          <button
            type="button"
            onClick={goToCatalog}
            className={`${FOCUS_RING} inline-flex min-h-11 items-center rounded-compact text-sm font-medium text-brand-teal underline`}
          >
            {t('productDetails.backToCatalog')}
          </button>
        </div>
      )}

      {viewState.state === 'ready' && <ProductDetailView product={viewState.product} onBack={goToCatalog} />}
    </div>
  )
}

type ProductDetailViewProps = {
  product: ProductDetailModel
  onBack: () => void
}

/**
 * The `ready` presentation, split out so the state switch above stays
 * readable. Heading order is strict: one `<h1>` (the product name), and
 * every content block below it an `<h2>` — no level is skipped, and no
 * heading exists purely for styling.
 */
function ProductDetailView({ product, onBack }: ProductDetailViewProps) {
  const { t } = useTranslation('catalog')

  return (
    <article>
      <h1 className="text-2xl font-semibold text-text-ink">{product.name}</h1>

      <div className="mt-6 flex flex-col gap-8 lg:flex-row">
        <section aria-label={t('productDetails.gallery')} className="w-full lg:max-w-md">
          {/*
            Every image carries a real, per-image alt naming the product and
            its position — never an empty alt, never the same string repeated
            for each one. The list is a real <ul>, so assistive tech reports
            how many images there are.
          */}
          <ul className="flex flex-col gap-3">
            {product.images.map((imageFile, index) => (
              <li key={imageFile}>
                <ProductImage
                  imageFile={imageFile}
                  alt={t('productDetails.imageAlt', {
                    product: product.name,
                    index: index + 1,
                    total: product.images.length,
                  })}
                />
              </li>
            ))}
          </ul>
        </section>

        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <div className="flex flex-wrap items-center gap-4">
            <PriceBlock price={product.price} />
            <StockState stockQuantity={product.stockQuantity} lowStockThreshold={product.lowStockThreshold} />
          </div>

          <section aria-labelledby="product-specifications">
            <h2 id="product-specifications" className="text-lg font-semibold text-text-ink">
              {t('productDetails.specifications')}
            </h2>
            {/*
              A description list, not a table: these are name/value pairs
              about one product, which is exactly what <dl> means. The
              numeric values are LTR-isolated so they read correctly inside
              Hebrew RTL text.
            */}
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-text-muted">{t('productDetails.brand')}</dt>
              <dd className="text-text-ink">{product.brandName}</dd>

              <dt className="text-text-muted">{t('productDetails.category')}</dt>
              <dd className="text-text-ink">{product.categoryName}</dd>

              {product.dosageForm && (
                <>
                  <dt className="text-text-muted">{t('productDetails.dosageForm')}</dt>
                  <dd className="text-text-ink">{product.dosageForm}</dd>
                </>
              )}

              {product.packageQuantity !== undefined && (
                <>
                  <dt className="text-text-muted">{t('productDetails.packageQuantity')}</dt>
                  <dd className="text-text-ink" dir="ltr">
                    {product.packageQuantity}
                  </dd>
                </>
              )}

              {/* Field 15 is nullable — omitted entirely rather than shown empty. */}
              {product.targetAudience !== null && (
                <>
                  <dt className="text-text-muted">{t('productDetails.targetAudience')}</dt>
                  <dd className="text-text-ink">{product.targetAudience}</dd>
                </>
              )}

              <dt className="text-text-muted">{t('productDetails.createdAt')}</dt>
              <dd className="text-text-ink">
                <time dateTime={product.createdAt} dir="ltr">
                  {product.createdAt.slice(0, 10)}
                </time>
              </dd>

              {/* §7b field 01 — display only. Never an input, never a link. */}
              <dt className="text-text-muted">{t('productDetails.serialNumber')}</dt>
              <dd className="break-all text-text-muted" dir="ltr">
                {product.serialNumber}
              </dd>
            </dl>
          </section>
        </div>
      </div>

      <section aria-labelledby="product-description" className="mt-8">
        <h2 id="product-description" className="text-lg font-semibold text-text-ink">
          {t('productDetails.description')}
        </h2>
        <p className="mt-2 text-sm text-text-ink">{product.description}</p>
      </section>

      <section aria-labelledby="product-usage" className="mt-8">
        <h2 id="product-usage" className="text-lg font-semibold text-text-ink">
          {t('productDetails.usageInstructions')}
        </h2>
        <p className="mt-2 text-sm text-text-ink">{product.usageInstructions}</p>
      </section>

      <section aria-labelledby="product-warnings" className="mt-8">
        <h2 id="product-warnings" className="text-lg font-semibold text-text-ink">
          {t('productDetails.warningsAllergens')}
        </h2>
        {product.warningsAllergens.length > 0 && (
          <p className="mt-2 text-sm text-text-ink">{product.warningsAllergens}</p>
        )}
        {/*
          🔴 DEC-032 DECISION B, condition 2. The flag says the manufacturer's
          page was CHECKED and the text above is everything it publishes —
          which may be partial, or nothing at all.

          It is rendered as a STATEMENT, not as an omission, and this branch is
          why the flag exists: a blank allergen section reads to a shopper as
          "no allergens", which is the misreading the whole decision was taken
          to prevent. `role="note"` so it is announced as an aside rather than
          as part of the manufacturer's own warning text.
        */}
        {product.allergenInfoIncomplete && (
          <p
            role="note"
            data-testid="allergen-info-incomplete"
            className="mt-2 border-s-4 border-state-lowstock bg-surface-sunken px-3 py-2 text-sm text-text-ink"
          >
            {t('productDetails.allergenInfoIncomplete')}
          </p>
        )}
      </section>

      {product.ingredients.length > 0 && (
        <section aria-labelledby="product-ingredients" className="mt-8">
          <h2 id="product-ingredients" className="text-lg font-semibold text-text-ink">
            {t('productDetails.ingredients')}
          </h2>
          {/*
            A real <table> with a <caption> and <th scope="col">: this is
            two-dimensional data (ingredient × amount), so table semantics
            are correct here where the specification list above used <dl>.
            It scrolls inside its own container rather than widening the
            page at 320px.
          */}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[18rem] text-start text-sm">
              <caption className="sr-only">{t('productDetails.ingredients')}</caption>
              <thead>
                <tr>
                  <th scope="col" className="pb-2 text-start font-medium text-text-muted">
                    {t('productDetails.ingredientName')}
                  </th>
                  <th scope="col" className="pb-2 text-start font-medium text-text-muted">
                    {t('productDetails.ingredientAmount')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {product.ingredients.map((ingredient) => (
                  <tr key={ingredient.name} className="border-t border-border-hairline">
                    <td className="py-2 text-text-ink">{ingredient.name}</td>
                    <td className="py-2 text-text-ink">
                      {/* Amount + unit stay LTR inside Hebrew RTL text. */}
                      <span dir="ltr">
                        {ingredient.amount} {ingredient.unit}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Field 14 is "0 or more" — an empty set renders no section at all. */}
      {product.healthGoals.length > 0 && (
        <section aria-labelledby="product-health-goals" className="mt-8">
          <h2 id="product-health-goals" className="text-lg font-semibold text-text-ink">
            {t('productDetails.healthGoals')}
          </h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {product.healthGoals.map((goal) => (
              <li key={goal} className="rounded-compact bg-well px-3 py-1 text-sm text-text-ink">
                {goal}
              </li>
            ))}
          </ul>
        </section>
      )}

      <button
        type="button"
        onClick={onBack}
        className={`${FOCUS_RING} mt-10 inline-flex min-h-11 items-center rounded-compact text-sm font-medium text-brand-teal underline`}
      >
        {t('productDetails.backToCatalog')}
      </button>
    </article>
  )
}
