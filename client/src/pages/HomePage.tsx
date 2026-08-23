import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useCatalogCategories } from '../hooks/useCatalogCategories'
import { useCatalogFacets } from '../hooks/useCatalogFacets'
import { useNewArrivals, type NewArrivalsState } from '../hooks/useNewArrivals'
import { buildShowcase, EMPTY_SHOWCASE } from '../lib/homeShowcase'
import { ProductGrid } from '../components/catalog/ProductGrid'
import { ProductImage } from '../components/catalog/ProductImage'
import { CartDrawer } from '../components/cart/CartDrawer'
import { AddedToCartToast } from '../components/cart/AddedToCartToast'
import { useAddToCart } from '../hooks/useAddToCart'
import { Button } from '../components/ui/Button'
import { LinkButton } from '../components/ui/LinkButton'
import { FOCUS_RING } from '../components/ui/focusRing'
import { getCategoryTone } from '../lib/categoryTone'
import { DocumentIcon, FilterIcon, GridIcon } from '../components/icons'
import type { SupportedLanguage } from '../i18n'

/**
 * Production home page — REBUILT at DEC-082 (the fifth list, items 6+7:
 * "the home screen doesn't look good; take inspiration from the reference
 * sites"). The reference SHAPE, none of their branding (DESIGN_BRIEF's
 * anti-copy rule): a hero band, category TILES with real product imagery,
 * shop-by-goal, the new-arrivals shelf, and a plain site-signature footer
 * (the thirteenth list replaced the stats strip with it).
 *
 * 🔴 DATA GATES NOTHING VISUAL: the showcase fetch (imagery) fails SILENTLY
 * to tone-only tiles; the categories fetch keeps its loud error+retry
 * because the tiles ARE the page's navigation.
 */
