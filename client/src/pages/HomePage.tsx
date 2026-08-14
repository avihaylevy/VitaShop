import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCatalogCategories } from '../hooks/useCatalogCategories'
import { useNewArrivals } from '../hooks/useNewArrivals'
import { CategoryShelf } from '../components/catalog'
import { ProductGrid } from '../components/catalog/ProductGrid'
import { CartDrawer } from '../components/cart/CartDrawer'
import { useAddToCart } from '../hooks/useAddToCart'
import { Button } from '../components/ui/Button'
import { FOCUS_RING } from '../components/ui/focusRing'

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
  const { handleAddToCart, drawerSlug, closeDrawer, returnFocusRef, gridRef, announced } =
    useAddToCart()

  const announcedProduct =
    announced && state.status === 'ready'
      ? state.products.find((product) => product.slug === announced.slug)
      : undefined
  const addedToCartMessage =
    announced && announcedProduct
      ? t('addedToCart', { product: announcedProduct.name, count: announced.count })
      : ''

  /**
   * 🔴 ISSUE-098 — WHAT PRESSING RETRY DID TO THE USER, which the suite could
   * not see because it only ever asserted that the products came back.
   *
   * Measured in Chromium during the Checkpoint F4 browser matrix: the button
   * exists only while the shelf is `failed`, so a successful retry UNMOUNTED
   * THE FOCUSED BUTTON and `document.activeElement` became `<body>` — the next
   * Tab restarted at the top of the page. The live region was empty on
   * success, so nothing was announced either. A keyboard user was moved and
   * told nothing; a screen-reader user was told nothing at all.
   *
   * Both halves are answered here, and neither is the message-slot fix that
   * shipped in `4fe9ae6` — that one kept LOADING and FAILURE sharing one live
   * region, and is still doing its job above.
   */
  const [retryPending, setRetryPending] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const sectionRef = useRef<HTMLElement>(null)

  /*
   * 🔴 `useLayoutEffect`, NOT `useEffect`. In the commit where the shelf turns
   * `ready`, `retryPending` is still true, so that render still contains the
   * Retry button — next to the loaded products. A passive effect is not
   * guaranteed to run before paint, so the button can be SEEN for a frame, and
   * a fast Tab in that window lands on a control that is about to unmount.
   * This also puts the focus move before paint rather than after it.
   */
  useLayoutEffect(() => {
    if (!retryPending) return
    // Still in flight — the button is deliberately still mounted, holding focus.
    if (state.status === 'loading') return
    setRetryPending(false)
    /*
     * 🔴 ONLY AFTER A RETRY, never on an ordinary load. A shelf that grabbed
     * focus every time the page opened would be worse than the defect it
     * fixes, and `THE CONTROL — an ordinary load does NOT steal focus` is the
     * test that keeps it that way.
     *
     * On a repeated FAILURE nothing moves: the button never unmounted, so
     * focus is still on it and the live region says why.
     */
    if (state.status !== 'ready') return
    /*
     * 🔴 AND ONLY IF THE USER IS STILL HERE. A retry on a slow connection
     * leaves the user free to tab into the search box or scroll down to the
     * categories; yanking focus back seconds later — scrolling the page with
     * it — is WCAG 3.2.5 unexpected change of context, which is the same class
     * of defect as the one being fixed, just from the other side.
     *
     * Focus is moved only when it is still inside this section, which is where
     * pressing Retry left it.
     */
    if (!sectionRef.current?.contains(document.activeElement)) return
    headingRef.current?.focus()
  }, [retryPending, state.status])

  /*
   * ⚠️ `ready` ANNOUNCES THE COUNT, and that text is `sr-only`. The heading
   * already says what the shelf is and the cards are right there, so "4 new
   * products" on screen is noise — but with focus arriving at the heading and
   * nothing spoken, a screen-reader user has no way to know the retry worked.
   * Same node, same live region: only the text changes, which is what makes it
   * announce.
   *
   * ⚠️ IT ANNOUNCES ON EVERY SUCCESSFUL LOAD, NOT ONLY AFTER A RETRY, and that
   * is deliberate — the count is the shelf's outcome, not the retry's receipt.
   * The FOCUS move is gated on `retryPending`; this is not, and the difference
   * is intentional: moving focus unasked is an interruption, a polite live
   * region is not. A language toggle re-renders the same slot with the
   * translated sentence, so it announces again — the shelf saying what it now
   * says, in the language just chosen.
   *
   * 🔴 ZERO PRODUCTS SAYS THE EMPTY SENTENCE, VISIBLY, AND SAYS IT HERE — not
   * "0 new products", which asserts a result the situation does not have. It
   * moved out of `ProductGrid`'s `emptyState` because the first version of
   * this fix put it in BOTH and rendered the sentence twice, which a test
   * written for the empty branch caught. The empty message has to live in the
   * live region, or a retry that succeeds with nothing to show announces
   * nothing — the silence this whole issue is about.
   */
  const ready = state.status === 'ready'
  const empty = ready && state.products.length === 0
  const readyMessage = ready
    ? empty
      ? t('home.newArrivalsEmpty')
      : t('home.newArrivalsCount', { count: state.products.length })
    : ''

  return (
    <section ref={sectionRef} className="mt-10" aria-labelledby="new-arrivals-heading">
      <h2
        id="new-arrivals-heading"
        // 🔴 -1, not 0 — programmatically focusable for the retry landing,
        // and NOT inserted into everyone's tab order.
        tabIndex={-1}
        ref={headingRef}
        // 🔴 The shared ring, not the browser default. A focus landing that
        // draws its own outline gives the keyboard user who just pressed Retry
        // an indicator matching nothing else on the page — DESIGN_SYSTEM §4
        // makes the teal ring the one treatment, and `CheckoutPage` lands on
        // its own heading exactly this way.
        className={`${FOCUS_RING} rounded-card text-lg font-semibold text-text-ink`}
      >
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
      <p role="status" className={ready && !empty ? 'sr-only' : 'mt-4 text-sm text-text-muted'}>
        {state.status === 'loading' ? t('home.newArrivalsLoading') : ''}
        {state.status === 'failed' ? t('home.newArrivalsError') : ''}
        {readyMessage}
      </p>

      {/*
        🔴 THE BUTTON STAYS MOUNTED WHILE THE RETRY IS IN FLIGHT. Unmounting it
        mid-request is what dropped focus to <body> on the way to BOTH
        outcomes, not just the successful one.

        🔴 AND IT IS `aria-disabled`, NOT `disabled` — this is the second half
        of the same defect and it survived the first fix. A `disabled` button
        is not focusable, so the browser BLURS IT the moment the attribute
        appears: focus went straight back to <body> while the retry was still
        in flight. jsdom does not implement that blur, so the test asserting
        focus survives a repeated failure passed against code that fails in
        Chromium — measured, with the browser disagreeing with a green suite.

        `aria-disabled` announces the same thing and keeps focus, so the click
        handler has to enforce the no-op itself.

        ⚠️ AND IT HAS TO LOOK UNAVAILABLE TOO. `Button` carried its muted state
        entirely in `disabled:` variants, so an `aria-disabled` button kept full
        enabled styling — a screen reader called it unavailable while a mouse
        user saw a live-looking control that silently did nothing.

        🔴 THAT FIX LIVES IN `Button`, NOT HERE. Hand-rolled classes at this
        call site collided with the variant's own `bg-well` at equal
        specificity: measured in Chromium, the background stayed WHITE while
        the text and pointer-events changed — a half-applied state that the
        jsdom test could not see, because the class was present and only the
        cascade disagreed. `Button` now carries `aria-disabled:` variants.

        ⚠️ NO `aria-busy` — `Button` sets it from its own `loading` prop AFTER
        the spread, deliberately, so a caller cannot override it, and `loading`
        forces `disabled`, which is the defect above. The live region already
        says "Loading new products…", so the state is announced; changing a
        shared component's stated contract for a second signal is not worth it.
      */}
      {(state.status === 'failed' || retryPending) && (
        <Button
          variant="secondary"
          className="mt-3"
          aria-disabled={state.status === 'loading' || undefined}
          onClick={() => {
            if (state.status === 'loading') return
            setRetryPending(true)
            state.retry()
          }}
        >
          {t('home.retry')}
        </Button>
      )}

      {state.status === 'ready' && (
        <div ref={gridRef} className="mt-4">
          {/*
            🔴 THE CARDS ADD TO CART — ISSUE-105, and this REVERSES Checkpoint
            F4's navigational-only design at the user's instruction, after they
            checked the site and asked to buy from the home page.

            ⚠️ F4's REASON STILL HOLDS AND IS HONOURED DIFFERENTLY. It made the
            cards links so the drawer, the return-focus choreography and the
            announcement would not exist twice. Rather than copy them here, the
            whole choreography moved into `useAddToCart`, which the catalogue
            now uses too — so there is still exactly ONE implementation.

            ⚠️ NO `emptyState` — it lives in the live region above, so the empty
            sentence is ANNOUNCED and not merely drawn.
          */}
          <ProductGrid products={state.products} onAddToCart={handleAddToCart} />
        </div>
      )}

      {/*
        🔴 ONE DRAWER, rendered unconditionally, exactly as the catalogue does.
        Its own internal lifecycle governs everything else; this page owns only
        the slug, the return-focus owner and a stable close identity.
      */}
      <CartDrawer
        open={drawerSlug !== null}
        slug={drawerSlug}
        onClose={closeDrawer}
        returnFocusRef={returnFocusRef}
      />

      {/*
        Announced as slug + count so the sentence re-resolves through i18n on a
        language toggle instead of freezing in the language it was spoken in.
        The NAME comes from this page's own list — nothing is invented if the
        product is not in it.
      */}
      <p role="status" className="sr-only">
        {addedToCartMessage}
      </p>

    </section>
  )
}
