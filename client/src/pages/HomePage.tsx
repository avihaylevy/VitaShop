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
import { TextLink } from '../components/ui/TextLink'
import { FOCUS_RING } from '../components/ui/focusRing'
import { getCategoryTone } from '../lib/categoryTone'
import type { SupportedLanguage } from '../i18n'
import heroPhotoHe from '../assets/brand/home-hero-he.webp'
import heroPhotoEn from '../assets/brand/home-hero-en.webp'

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
      {/* HERO — area 5, variant G's split form (2026-08-27, approved after
          variants A–F, then re-shaped twice on the user's live verdicts:
          "considerably smaller" → flat band; "don't crop the vitamins" →
          this split). The user's own generated "morning ritual" photo is
          shown WHOLE — natural aspect at band height, anchored inline-end,
          its wall-side edge mask-faded into the cream (.hero-photo-fade,
          index.css) — and the copy sits on the cream beside it. No scrim,
          no card.

          🔴 TWO MIRRORED PHOTOS, ONE LAYOUT. The pass-132 build died because
          one photo cannot serve both reading directions: each image keeps
          its tabletop scene at the band's inline-END for its own language,
          so the LANGUAGE picks the photo (the RegisterPage signup-he/-en
          precedent) and the layout itself never branches on direction. A
          replacement photo must come as the same mirrored pair.

          Below lg the band cannot hold the split, so the copy stacks ABOVE
          the photo on the section surface — same DOM nodes, the absolute
          positioning simply switches on at lg. lg:max-h caps the band on
          very wide screens, where the 3/0.9 ratio alone would grow it past
          the height the user asked to shrink. */}
      <section className="relative overflow-hidden rounded-card bg-surface-section lg:aspect-[3/0.9] lg:max-h-[420px]">
        <div className="relative z-10 flex flex-col items-start p-6 md:p-10 lg:absolute lg:top-[10%] lg:start-[4%] lg:p-0">
          {/* .heading-hero-band (index.css) owns the size AND the lg one-row
              nowrap rule. It cannot be a text-[...] override on
              .heading-page: heading classes are unlayered and beat every
              Tailwind utility — the first cut tried exactly that and the
              title silently rendered 32px while the class said 30 (measured
              live; the cascade family in browser-verification.md). */}
          <h1 className="heading-hero-band max-w-xl text-balance lg:max-w-none">
            {t('home.heroTitle', { ns: 'catalog' })}
          </h1>
          {/* Ink at 500 from lg — the approved split mock's look: the small
              one-row line beside the photo reads full-contrast; below lg it
              reverts to the ordinary muted-on-surface treatment. (Utility
              overriding utility — text-base — so unlike the h1 this clamp
              really applies; measured 14.08px at 1280.) */}
          <p className="mt-3 max-w-xl text-base text-text-muted lg:mt-2.5 lg:max-w-none lg:whitespace-nowrap lg:text-[clamp(13px,1.1vw,15px)] lg:font-medium lg:text-text-ink">
            {t('home.tagline', { ns: 'catalog' })}
          </p>
          {/* The club link sits CENTERED UNDER the CTA (approved G spec) —
              a column sized to its content so "centered" means centered on
              the button, not on the hero. w-fit + max-w-full, never w-max:
              the column must stay cappable so a longer label WRAPS instead
              of being clipped by the section's overflow-hidden. */}
          <div className="mt-6 flex w-fit max-w-full flex-col items-center gap-2.5">
            <LinkButton to="/catalog" size="hero">
              {t('home.browseCatalog', { ns: 'catalog' })}
            </LinkButton>
            <TextLink to="/account/club" tone="ink">
              {t('home.clubCta', { ns: 'catalog' })}
            </TextLink>
          </div>
        </div>
        {/* alt="" — the photo is scene-setting; every claim it makes is made
            by the real text above it. NEVER CROPPED (the user, this pass:
            "i dont like it that the image is cropped at the vitamins part"):
            below lg the box is aspect-[3/2] = the source's own ratio, and at
            lg the image keeps natural aspect at band height — object-CONTAIN
            (not cover) so even a future photo at a different ratio
            letterboxes instead of silently cropping the products away. */}
        <img
          src={language === 'he' ? heroPhotoHe : heroPhotoEn}
          alt=""
          className="hero-photo-fade aspect-[3/2] w-full object-contain lg:absolute lg:end-0 lg:top-0 lg:aspect-auto lg:h-full lg:w-auto"
        />
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
      <CartDrawer open={drawerOpen} onClose={closeDrawer} returnFocusRef={returnFocusRef} openedByAdd />
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