export function HomePage() {
  const { t, i18n } = useTranslation(['common', 'catalog'])
  const language = i18n.language as SupportedLanguage
  const { loading, categories, error, retry } = useCatalogCategories()
  // ONE facets call for the whole page (review of this diff: ShopByGoal had
  // its own copy of the hook, doubling GET /api/catalog/facets per visit).
  const { facets } = useCatalogFacets()
  const arrivals = useNewArrivals()
  // The visual layer is MINED from the page the shelf already fetched —
  // never a second identical /api/products request (review of this diff).
  const showcase = useMemo(
    () => (arrivals.status === 'ready' ? buildShowcase(arrivals.items) : EMPTY_SHOWCASE),
    [arrivals],
  )
  /*
   * The add machinery is the PAGE's (as on every other add surface), so the
   * drawer and the toast mount at page root — not inside the shelf section,
   * where the toast's region polluted the shelf's own "one message slot"
   * contract and its test selector (review of this diff).
   */
  const { handleAddToCart, drawerOpen, closeDrawer, returnFocusRef, gridRef, announced } =
    useAddToCart()
  const announcedProduct =
    announced && arrivals.status === 'ready'
      ? arrivals.products.find((product) => product.slug === announced.slug)
      : undefined
  const addedToCartMessage =
    announced && announcedProduct
      ? t('addedToCart', { ns: 'catalog', product: announcedProduct.name, count: announced.count })
      : ''

  return (
    <div className="px-7 py-8">
      {/* HERO — the "shelf scene" rework (user, 2026-08-23, after rejecting
          a baked-in-text banner): live i18n text + CTA + feature chips at
          the start, and the product composition upgraded from a flat row to
          products standing on drawn pedestals over soft NEUTRAL backdrop
          shapes. 🔴 The shapes are neutral warm tints on purpose — DEC-020
          constraint 6 binds the six category tones to Category, never to
          arbitrary products, so a tone behind a showcase bottle would be
          exactly the decoration constraint 3 forbids. The composition stays
          decorative and hidden from assistive tech (the CTA is the content). */}
      <section className="relative overflow-hidden rounded-card bg-surface-section p-6 md:p-10">
        {/* Backdrop — two soft shapes behind the composition end, echoing
            the pedestal-and-arc language of the user's reference banner. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute -top-24 end-6 size-96 rounded-full bg-surface-sunken" />
          <div className="absolute -bottom-28 end-72 size-72 rounded-full bg-well/90" />
        </div>
        <div className="relative grid items-center gap-8 md:grid-cols-[1fr_auto]">
          <div>
            {/* text-balance — ISSUE-151: the headline stranded one word on
                its own line; balanced wrapping equalizes the lines. */}
            {/* The lecturer-fixes list (2026-08-23): the headline must not
                break mid-sentence — one line from md up (nowrap; measured
                fitting un-clipped at 768–1440 with the composition beside
                it). Small screens still wrap, balanced. */}
            <h1 className="heading-page max-w-xl text-balance md:max-w-none md:whitespace-nowrap">{t('home.heroTitle', { ns: 'catalog' })}</h1>
            <p className="mt-3 max-w-xl text-base text-text-muted">
              {t('home.tagline', { ns: 'catalog' })}
            </p>
            <div className="mt-6">
              <LinkButton to="/catalog" size="hero">
                {t('home.browseCatalog', { ns: 'catalog' })}
              </LinkButton>
            </div>
            {/* Feature chips — the reference banner's value points as REAL
                translatable text. A list, because it is one: three parallel
                claims about the catalogue. Icons are decorative; the text is
                the content. border-card, not border-control: these chips are
                not interactive and must not dress like inputs. */}
            <ul className="mt-8 flex flex-wrap gap-2">
              {(
                [
                  ['featureInfo', DocumentIcon],
                  ['featureFiltering', FilterIcon],
                  ['featureCategories', GridIcon],
                ] as const
              ).map(([key, Icon]) => (
                <li
                  key={key}
                  className="flex items-center gap-2 rounded-card border border-border-card bg-well px-3 py-2 text-sm font-medium text-text-ink"
                >
                  <Icon aria-hidden="true" className="size-4 shrink-0 text-text-muted" />
                  {t(`home.${key}`, { ns: 'catalog' })}
                </li>
              ))}
            </ul>
          </div>
          {/* The shelf scene: staggered heights, each product on its own
              pedestal ellipse — items-END so bottles of different heights
              stand on one visual ground line, like goods on a shelf.
              dir="rtl" PINS the bottle order so both languages show the
              identical scene (user, 2026-08-23: the flipped arrangement
              read as a different composition). Legitimate under the
              mirrored-logical-layout rule for the same reason numbers get
              dir="ltr": this is decorative aria-hidden artwork with no
              reading order — only a composition — while the SECTION still
              mirrors sides with the reading direction as it should. */}
          {showcase.heroImages.length > 0 && (
            <ul aria-hidden="true" dir="rtl" className="hidden items-end gap-4 md:flex">
              {showcase.heroImages.map((file, index) => (
                <li
                  key={file}
                  className={`flex flex-col items-center motion-safe:animate-[hero-shelf-rise_.5s_ease-out_both] ${index === 1 ? 'w-56' : 'w-40'}`}
                  style={{ animationDelay: `${index * 90}ms` }}
                >
                  <ProductImage imageFile={file} alt="" />
                  {/* The pedestal — a flat stone ellipse under each product,
                      the banner's plinths redrawn in the system's neutrals.
                      A visible gap above it, or the white image well
                      swallows it entirely (measured at 1280). */}
                  <div className="mt-2 h-3 w-11/12 rounded-[50%] bg-surface-sunken shadow-[0_3px_6px_rgba(31,37,46,0.14)]" />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* CATEGORY TILES — the page's real navigation, now with imagery.
          Tone + TEXT name (the tone is never the sole signal — §1). */}
      <section aria-labelledby="home-categories-heading" className="mt-10">
        <h2 id="home-categories-heading" className="heading-section">
          {t('home.categoriesTitle', { ns: 'catalog' })}
        </h2>

        {loading && (
          <p className="mt-4 text-sm text-text-muted" role="status">
            {t('home.loading', { ns: 'catalog' })}
          </p>
        )}

        {!loading && error && (
          <div className="mt-4 flex flex-col items-start gap-3">
            <p className="text-sm text-state-error" role="alert">
              {t('home.error', { ns: 'catalog' })}
            </p>
            <Button variant="secondary" onClick={retry}>
              {t('home.retry', { ns: 'catalog' })}
            </Button>
          </div>
        )}

        {!loading && !error && categories.length > 0 && (
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {categories.map((category) => (
              <li key={category.slug}>
                <Link
                  to={`/catalog?category=${encodeURIComponent(category.slug)}`}
                  className={`${FOCUS_RING} group block rounded-card border border-border-card p-3 text-center transition-[box-shadow] duration-200 ease-standard hover:shadow-[var(--shadow-card-hover)]`}
                  style={{ backgroundColor: getCategoryTone(category.nameHe) }}
                >
                  {/* A SMALL image chip, never a full-width white well —
                      the tile's tone must stay visible around it (review of
                      this diff); a category with no page-1 image keeps the
                      reserved height so the row stays level. */}
                  <div className="mx-auto w-24" aria-hidden="true">
                    {/* The endpoint's per-category image first (it covers ALL
                        categories — the mined showcase covered only the ones
                        the newest page held); the mined image is the tolerant
                        fallback for an older server. */}
                    {(category.imageFile ?? showcase.categoryImages.get(category.slug)) ? (
                      <ProductImage
                        imageFile={(category.imageFile ?? showcase.categoryImages.get(category.slug))!}
                        alt=""
                      />
                    ) : (
                      <div className="aspect-[4/3] w-full" />
                    )}
                  </div>
                  <span className="mt-2 block text-sm font-semibold text-text-ink">
                    {language === 'he' ? category.nameHe : category.nameEn}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ShopByGoal healthGoals={facets.healthGoals} />

      <NewArrivals state={arrivals} onAddToCart={handleAddToCart} gridRef={gridRef} />

      {/* The thirteenth list (2026-08-21) replaced the stats strip (product/
          brand/category counts) with a plain site signature — "צריך להיות
          פשוט איזה חתימה של האתר למטה וזהו". */}
      <footer className="mt-12 border-t border-border-hairline py-6 text-center">
        <p className="text-sm font-semibold text-text-ink">
          {t('home.footerTagline', { ns: 'catalog' })}
        </p>
        <p className="mt-1 text-xs text-text-muted">
          {t('home.footerRights', { ns: 'catalog', year: new Date().getFullYear() })}
        </p>
      </footer>

      {/* One drawer + one toast, page-owned — the same contract as every
          other add surface. suppress: the drawer IS the confirmation on the
          adds that open it. */}
      <CartDrawer open={drawerOpen} onClose={closeDrawer} returnFocusRef={returnFocusRef} />
      <AddedToCartToast message={addedToCartMessage} announceKey={announced} suppress={drawerOpen} />
    </div>
  )
}

/**
 * ISSUE-105's content half, second piece — the DESIGN_BRIEF's answer 1 made
 * concrete: "the customer shops by 'what do I need this for', not by
 * compound name", so health goals get a browsing entry point on the home
 * page. Every chip is a real link into the catalogue's spec-required
 * healthGoal filter (REQ-F-011, ID-valued per §4b) — arriving there
 * auto-opens the filter rail on the applied state.
 *
 * 🔴 NOT a "popular products" shelf, deliberately: DEC-064 rejected that
 * label while the store has essentially no orders — popularity would be
 * tie-break order wearing a meaningful name. Goals are real data.
 *
 * A facets failure hides the section silently — it is a convenience on top
 * of the page's navigation, the same rule NewArrivals states.
 */
function ShopByGoal({ healthGoals }: { healthGoals: readonly { id: string; labelHe: string; labelEn: string }[] }) {
  const { t, i18n } = useTranslation('catalog')
  const language = i18n.language as SupportedLanguage

  if (healthGoals.length === 0) return null

  return (
    <section aria-labelledby="shop-by-goal-heading" className="mt-10">
      <h2 id="shop-by-goal-heading" className="heading-section">
        {t('home.shopByGoalTitle')}
      </h2>
      <ul className="mt-4 flex flex-wrap gap-2">
        {healthGoals.map((goal) => (
          <li key={goal.id}>
            {/* The lecturer-fixes list (2026-08-23, round 2 — with the
                screenshot): the goal chips were the "plain, boring buttons".
                Now round pills with a soft shadow that FILL brand-teal on
                hover and lift (motion-safe); reduced motion keeps the
                colour swap alone. Teal is the brand accent, not a category
                tone — the tone rule stays untouched. */}
            <Link
              to={`/catalog?healthGoal=${encodeURIComponent(goal.id)}`}
              className={`${FOCUS_RING} inline-flex min-h-11 items-center rounded-round border border-border-control bg-well px-5 text-sm font-medium text-text-ink shadow-[0_1px_4px_rgba(31,37,46,0.06)] transition-[background-color,border-color,color,box-shadow] duration-150 ease-standard hover:border-brand-teal hover:bg-brand-teal hover:text-white hover:shadow-[0_4px_12px_rgba(21,112,106,0.3)] motion-safe:transition-[background-color,border-color,color,box-shadow,transform] motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-0 motion-safe:active:scale-95 md:min-h-9 md:px-4`}
            >
              {language === 'he' ? goal.labelHe : goal.labelEn}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * DEC-064's shelf. Its own component so a failure here is visibly separate
 * from the categories above — they are fetched independently and fail
 * independently.
 */
function NewArrivals({
  state,
  onAddToCart,
  gridRef,
}: {
  state: NewArrivalsState & { retry: () => void }
  onAddToCart: (slug: string, quantity: number) => void | Promise<boolean>
  gridRef: React.RefObject<HTMLDivElement | null>
}) {
  const { t } = useTranslation('catalog')

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
        className={`${FOCUS_RING} rounded-card heading-section`}
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
          {/* showPackageMeta=false — the lecturer-fixes list: no quantity line on home. */}
          <ProductGrid products={state.products} onAddToCart={onAddToCart} showPackageMeta={false} />
        </div>
      )}

    </section>
  )
}
