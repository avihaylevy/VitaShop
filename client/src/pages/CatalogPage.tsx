import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'
import { useCatalogData } from '../hooks/useCatalogData'
import { useCart } from '../state/CartContext'
import type { CartItem } from '../types/cart'
import type { ProductCardModel } from '../types/product'
import { CategoryShelf } from '../components/catalog'
import { ProductGrid } from '../components/catalog/ProductGrid'
import { ADD_TO_CART_ATTRIBUTE } from '../components/catalog/ProductCard'
import { CartDrawer } from '../components/cart/CartDrawer'
import { Button } from '../components/ui/Button'
import { Surface } from '../components/ui/Surface'
import { FOCUS_RING } from '../components/ui/focusRing'
import type { SupportedLanguage } from '../i18n/index'

const SKELETON_COUNT = 8

/**
 * One queued add-to-cart attempt, with everything needed to prove — not
 * assume — that this specific attempt is what increased the cart.
 */
type AddAttempt = {
  slug: string
  /** Cart-wide unit total captured immediately before this attempt dispatched. */
  totalBefore: number
  /** This slug's own line quantity at the same moment; 0 when not yet in the cart. */
  quantityBefore: number
}

/** This slug's current line quantity, or 0 when it has no line. */
function quantityOf(items: readonly CartItem[], slug: string): number {
  return items.find((item) => item.slug === slug)?.quantity ?? 0
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
  const { addItem, items, totalQuantity } = useCart()
  // One attempt at a time, in click order. See the add-queue comment below.
  const queueRef = useRef<ProductCardModel[]>([])
  const processingRef = useRef(false)
  const mountedRef = useRef(true)
  const totalQuantityRef = useRef(totalQuantity)
  const itemsRef = useRef(items)
  const [activeAttempt, setActiveAttempt] = useState<AddAttempt | null>(null)
  const [announced, setAnnounced] = useState<{ slug: string; count: number } | null>(null)

  /**
   * 🔴 Slice 8 (DEC-047, technical/SLICE_8_PLAN.md §5). Owned locally by
   * CatalogPage — never in CartContext, the reducer, App or a global UI
   * context — since CatalogPage is the only add-to-cart surface today.
   *
   * Parent invariant: drawerSlug === null <=> drawer closed. `open` is
   * always DERIVED as drawerSlug !== null at the render below, so the two
   * can never disagree.
   */
  const [drawerSlug, setDrawerSlug] = useState<string | null>(null)
  // The exact control that opened the drawer (DEC-047-A, R1) — written ONLY
  // on the closed->open transition inside the reconciliation effect below,
  // never on a later successful add while the drawer is already open.
  const returnFocusRef = useRef<HTMLElement>(null)
  // Scopes the return-focus lookup to this page's own grid — never a
  // document-wide query, never by translated text (SLICE_8_PLAN.md §3.1).
  const gridRef = useRef<HTMLElement>(null)
  const closeDrawer = useCallback(() => setDrawerSlug(null), [])

  // 🔴 Updated in a layout effect, never during render. A render can be
  // interrupted or discarded under concurrent React, and a ref written during
  // one would keep values from a commit that never happened — an event handled
  // by the committed tree could then snapshot uncommitted cart state, making
  // `totalBefore`/`quantityBefore` attribute an increase to the wrong attempt.
  // Layout effects run before passive effects in the same commit, so these are
  // already fresh when the reconciliation effect starts the next attempt.
  useLayoutEffect(() => {
    itemsRef.current = items
    totalQuantityRef.current = totalQuantity
  }, [items, totalQuantity])

  const activeCategory = categorySlug ? categories.find((c) => c.slug === categorySlug) : undefined
  const isInvalidCategory = categorySlug !== undefined && !loading && !error && activeCategory === undefined
  const filteredProducts = activeCategory
    ? products.filter((product) => product.categoryNameHe === activeCategory.nameHe)
    : products

  /**
   * 🔴 An add is announced only once it is PROVEN to have increased the cart,
   * and attempts are serialized so one can never be lost or misattributed.
   *
   * The reducer legitimately refuses or clamps a transition (stock ceiling,
   * invalid price, safe-integer guard) and returns the previous state.
   * Announcing straight from the click handler would report those failures as
   * successes and overwrite a previous product's true confirmation.
   *
   * Comparing before/after totals fixes that for one attempt, but a single
   * pending slot is still wrong under rapid clicking: two handlers in the same
   * tick would both read the same stale total and one attempt would go
   * unreconciled. So attempts go through a FIFO queue with exactly one active
   * at a time:
   *
   *   click        -> push to the queue, then try to start
   *   start        -> shift one, capture the CURRENT total, dispatch once
   *   reconcile    -> success iff total > totalBefore; resolve; start the next
   *
   * `processingRef` is a ref, not state, so it flips synchronously — two click
   * handlers from the same render cannot both start an attempt. No timeout, no
   * storage, no dependency, and no change to the CartContext API or reducer.
   */
  const startNextAttempt = useCallback(() => {
    if (!mountedRef.current || processingRef.current) {
      return
    }
    const next = queueRef.current.shift()
    if (!next) {
      return
    }
    processingRef.current = true
    setActiveAttempt({
      slug: next.slug,
      totalBefore: totalQuantityRef.current,
      // Captured immediately before dispatch, from the committed items.
      quantityBefore: quantityOf(itemsRef.current, next.slug),
    })
    addItem(next)
  }, [addItem])

  function handleAddToCart(slug: string) {
    const product = filteredProducts.find((candidate) => candidate.slug === slug)
    if (!product) {
      return
    }
    queueRef.current.push(product)
    startNextAttempt()
  }

  useEffect(() => {
    if (!activeAttempt) {
      return
    }
    // 🔴 BOTH conditions, not just the cart-wide total. A rising total alone
    // does not prove THIS product grew — some other cart operation could have
    // increased a different line while this attempt was refused, which would
    // attribute someone else's increase to this slug. The per-slug check is
    // what makes the announcement provably about the product it names.
    const grewOverall = totalQuantity > activeAttempt.totalBefore
    const grewThisLine = quantityOf(items, activeAttempt.slug) > activeAttempt.quantityBefore

    if (grewOverall && grewThisLine) {
      // The count stays the cart-wide committed total, so the spoken number
      // always matches the Header badge.
      setAnnounced({ slug: activeAttempt.slug, count: totalQuantity })

      // 🔴 Slice 8 — the SAME proven-success branch the announcement above
      // uses opens the drawer. Never from the click handler, never
      // optimistically, never on a refusal (SLICE_8_PLAN.md §3.3, DEC-047 D1).
      if (drawerSlug === null) {
        // Closed -> open. This transition, and only this one, establishes
        // the return-focus owner (DEC-047-A, R1). The lookup is scoped to
        // this page's own grid container, keyed by the successful slug —
        // never document-wide, never by translated text. A miss (element
        // not found) is not fabricated and does not throw: returnFocusRef
        // is simply left null, and Modal's own #main fallback applies later.
        const trigger = gridRef.current?.querySelector<HTMLElement>(
          `[${ADD_TO_CART_ATTRIBUTE}="${CSS.escape(activeAttempt.slug)}"]`,
        )
        returnFocusRef.current = trigger ?? null
        setDrawerSlug(activeAttempt.slug)
      } else {
        // Already open — content only (DEC-047 D8). No target resolved, no
        // returnFocusRef write, no re-key, no close/reopen, no replayed
        // focus entry or opening animation. The first successful add keeps
        // return-focus ownership for the whole opening.
        setDrawerSlug(activeAttempt.slug)
      }
    }
    // Resolved exactly once, success or rejection. On a rejection nothing is
    // published, so the previous announcement's text survives byte-for-byte.
    setActiveAttempt(null)
    processingRef.current = false
    startNextAttempt()
  }, [activeAttempt, items, totalQuantity, startNextAttempt, drawerSlug])

  // Set in the effect body, not just at ref init, so StrictMode's
  // mount/unmount/remount cycle restores the mounted flag instead of leaving
  // the queue permanently disabled. Nothing dispatches or publishes after
  // unmount, and a pending queue does not survive navigation away.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      processingRef.current = false
      queueRef.current = []
    }
  }, [])

  // Stored as slug + count, not as a rendered string, so the sentence
  // re-resolves through i18n on a language toggle instead of freezing in the
  // language it was announced in. The name comes from live catalogue data;
  // if the product is not present, nothing is invented and nothing is said.
  const announcedProduct = announced ? products.find((p) => p.slug === announced.slug) : undefined
  const addedToCartMessage =
    announced && announcedProduct
      ? t('addedToCart', { ns: 'catalog', product: announcedProduct.name, count: announced.count })
      : ''

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

          <section ref={gridRef} aria-labelledby="catalog-grid-heading" className="mt-8">
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
                {/*
                  One shared polite live region for the whole grid, rather
                  than one per card: a single announcement per add, never a
                  burst. Visible text, so the confirmation is not carried by
                  colour or by the badge alone. Renders empty until the first
                  add, so nothing is announced on load.
                */}
                <p role="status" className={addedToCartMessage ? 'mt-4 text-sm text-text-ink' : ''}>
                  {addedToCartMessage}
                </p>
                <ProductGrid products={filteredProducts} onAddToCart={handleAddToCart} />
              </>
            )}
          </section>
        </>
      )}

      {loading && <ProductGridSkeleton />}

      {/*
        🔴 Rendered exactly once, unconditionally, regardless of loading or
        error state — never re-keyed per product, never duplicated, no
        second CartDrawer anywhere. Its own internal open/closed and
        missing-line lifecycle (SLICE_8_PLAN.md §4) governs everything else;
        CatalogPage owns only drawerSlug, returnFocusRef and the stable
        closeDrawer identity.
      */}
      <CartDrawer
        open={drawerSlug !== null}
        slug={drawerSlug}
        onClose={closeDrawer}
        returnFocusRef={returnFocusRef}
      />
    </div>
  )
}
