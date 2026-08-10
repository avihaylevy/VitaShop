import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router'
import { useCatalogData } from '../hooks/useCatalogData'
import { useCatalogCategories } from '../hooks/useCatalogCategories'
import { useCatalogFacets } from '../hooks/useCatalogFacets'
import { useCloseAboveBreakpoint } from '../hooks/useCloseAboveBreakpoint'
import { useCart } from '../state/CartContext'
import type { CartItem } from '../types/cart'
import type { ProductCardModel } from '../types/product'
import { CategoryShelf, CatalogLoadingState, CatalogErrorState, CatalogEmptyState } from '../components/catalog'
import { ProductGrid } from '../components/catalog/ProductGrid'
import { CatalogSearchField } from '../components/catalog/CatalogSearchField'
import { CatalogSortSelect } from '../components/catalog/CatalogSortSelect'
import { CatalogFilterPanel } from '../components/catalog/CatalogFilterPanel'
import { CatalogPagination } from '../components/catalog/CatalogPagination'
import { CatalogFallbackSection } from '../components/catalog/CatalogFallbackSection'
import { ADD_TO_CART_ATTRIBUTE } from '../components/catalog/ProductCard'
import { CartDrawer } from '../components/cart/CartDrawer'
import { Button } from '../components/ui/Button'
import { Drawer } from '../components/ui/Drawer'
import { VisuallyHidden } from '../components/ui/VisuallyHidden'
import { catalogViewState } from '../features/catalog/catalogViewState'
import {
  activeFilterCount,
  buildFilterGroups,
  hasActiveFilters,
  toggleFilterValue,
  type RepeatableFilterKey,
} from '../features/catalog/catalogQueryControls'
import {
  buildCatalogSearchParams,
  nextCatalogUrlState,
  type CatalogUrlState,
} from '../features/catalog/catalogUrlState'
import type { SupportedLanguage } from '../i18n/index'

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

/**
 * Production /catalog route. MILESTONE-005 Checkpoint H — category
 * filtering (and every other §4 filter) is now server-side; the page's own
 * job is deriving `activeCategory` for display (heading text) from its own
 * categories list against `urlState.category`, and wiring the data layer's
 * six-state output into `catalogViewState`.
 */
