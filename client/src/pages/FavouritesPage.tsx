import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { fetchFavourites } from '../lib/favouritesApi'
import { mapCatalogProduct } from '../lib/mapCatalogProduct'
import { useFavourites, type FavouriteToggleResult } from '../state/FavouritesContext'
import { useAddToCart } from '../hooks/useAddToCart'
import { ProductGrid } from '../components/catalog/ProductGrid'
import { CatalogLoadingState } from '../components/catalog/CatalogLoadingState'
import { CatalogEmptyState } from '../components/catalog/CatalogEmptyState'
import { CartDrawer } from '../components/cart/CartDrawer'
import { AddedToCartToast } from '../components/cart/AddedToCartToast'
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
  const navigate = useNavigate()
  const { isFavourite, replaceAll } = useFavourites()
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'ready'; items: CatalogProductDto[] } | { status: 'failed' }
  >({ status: 'loading' })

  /*
   * 🔴 EVERY load carries an abort signal tied to this mount — including the
   * retry (review of this diff: a signal-less retry left in flight while the
   * shopper navigated away would later call replaceAll with a STALE list,
   * un-filling a heart they had just pressed elsewhere; the provider
   * outlives this page, so the global write must not).
   */
  const controllerRef = useRef<AbortController | null>(null)

  const load = useCallback(
    async (signal: AbortSignal) => {
      setState({ status: 'loading' })
      const result = await fetchFavourites(signal)
      if (signal.aborted) return
      // 'unauthenticated' cannot ordinarily happen behind RequireAuth — a
      // session that died in between renders the failure state and the retry
      // round-trips to the same 401, whose screen-level answer is RequireAuth's.
      setState(result.ok ? { status: 'ready', items: result.items } : { status: 'failed' })
      // One server answer feeds BOTH consumers: syncing the context here
      // repairs a failed provider hydration (and the header badge) instead
      // of letting the page's own filter contradict the list it just got.
      if (result.ok) replaceAll(result.items.map((item) => item.slug))
    },
    [replaceAll],
  )

  const startLoad = useCallback(() => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    void load(controller.signal)
  }, [load])

  useEffect(() => {
    startLoad()
    return () => controllerRef.current?.abort()
  }, [startLoad])

  const { handleAddToCart, drawerOpen, closeDrawer, returnFocusRef, gridRef, announced } =
    useAddToCart()

  // Memoized: this page re-renders on drawer/announcement/context changes
  // far more often than the list itself changes — the grid's props must not
  // gain a fresh identity on every one of those.
  const products = useMemo(() => {
    const visible =
      state.status === 'ready' ? state.items.filter((item) => isFavourite(item.slug)) : []
    return visible.map((dto) => mapCatalogProduct(dto, language))
  }, [state, isFavourite, language])

  /*
   * 🔴 THE UNMOUNT-TAKES-FOCUS FAMILY (browser-verification.md): un-hearting
   * derives the card — and the very button the user pressed — out of view.
   * The heart's own settled-toggle EVENT drives the response (never an
   * inferred count change, which also fires when the provider clears the
   * set on sign-out): announce from a region that was ALREADY mounted, and
   * repair keyboard focus to the heading when the unmount dropped it to
   * <body>. The message names the PRODUCT, so consecutive removals produce
   * distinct sentences (identical text is not re-announced) and there is no
   * "0 products left" zero case.
   */
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [removalMessage, setRemovalMessage] = useState('')
  const handleFavouriteToggled = useCallback(
    (result: FavouriteToggleResult, slug: string) => {
      if (result !== 'removed') return
      if (state.status !== 'ready') return
      const removed = state.items.find((item) => item.slug === slug)
      if (!removed) return
      const name = language === 'he' ? removed.nameHe : removed.nameEn
      setRemovalMessage(t('favouritesPage.removed', { product: name }))
    },
    [state, language, t],
  )
  useEffect(() => {
    if (!removalMessage) return
    // Runs after the commit that unmounted the card. preventScroll: a mouse
    // user un-hearting below the fold must not have the viewport yanked to
    // the top; the focus target still anchors the next Tab press.
    if (document.activeElement === document.body) {
      headingRef.current?.focus({ preventScroll: true })
    }
  }, [removalMessage])

  const announcedProduct = announced
    ? products.find((product) => product.slug === announced.slug)
    : undefined
  const addedToCartMessage =
    announced && announcedProduct
      ? t('addedToCart', { product: announcedProduct.name, count: announced.count })
      : ''

  return (
    <div className="px-7 py-8">
      <h1 ref={headingRef} tabIndex={-1} className={`${FOCUS_RING} rounded-card heading-page`}>
        {t('favouritesPage.title')}
      </h1>

      {/* Always-mounted removal announcement — see the unmount-takes-focus note above. */}
      <p role="status" className="sr-only">
        {removalMessage}
      </p>

      {state.status === 'loading' && (
        <div className="mt-6">
          <CatalogLoadingState />
        </div>
      )}

      {state.status === 'failed' && (
        <div className="mt-6 flex flex-col items-start gap-3">
          <p role="alert" className="text-sm text-state-error">
            {t('favouritesPage.error')}
          </p>
          <Button variant="secondary" onClick={startLoad}>
            {t('favouritesPage.retry')}
          </Button>
        </div>
      )}

      {state.status === 'ready' && products.length === 0 && (
        <div className="mt-2">
          <CatalogEmptyState
            heading={t('favouritesPage.emptyHeading')}
            message={t('favouritesPage.empty')}
            action={{ label: t('favouritesPage.emptyCta'), onClick: () => navigate('/catalog') }}
          />
        </div>
      )}

      {state.status === 'ready' && products.length > 0 && (
        <div ref={gridRef} className="mt-6">
          <ProductGrid
            products={products}
            onAddToCart={handleAddToCart}
            onFavouriteToggled={handleFavouriteToggled}
          />
        </div>
      )}

      <CartDrawer open={drawerOpen} onClose={closeDrawer} returnFocusRef={returnFocusRef} />
      {/* Fifth list item 3 — the confirmation POPUP; the one status region for adds on this page. */}
      <AddedToCartToast message={addedToCartMessage} announceKey={announced} suppress={drawerOpen} />
    </div>
  )
}
