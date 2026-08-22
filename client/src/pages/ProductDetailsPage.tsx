import { useCallback, useState } from 'react'
import { textLinkClass } from '../components/ui/TextLink'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { useProductDetail } from '../hooks/useProductDetail'
import { productDetailViewState } from '../features/catalog/productDetailViewState'
import { PriceBlock } from '../components/catalog/PriceBlock'
import { ProductImage } from '../components/catalog/ProductImage'
import { StockState } from '../components/catalog/StockState'
import { ADD_TO_CART_ATTRIBUTE } from '../components/catalog/ProductCard'
import { CartDrawer } from '../components/cart/CartDrawer'
import { AddedToCartToast } from '../components/cart/AddedToCartToast'
import { resetOnConfirmedAdd, useAddToCart } from '../hooks/useAddToCart'
import { getStockState } from '../lib/stockState'
import { Button } from '../components/ui/Button'
import { FavouriteButton } from '../components/catalog/FavouriteButton'
import { AddQuantityStepper } from '../components/catalog/AddQuantityStepper'
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
 * ISSUE-035 (2026-08-15, Wave 4) — add-to-cart, AT LAST. The note that
 * stood here said building it would mean re-implementing Slice 8's
 * CatalogPage-local machinery; ISSUE-105 moved that machinery into the
 * shared `useAddToCart`, which is exactly what renders here now — the same
 * FIFO-free confirmed-success flow, drawer ownership and return-focus
 * contract, one implementation, third consumer.
 *
 * 🔴 The FAVOURITES control is deliberately still absent — the other half
 * of this issue's "decide together" rule. There are NO server routes for
 * favourites (M-009's opening move, ISSUE-058); a heart that saves into
 * memory would be the dead-end the user already reported. Decision: the
 * detail page gains the cart action now and the favourites action when
 * M-009 gives it something real to do.
 */
export function ProductDetailsPage() {
  const { t, i18n } = useTranslation('catalog')
  const language = i18n.language as SupportedLanguage
  const { slug = '' } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const { loading, product, error, notFound, retry } = useProductDetail(slug, language)

  const viewState = productDetailViewState({ loading, error, notFound, product })
  const goToCatalog = useCallback(() => navigate('/catalog'), [navigate])

  const { handleAddToCart, drawerOpen, closeDrawer, returnFocusRef, gridRef, announced } =
    useAddToCart()

  // The caller resolves the announced product's name (the hook stores
  // slug + count only, so the sentence re-resolves on a language toggle).
  // Only this page's own product is addable here.
  const addedToCartMessage =
    announced && viewState.state === 'ready' && announced.slug === viewState.product.slug
      ? t('addedToCart', { product: viewState.product.name, count: announced.count })
      : ''

  return (
    <div ref={gridRef} className="px-7 py-8">
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
          <h1 className="heading-page">{t('productDetails.notFoundHeading')}</h1>
          <p className="text-sm text-text-muted">{t('productDetails.notFoundMessage')}</p>
          <button
            type="button"
            onClick={goToCatalog}
            className={textLinkClass()}
          >
            {t('productDetails.backToCatalog')}
          </button>
        </div>
      )}

      {viewState.state === 'ready' && (
        <ProductDetailView
          product={viewState.product}
          onBack={goToCatalog}
          onAddToCart={handleAddToCart}
        />
      )}

      {/* Rendered once, unconditionally — the same CartDrawer contract as
          CatalogPage and HomePage (DEC-047/DEC-073, via useAddToCart). */}
      <CartDrawer open={drawerOpen} onClose={closeDrawer} returnFocusRef={returnFocusRef} />
      {/* Fifth list item 3 — the confirmation POPUP; the one status region for adds on this page. */}
      <AddedToCartToast message={addedToCartMessage} announceKey={announced} suppress={drawerOpen} />
    </div>
  )
}

type ProductDetailViewProps = {
  product: ProductDetailModel
  onBack: () => void
  onAddToCart: (slug: string, quantity: number) => void | Promise<boolean>
}

/**
 * The `ready` presentation, split out so the state switch above stays
 * readable. Heading order is strict: one `<h1>` (the product name), and
 * every content block below it an `<h2>` — no level is skipped, and no
 * heading exists purely for styling.
 */