export function CatalogPage() {
  const { t, i18n } = useTranslation(['layout', 'catalog'])
  const language = i18n.language as SupportedLanguage
  const { categories } = useCatalogCategories()
  const { facets } = useCatalogFacets()
  const {
    loading,
    products,
    error,
    invalidCategory,
    hasNarrowingQuery,
    totalItems,
    page,
    totalPages,
    fallback,
    urlState,
    retry,
  } = useCatalogData(language)
  const categorySlug = urlState.category
  const [, setSearchParams] = useSearchParams()
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
  const gridRef = useRef<HTMLDivElement>(null)
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

  // Still owned by CatalogPage per §8 — the resolver's output does not
  // always carry activeCategory (e.g. 'loading', 'error', 'invalid-category',
  // 'catalog-empty' do not), but gridHeading needs it in every state.
  const activeCategory = categorySlug ? categories.find((c) => c.slug === categorySlug) : undefined
  const viewState = catalogViewState({
    loading,
    error,
    invalidCategory,
    hasNarrowingQuery,
    activeCategory,
    products,
    totalItems,
    fallback,
  })
  const navigate = useNavigate()
  const goToAllProducts = useCallback(() => navigate('/catalog'), [navigate])

  /**
   * MILESTONE-005 Checkpoint I — the single navigation path for every query
   * control. Every committed change goes through Checkpoint G's frozen
   * `nextCatalogUrlState` (which owns §5's "page resets to 1 whenever any
   * other parameter changes; page changes never touch other params" rule)
   * and `buildCatalogSearchParams` (which owns the canonical field order and
   * the defaults/empties omission). Nothing here re-implements either.
   *
   * PUSH, deliberately: §5 — "committed filter/sort/search changes push
   * history; typing does not". The only replace-navigation in the catalogue
   * is §5a's canonicalization, which lives in the data layer (Checkpoint H)
   * and is not reachable from here.
   */
  const applyQueryChange = useCallback(
    (changes: Partial<CatalogUrlState>) => {
      setSearchParams(buildCatalogSearchParams(nextCatalogUrlState(urlState, changes)))
    },
    [setSearchParams, urlState],
  )

  const handleSearchSubmit = useCallback(
    // An emptied field clears `q` rather than sending `?q=` — the same
    // presence rule `buildCatalogSearchParams`/`hasNarrowingQuery` use.
    (query: string) => applyQueryChange({ q: query.length > 0 ? query : undefined }),
    [applyQueryChange],
  )

  const handleSortChange = useCallback((sort: string) => applyQueryChange({ sort }), [applyQueryChange])

  const handleToggleFilterValue = useCallback(
    (key: RepeatableFilterKey, value: string) => applyQueryChange({ [key]: toggleFilterValue(urlState[key], value) }),
    [applyQueryChange, urlState],
  )

  const handlePriceCommit = useCallback(
    (next: { minPrice: string; maxPrice: string }) =>
      applyQueryChange({
        minPrice: next.minPrice.length > 0 ? next.minPrice : undefined,
        maxPrice: next.maxPrice.length > 0 ? next.maxPrice : undefined,
      }),
    [applyQueryChange],
  )

  const handleInStockChange = useCallback(
    // The server accepts the literal "true" only (§4); unchecking omits the
    // parameter entirely rather than sending "false", which would 400.
    (checked: boolean) => applyQueryChange({ inStock: checked ? 'true' : undefined }),
    [applyQueryChange],
  )

  /** §5: "Clear filters" → bare `/catalog`. */
  const handleClearFilters = useCallback(() => setSearchParams(new URLSearchParams()), [setSearchParams])

  // §10: "a page change moves focus to the results heading". Recorded at the
  // click and consumed once the new page has actually settled — focusing
  // while the request is still in flight would move focus to a heading
  // describing results that are not on screen yet.
  const pendingPageFocusRef = useRef(false)
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null)

  const handlePageChange = useCallback(
    (nextPage: number) => {
      pendingPageFocusRef.current = true
      // A page-ONLY change, so `nextCatalogUrlState` leaves every other
      // parameter untouched and does not reset the page it was just given.
      applyQueryChange({ page: nextPage })
    },
    [applyQueryChange],
  )

  useEffect(() => {
    if (loading || !pendingPageFocusRef.current) return
    pendingPageFocusRef.current = false
    resultsHeadingRef.current?.focus()
  }, [loading])

  const [filtersOpen, setFiltersOpen] = useState(false)
  const closeFilters = useCallback(() => setFiltersOpen(false), [])
  // The trigger is `md:hidden`, matching this hook's own `md` breakpoint —
  // if the drawer stayed mounted past 768px its trigger would be
  // display:none while inert/scroll-lock were still in force.
  useCloseAboveBreakpoint(filtersOpen, closeFilters)

  const filterGroups = buildFilterGroups(facets, urlState, language)
  const filtersActive = hasActiveFilters(urlState)
  const activeCount = activeFilterCount(urlState)

  const filterPanel = (
    <CatalogFilterPanel
      groups={filterGroups}
      onToggleValue={handleToggleFilterValue}
      minPrice={urlState.minPrice ?? ''}
      maxPrice={urlState.maxPrice ?? ''}
      onPriceCommit={handlePriceCommit}
      inStockChecked={urlState.inStock === 'true'}
      onInStockChange={handleInStockChange}
      onClear={handleClearFilters}
      clearDisabled={!filtersActive}
    />
  )

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
    // Checkpoint I — fallback suggestions are real, addable products, so the
    // lookup spans both sets. They stay OUT of `products` (§6b: never
    // substituted into the primary result set); this is a lookup, not a
    // merge, and nothing downstream sees a combined list.
    const product =
      products.find((candidate) => candidate.slug === slug) ??
      fallback?.items.find((candidate) => candidate.slug === slug)
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
  const announcedProduct = announced
    ? (products.find((p) => p.slug === announced.slug) ?? fallback?.items.find((p) => p.slug === announced.slug))
    : undefined
  const addedToCartMessage =
    announced && announcedProduct
      ? t('addedToCart', { ns: 'catalog', product: announcedProduct.name, count: announced.count })
      : ''

  /**
   * §10 — whether this state has a settled count to announce. False in
   * every non-settled or non-countable state (loading, error,
   * invalid-category), so nothing is announced for a query that never
   * produced a count. `totalItems` is the SERVER's count for the primary
   * query — fallback suggestions never contribute to it (§6b).
   */
  const hasResultCount =
    viewState.state === 'ready' || viewState.state === 'filtered-empty' || viewState.state === 'catalog-empty'

  const gridHeading =
    viewState.state === 'invalid-category'
      ? t('catalogPage.invalidCategoryHeading', { ns: 'catalog' })
      : activeCategory
        ? language === 'he'
          ? activeCategory.nameHe
          : activeCategory.nameEn
        : t('categoryShelf.allProducts', { ns: 'catalog' })

  return (
    <div className="px-7 py-8">
      <h1 className="text-2xl font-semibold text-text-ink">{t('nav.catalog', { ns: 'layout' })}</h1>

      {/*
        🔴 The query controls render PERSISTENTLY, outside the resolved-state
        switch below, in every state including loading and error.

        This does not weaken §9a: that contract is about PRODUCTS ("no stale
        products render during loading or error"), and the results area below
        still swaps wholesale into the unchanged Slice 9 loading/error
        presentation. The controls are not results.

        It is also the only way to satisfy §10's "applying a filter must not
        steal focus from the control just used": every committed change
        re-enters the loading contract, so a control living inside the state
        switch would unmount on its own activation and drop focus to
        <body> — the exact defect §10 forbids. Keeping them mounted keeps
        focus where the user left it.
      */}
      <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <CatalogSearchField value={urlState.q ?? ''} onSubmit={handleSearchSubmit} />

        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            className="md:hidden"
            aria-haspopup="dialog"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen(true)}
          >
            <span aria-hidden="true">
              {t('filters.openLabel', { ns: 'catalog' })}
              {activeCount > 0 ? ` (${activeCount})` : ''}
            </span>
            {/*
              The visible label carries a bare numeral for space; the
              accessible name spells the count out through i18n so it is
              never a naked number read out of context.
            */}
            <VisuallyHidden>
              {activeCount > 0
                ? `${t('filters.openLabel', { ns: 'catalog' })} — ${t('filters.activeCount', { ns: 'catalog', count: activeCount })}`
                : t('filters.openLabel', { ns: 'catalog' })}
            </VisuallyHidden>
          </Button>

          <CatalogSortSelect value={urlState.sort} onChange={handleSortChange} />
        </div>
      </div>

      {/*
        🔴 Exactly one resolved catalogue state renders below, per
        technical/UI_SLICES.md §7/§8 — the resolver call replaces the
        page's own inline predicate computation, it does not run alongside
        it.
      */}
      <div className="mt-6 flex flex-col gap-8 md:flex-row">
        {/*
          Desktop filter rail — a complementary landmark with its own
          accessible name. Below `md` it is display:none (so it is absent
          from the accessibility tree, never a duplicate of the Drawer's
          copy) and the Drawer at the end of this page owns the same panel.
          One panel component, two mountings — no second filter design.
        */}
        <aside aria-label={t('filters.heading', { ns: 'catalog' })} className="hidden w-60 shrink-0 md:block">
          <h2 className="mb-4 text-lg font-semibold text-text-ink">{t('filters.heading', { ns: 'catalog' })}</h2>
          {filterPanel}
        </aside>

        {/*
          `gridRef` scopes the add-to-cart return-focus lookup (Slice 8,
          DEC-047-A R1) to this page's own product cards. It moved from the
          results <section> to this wrapper at Checkpoint I so it also spans
          the fallback region's cards, which are addable too — a scoping
          change only; the lookup, its attribute and its null-handling are
          untouched.
        */}
        <div ref={gridRef} className="min-w-0 flex-1">
          {/*
            🔴 Checkpoint I correction, finding 1. `CategoryShelf` renders
            PERSISTENTLY, for exactly the reason the toolbar above does:
            `category` is a §4 filter parameter and this shelf is its
            control (real <Link>s). While it sat inside the resolved-state
            switch, every category click started a query, the page entered
            the loading contract, the shelf unmounted, and focus fell from
            the just-clicked link to <body> — precisely the defect §10
            forbids ("applying a filter must not steal focus from the
            control just used"), on the page's most-used filter.

            §9a is still honoured: it governs PRODUCTS ("no stale products
            render during loading or error"), and the results area below
            still swaps wholesale into the unchanged Slice 9 loading/error
            presentation. A navigation control is not a result. The shelf's
            own props, markup and component are untouched — only where it
            is mounted changed.
          */}
          <CategoryShelf categories={categories} activeCategorySlug={categorySlug} />

          {/*
            §10 — the result count in a POLITE live region, one announcement
            per settled query. It renders empty while loading, so a §5a
            canonicalizing refetch (which stays in the loading contract
            throughout, never rendering the past-the-end response) announces
            exactly ONCE, for the canonical page — not once per request.
          */}
          <p role="status" className={hasResultCount ? 'mb-2 text-sm text-text-muted' : ''}>
            {/*
              🔴 Checkpoint I correction, finding 4 — §10's "LTR numeric
              isolation for prices and counts". The numeral is interpolated
              into a Hebrew RTL run, so it is wrapped in `dir="ltr"` the
              same way `CatalogPagination` already wraps its page numbers.
              A bare integer happens to render correctly under the bidi
              algorithm today, which is why the width matrix passed either
              way; the isolation is what keeps that true the moment the
              copy grows a range, a percentage or adjacent punctuation.
              `Trans` is used because a `dir` attribute cannot be injected
              through `t()`'s string interpolation.
            */}
            {hasResultCount && (
              <Trans
                i18nKey="catalogPage.resultCount"
                ns="catalog"
                count={totalItems}
                components={{ n: <span dir="ltr" /> }}
              />
            )}
          </p>

          {viewState.state === 'loading' && <CatalogLoadingState />}

          {viewState.state === 'error' && <CatalogErrorState onRetry={retry} />}

          {(viewState.state === 'invalid-category' ||
            viewState.state === 'catalog-empty' ||
            viewState.state === 'filtered-empty' ||
            viewState.state === 'ready') && (
            <>
              {/*
            🔴 Checkpoint E fix, corrected in the E correction pass:
            invalid-category is the one branch where `gridHeading` and
            `CatalogEmptyState`'s own heading resolve to the exact same
            translated string (both `invalidCategoryHeading`) — rendering
            both as separate <h2> elements duplicated the heading both
            visually and to assistive tech (confirmed live in the
            Checkpoint D ARIA snapshot). The first correction attempt
            replaced the outer <h2> with an `aria-label` carrying the same
            text — a Codex Major finding caught that this still duplicates
            the announcement, just via a different mechanism (the
            section's accessible name plus the heading's accessible name,
            both "Category not found"). The actual fix: leave the section
            UNNAMED for this one branch — no aria-label, no aria-labelledby
            substitute — since `CatalogEmptyState`'s own <h2> already gives
            assistive tech everything it needs; a landmark does not require
            an accessible name to be usable. Every other state's outer
            heading names something CatalogEmptyState's own heading does
            not (the region/category name vs. why it is empty), so only
            this one branch skips the outer <h2>. No component prop,
            translation key, or visual style changed.
          */}
              <section
                aria-labelledby={viewState.state === 'invalid-category' ? undefined : 'catalog-grid-heading'}
                className="mt-8"
              >
                {viewState.state !== 'invalid-category' && (
                  // tabIndex={-1} makes the heading a programmatic focus
                  // target ONLY — never a tab stop (§10: "a page change
                  // moves focus to the results heading"). It is not
                  // reachable by Tab, so the keyboard order is unchanged.
                  <h2
                    id="catalog-grid-heading"
                    ref={resultsHeadingRef}
                    tabIndex={-1}
                    className="text-lg font-semibold text-text-ink"
                  >
                    {gridHeading}
                  </h2>
                )}

                {viewState.state === 'invalid-category' ? (
                  <CatalogEmptyState
                    heading={t('catalogPage.invalidCategoryHeading', { ns: 'catalog' })}
                    message={t('catalogPage.invalidCategoryMessage', { ns: 'catalog' })}
                    action={{ label: t('catalogPage.backToAll', { ns: 'catalog' }), onClick: goToAllProducts }}
                  />
                ) : viewState.state === 'catalog-empty' ? (
                  <CatalogEmptyState
                    heading={t('catalogPage.catalogEmptyHeading', { ns: 'catalog' })}
                    message={t('catalogPage.catalogEmptyMessage', { ns: 'catalog' })}
                  />
                ) : viewState.state === 'filtered-empty' ? (
                  <CatalogEmptyState
                    /*
                      🔴 Found live during the Checkpoint I browser pass: the
                      pre-existing `filteredEmptyHeading` reads "no products
                      in this category", which was accurate while category
                      was the ONLY filter (Slice 9). With search and filters
                      shipping here, a zero-result search with no category
                      was announcing a category that was never selected. The
                      category wording is kept verbatim for the case it
                      actually describes; every other narrowing query now
                      gets a heading that claims nothing false.
                    */
                    heading={
                      viewState.activeCategory
                        ? t('catalogPage.filteredEmptyHeading', { ns: 'catalog' })
                        : t('catalogPage.noResultsHeading', { ns: 'catalog' })
                    }
                    /*
                      §10 — zero-results copy states WHAT was searched. The
                      search term wins over the category name when both are
                      present: it is the more specific thing the user just
                      did. The pre-existing category and generic messages
                      are unchanged, so no previously covered case changed
                      wording.
                    */
                    message={
                      urlState.q
                        ? t('catalogPage.filteredEmptySearchMessage', { ns: 'catalog', query: urlState.q })
                        : viewState.activeCategory
                          ? t('catalogPage.emptyCategoryMessage', {
                              ns: 'catalog',
                              category:
                                language === 'he' ? viewState.activeCategory.nameHe : viewState.activeCategory.nameEn,
                            })
                          : t('catalogPage.filteredEmptyFiltersMessage', { ns: 'catalog' })
                    }
                    action={{ label: t('catalogPage.backToAll', { ns: 'catalog' }), onClick: goToAllProducts }}
                  />
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
                    <ProductGrid products={viewState.products} onAddToCart={handleAddToCart} />
                    <CatalogPagination page={page} totalPages={totalPages} onPageChange={handlePageChange} />
                  </>
                )}
              </section>

              {/*
                🔴 §6b — the fallback lives OUTSIDE the results section, as
                its own separately named region with its own heading. Never
                merged into the grid above, never counted as results, and
                rendered only for `filtered-empty`, which is the only state
                that can carry fallback metadata.
              */}
              {viewState.state === 'filtered-empty' && viewState.fallback && (
                <CatalogFallbackSection fallback={viewState.fallback} onAddToCart={handleAddToCart} />
              )}
            </>
          )}
        </div>
      </div>

      {/*
        The mobile filter surface — §10: "reuse the existing `Drawer`",
        production-proven by `CartDrawer` (Slice 8, DEC-047). Focus trap,
        Escape, return focus, `inert`, scrim and z-index all come from
        Modal/Drawer unchanged; nothing is reimplemented here and no new
        sheet/accordion pattern is introduced. It renders the SAME
        `CatalogFilterPanel` the desktop rail renders.
      */}
      <Drawer
        open={filtersOpen}
        onClose={closeFilters}
        title={t('filters.title', { ns: 'catalog' })}
        closeLabel={t('filters.closeLabel', { ns: 'catalog' })}
      >
        <div className="flex flex-col gap-6">
          {filterPanel}
          <Button type="button" variant="primary" fullWidth onClick={closeFilters}>
            {t('filters.done', { ns: 'catalog' })}
          </Button>
        </div>
      </Drawer>

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
