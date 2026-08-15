import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { fetchFavourites } from '../lib/favouritesApi'
import { mapCatalogProduct } from '../lib/mapCatalogProduct'
import { useFavourites } from '../state/FavouritesContext'
import { useAddToCart } from '../hooks/useAddToCart'
import { ProductGrid } from '../components/catalog/ProductGrid'
import { CartDrawer } from '../components/cart/CartDrawer'
import { Button } from '../components/ui/Button'
import { FOCUS_RING } from '../components/ui/focusRing'
import type { CatalogProductDto } from '../types/catalog'
import type { SupportedLanguage } from '../i18n'

/**
 * ISSUE-115 / REQ-F-034 — the favourites page the header has linked to since
 * MILESTONE-005 (ISSUE-058's dead-end: until this pass no route existed and
 * the link landed on the 404 page).
 *
 * Sits behind RequireAuth (the ROUTE is personal data); the catalogue's
 * hearts stay guest-visible per A10.
 *
 * The page owns its LIST; the context owns the slug set. Un-hearting a card
 * here removes it from the visible list by DERIVING the visible items from
 * the context's own set — one source of truth, no refetch per toggle.
 *
 * The cards are full SHOPPING cards — the same add-to-cart machinery as the
 * catalogue and home page, through the same shared hook.
 */
export function FavouritesPage() {
  const { t, i18n } = useTranslation('catalog')
  const language = i18n.language as SupportedLanguage
  const { isFavourite } = useFavourites()
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'ready'; items: CatalogProductDto[] } | { status: 'failed' }
  >({ status: 'loading' })

  const load = useCallback(async (signal?: AbortSignal) => {
    setState({ status: 'loading' })
    const result = await fetchFavourites(signal)
    if (signal?.aborted) return
    // 'unauthenticated' cannot ordinarily happen behind RequireAuth — a
    // session that died in between renders the failure state and the retry
    // round-trips to the same 401, whose screen-level answer is RequireAuth's.
    setState(result.ok ? { status: 'ready', items: result.items } : { status: 'failed' })
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const { handleAddToCart, drawerOpen, closeDrawer, returnFocusRef, gridRef, announced } =
    useAddToCart()

  const visible =
    state.status === 'ready' ? state.items.filter((item) => isFavourite(item.slug)) : []
  const products = visible.map((dto) => mapCatalogProduct(dto, language))

  const announcedProduct = announced
    ? products.find((product) => product.slug === announced.slug)
    : undefined
  const addedToCartMessage =
    announced && announcedProduct
      ? t('addedToCart', { product: announcedProduct.name, count: announced.count })
      : ''

  return (
    <div className="px-7 py-8">
      <h1 className="text-2xl font-semibold text-text-ink">{t('favouritesPage.title')}</h1>

      {/* One always-mounted polite region for load/failure — the ISSUE-098 shape. */}
      <p role="status" className="mt-4 text-sm text-text-muted">
        {state.status === 'loading' ? t('favouritesPage.loading') : ''}
        {state.status === 'failed' ? t('favouritesPage.error') : ''}
      </p>

      {state.status === 'failed' && (
        <Button variant="secondary" className="mt-3" onClick={() => void load()}>
          {t('favouritesPage.retry')}
        </Button>
      )}

      {state.status === 'ready' && visible.length === 0 && (
        <div className="mt-6 flex flex-col items-start gap-3">
          <p className="text-sm text-text-muted">{t('favouritesPage.empty')}</p>
          <Link to="/catalog" className={`${FOCUS_RING} rounded-card text-sm text-brand-teal underline`}>
            {t('favouritesPage.emptyCta')}
          </Link>
        </div>
      )}

      {state.status === 'ready' && visible.length > 0 && (
        <div ref={gridRef} className="mt-6">
          <p role="status" className="sr-only">
            {addedToCartMessage}
          </p>
          <ProductGrid products={products} onAddToCart={handleAddToCart} />
        </div>
      )}

      <CartDrawer open={drawerOpen} onClose={closeDrawer} returnFocusRef={returnFocusRef} />
    </div>
  )
}