function ProductDetailView({ product, onBack, onAddToCart }: ProductDetailViewProps) {
  const { t } = useTranslation('catalog')
  // The same single disable condition as ProductCard: real stock only.
  const isOut = getStockState(product.stockQuantity, product.lowStockThreshold) === 'out'
  const [quantity, setQuantity] = useState(1)

  return (
    <article>
      <h1 className="heading-page">
        {product.name}
      </h1>

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
          {/* ISSUE-123 — the user's ordering: the product DATA first, the
              price + buy action BELOW it (moved from above). */}
          <section aria-labelledby="product-specifications">
            <h2 id="product-specifications" className="heading-section">
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
                  {/* ISSUE-123 — the number hugs its label: the dd itself
                      follows the page direction (start-aligned), only the
                      numeral inside is LTR-isolated. dir on the dd made the
                      whole cell left-aligned, stranding the number far from
                      the Hebrew labels. */}
                  <dd className="text-text-ink">
                    <span dir="ltr" style={{ unicodeBidi: 'isolate' }}>
                      {product.packageQuantity}
                    </span>
                    {/* The thirteenth list — volume forms carry their unit
                        ("250 מ״ל"); countable forms stay a bare count under
                        the neutral "כמות באריזה" label. */}
                    {product.packageUnit && <> {product.packageUnit}</>}
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
                <time dateTime={product.createdAt} dir="ltr" style={{ unicodeBidi: 'isolate' }}>
                  {product.createdAt.slice(0, 10)}
                </time>
              </dd>

              {/* 🔴 ISSUE-123 — the serial number (§7b field 01) is NOT
                  displayed, by the user's explicit decision (a knowing
                  deviation, recorded): a UUID means nothing to a shopper.
                  The field stays in the DTO and the DB untouched. */}
            </dl>
          </section>

          {/* ISSUE-035's action + ISSUE-123's placement: below the data. */}
          <div className="flex flex-wrap items-center gap-4">
            <PriceBlock price={product.price} size="price" />
            <StockState stockQuantity={product.stockQuantity} lowStockThreshold={product.lowStockThreshold} />
          </div>
          {/*
            M-012 C / DEC-086 O4 — the card/detail surfaces keep ONE price
            plus this factual hint. Static for every visitor: the price
            shown is the full price, and the discounted figures appear in
            the cart the moment a member adds (§3.4 — the server prices).
          */}
          <p className="text-xs text-text-muted">{t('hint.detail', { ns: 'club' })}</p>
          <div className="flex flex-wrap items-center gap-3">
            {/* ISSUE-118 — the same shared stepper as the cards. */}
            <AddQuantityStepper value={quantity} onChange={setQuantity} productName={product.name} />
            <Button
              variant="primary"
              disabled={isOut}
              onClick={() =>
                resetOnConfirmedAdd(onAddToCart(product.slug, quantity), () => setQuantity(1))
              }
              {...{ [ADD_TO_CART_ATTRIBUTE]: product.slug }}
            >
              {t('addToCart')}
            </Button>
            {/* ISSUE-115 — the shared heart (FavouriteButton owns the A10
                guest gate and the failure announcement). */}
            <FavouriteButton
              slug={product.slug}
              className="rounded-round border border-border-hairline"
            />
          </div>
        </div>
      </div>

      <section aria-labelledby="product-description" className="mt-8">
        <h2 id="product-description" className="heading-section">
          {t('productDetails.description')}
        </h2>
        <p className="mt-2 text-sm text-text-ink">{product.description}</p>
      </section>

      <section aria-labelledby="product-usage" className="mt-8">
        <h2 id="product-usage" className="heading-section">
          {t('productDetails.usageInstructions')}
        </h2>
        <p className="mt-2 text-sm text-text-ink">{product.usageInstructions}</p>
      </section>

      <section aria-labelledby="product-warnings" className="mt-8">
        <h2 id="product-warnings" className="heading-section">
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
          <h2 id="product-ingredients" className="heading-section">
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
          <h2 id="product-health-goals" className="heading-section">
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
        className={`${textLinkClass()} mt-10`}
      >
        {t('productDetails.backToCatalog')}
      </button>
    </article>
  )
}
