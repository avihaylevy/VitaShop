import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ProductCardModel } from '../../types/product'
import { getStockState } from '../../lib/stockState'
import { getCategoryTone, getCategoryToneStrong } from '../../lib/categoryTone'
import { ProductImage } from './ProductImage'
import { PriceBlock } from './PriceBlock'
import { StockState } from './StockState'
import { CardCartStepper } from './CardCartStepper'
import { FavouriteButton } from './FavouriteButton'
import type { FavouriteToggleResult } from '../../state/FavouritesContext'
import { useOptionalCartLine } from '../../state/CartContext'
import { Surface } from '../ui/Surface'
import { VisuallyHidden } from '../ui/VisuallyHidden'
import { FOCUS_RING } from '../ui/focusRing'
import { ARIA_DISABLED_CLASS } from '../ui/Button'

/**
 * The "wait for a possibly-void confirmation, then react" shape shared by
 * the pill's add-confirmation and both stepper settle branches below —
 * factored out so the instanceof-Promise tolerance (stubbed/mocked
 * mutations in tests may return synchronously) lives in one place instead
 * of being copied per call site (review of this diff: it had been).
 */
function whenSettled<T>(value: void | Promise<T>, onSettled: (result: T) => void): void {
  if (value instanceof Promise) {
    void value.then(onSettled)
  }
}

/**
 * 🔴 A DISCRIMINATED UNION, NOT AN OPTIONAL PROP — and the difference is a
 * compile-time guard this project nearly lost.
 *
 * Checkpoint F4 first made `onAddToCart` simply optional so the home page's
 * navigational shelf could omit it. That erased the ONLY enforcement that the
 * catalogue passes one: a later refactor dropping `onAddToCart` from
 * `CatalogPage` or `CatalogFallbackSection` would have type-checked, kept all
 * 822 tests green, and silently removed every Add to cart button in the shop.
 * A grep of the suite found no test asserting that button exists — the type
 * WAS the test.
 *
 * A caller must now say which kind of card it wants, and cannot omit the
 * handler by accident:
 *
 *   <ProductCard {...model} onAddToCart={fn} />   the catalogue
 *   <ProductCard {...model} navigational />       the home-page shelf
 *
 * ⚠️ THE ARIA SHAPE SINCE DEC-110 (UI refresh, area 1): every card carries
 * ONE accessible link (the name) and the FAVOURITE button. A shopping card
 * whose product is NOT in the cart adds ONE add button (1 link + 2
 * buttons); once the product IS in the cart the add button's footprint
 * shows the cart-line stepper instead (1 link + 3 buttons: heart, −, +).
 * A navigational card stays at 1 link + 1 button. Stated here rather than
 * discovered in a snapshot — ProductGrid.action.test.tsx counts exactly
 * these. (The pre-add quantity chooser of ISSUE-118 now lives only on the
 * detail page; the card adds 1 and the stepper edits the LINE.)
 */
type CardAction =
  // The handler may return a confirmation promise (true = the server took
  // the add) — the card resets its stepper only on that answer, never
  // optimistically. A void-returning handler keeps its old meaning.
  | { onAddToCart: (slug: string, quantity: number) => void | Promise<boolean>; navigational?: never }
  | { navigational: true; onAddToCart?: never }

type ProductCardProps = ProductCardModel &
  CardAction & {
    /** Defaults to h3 — caller raises it when the card sits directly under an h2 grid heading. */
    headingLevel?: 'h2' | 'h3' | 'h4'
    /** Defaults to true — unchanged from the Checkpoint B contract. ProductGrid passes this through. */
    showCategoryEyebrow?: boolean
    /** The lecturer-fixes list (2026-08-23): the home shelf hides the
     *  quantity/dosage-form line; the catalogue keeps it. Default true. */
    showPackageMeta?: boolean
    /**
     * The heart's settled-toggle event, forwarded from FavouriteButton. The
     * favourites page uses it to announce a removal and repair focus when
     * the confirmed removal derives this very card out of view.
     */
    onFavouriteToggled?: (result: FavouriteToggleResult, slug: string) => void
  }

/**
 * Slug-bound hook onto the native add-to-cart button — Slice 8
 * (technical/SLICE_8_PLAN.md §3.1, DEC-047-A). Lets `CatalogPage` resolve
 * the EXACT control that triggered a successful add, scoped to its own grid
 * container, without a document-wide query or a translated-text selector.
 *
 * Reaches the native `<button>` through `Button`'s existing `{...rest}`
 * prop spread (components/ui/Button.tsx) — no `Button` change, no
 * `forwardRef`. Same technique already shipped for `CartItemRow`'s
 * `CART_ROW_ATTRIBUTE`.
 */
export const ADD_TO_CART_ATTRIBUTE = 'data-add-to-cart'

/**
 * DESIGN_SYSTEM.md §6 / UI_IMPLEMENTATION_PLAN.md §14: article container, one
 * link (the product name), no nested interactive elements. Add-to-cart is a
 * sibling button, not nested inside the link.
 */
export function ProductCard({
  slug,
  name,
  categoryNameHe,
  categoryName,
  price,
  stockQuantity,
  lowStockThreshold,
  brandName,
  description,
  dosageForm,
  packageQuantity,
  packageUnit,
  imageFile,
  onAddToCart,
  headingLevel = 'h3',
  showCategoryEyebrow = true,
  showPackageMeta = true,
  onFavouriteToggled,
}: ProductCardProps) {
  const { t, i18n } = useTranslation('catalog')
  const Heading = headingLevel
  const categoryLabel = i18n.language === 'he' ? categoryNameHe : categoryName
  // Slice 7: the only reason add-to-cart is ever disabled is real stock.
  // The Slice 6 `addToCartUnavailableId` boundary — which force-disabled
  // every button while the cart did not exist — is gone.
  const isOut = getStockState(stockQuantity, lowStockThreshold) === 'out'
  // DESIGN_SYSTEM.md §1: tone binds to Category (via categoryNameHe, regardless
  // of display language), carried alongside — never instead of — the visible
  // category text below.
  const categoryTone = getCategoryTone(categoryNameHe)

  /**
   * DEC-110 (area 1) — which control the bottom row shows is DERIVED from
   * the cart the server last returned (null-tolerant: the ProductGrid
   * suites and the dev showcase render without a CartProvider and get the
   * pill). A drawer edit, a cart-page removal or a sign-out cart swap all
   * flip the control because they change the cart itself.
   */
  const cardCart = useOptionalCartLine(slug)
  const line = onAddToCart ? (cardCart?.line ?? null) : null

  /**
   * 🔴 The unmount-takes-focus family, both directions. Pressing the pill
   * replaces it with the stepper; pressing − at quantity 1 replaces the
   * stepper with the pill. Either way the pressed control unmounts, so the
   * hand-off is DELIBERATE: the intent is recorded at the press, and the
   * effect moves focus once the cart change actually lands (and only
   * then — a failed mutation clears the intent and focus stays put).
   */
  const [focusIntent, setFocusIntent] = useState<'stepper' | 'pill' | null>(null)
  const increaseRef = useRef<HTMLButtonElement>(null)
  const pillRef = useRef<HTMLButtonElement>(null)

  /**
   * The DECREASE path's audible half. Adds are announced by useAddToCart's
   * cart-wide region; a − press when the drawer is closed had no voice at
   * all. Card-local polite region, ALWAYS MOUNTED (a region born with its
   * message is not announced — the M-008 scar), populated only from a
   * settled server response.
   */
  const [decreaseAnnouncement, setDecreaseAnnouncement] = useState('')
  useEffect(() => {
    if (focusIntent === 'stepper' && line) {
      increaseRef.current?.focus()
      setFocusIntent(null)
    } else if (focusIntent === 'pill' && !line) {
      pillRef.current?.focus()
      setFocusIntent(null)
    }
  }, [focusIntent, line])

  return (
    <Surface
      as="article"
      variant="section"
      bordered
      // DEC-110 (area 1, amending §3): the card itself no longer
      // translates/scales on hover — the approved previews put the hover
      // motion on the PRODUCT IMAGE alone (ProductImage's card frame,
      // 1.06 zoom, motion-safe). The card keeps the non-motion cues:
      // shadow and border colour. hover:z-10 stays so the shadow paints
      // over neighbouring cells; it never fights the app's
      // dropdown/overlay/modal z-scale (40/50/60), which sits far above it.
      // The shadow itself is --shadow-card-hover (DEC-041) — a plain
      // :root custom property (index.css), not @theme, since it is only
      // ever reached via this arbitrary-value reference, never through a
      // generated Tailwind utility class name.
      // DESIGN_SYSTEM.md §4: focus-within is a SEPARATE, supporting cue — a
      // 1px teal border (existing border-brand-teal token/utility, same
      // width Surface's `bordered` prop already reserves) — never the only
      // indicator, since the link/button keep their own FOCUS_RING outline.
      // A colour-only change, so it survives prefers-reduced-motion.
      // h-full: the card fills its grid cell so the mt-auto commerce block
      // pins to one shared bottom edge across a row (ISSUE-127b).
      // DEC-106 density pass: p-4/gap-3 → p-3/gap-2.5 (the user: cards
      // read tall). The heart pins to top-5/end-5 to track the padding.
      // p-2.5/gap-1.5 — the pass-131 tightening: the image box grew to a
      // square, the chrome around it shrank ("image bigger, card smaller").
      className="group relative flex h-full flex-col gap-1.5 p-2 transition-[box-shadow,border-color] duration-200 ease-standard hover:z-10 hover:shadow-[var(--shadow-card-hover)] focus-within:border-brand-teal"
      style={{ backgroundColor: categoryTone }}
    >
      {/*
       * ISSUE-109 — the image is a SECOND CLICK SURFACE for the same
       * destination, not a second link: tabIndex={-1} + aria-hidden removes
       * it from the tab order and the accessibility tree, so the card's ARIA
       * contract stays "one link + one button" (the name link below is the
       * one accessible link, and ProductGrid.action.test.tsx counts it).
       * The img alt is emptied here — the name link already carries the text.
       */}
      {/* `block` so the inline anchor adds no descender gap under the well.
          DEC-110: the 'card' frame drops the white well — the cutout product
          sits directly on the card's tone. Out of stock dims the image (the
          StockState line below is the accessible signal; opacity is the
          glanceable one). */}
      <Link
        to={`/product/${slug}`}
        tabIndex={-1}
        aria-hidden="true"
        className={`block ${isOut ? 'opacity-45' : ''}`}
      >
        <ProductImage imageFile={imageFile} alt="" frame="card" />
      </Link>

      {/* A SIBLING positioned over the image corner — never nested inside
          the aria-hidden image link (a focusable child would break it).
          ISSUE-115 / REQ-F-003 — the shared heart (FavouriteButton owns the
          A10 guest gate and the failure announcement). */}
      <FavouriteButton
        slug={slug}
        onToggled={onFavouriteToggled && ((result) => onFavouriteToggled(result, slug))}
        className="absolute top-3.5 end-3.5 z-10 rounded-round border border-border-hairline bg-well/90"
      />

      {/* §2 --text-label, DEC-106: the eyebrow became a small CHIP in the
          category's STRONG tone — the same hue family as the card surface,
          one level up, tying card to shelf chip. Ink text (measured ≥9.1
          on every strong tone); the tone is still never the sole signal —
          the label text IS the category name. */}
      {showCategoryEyebrow && (
        <p
          style={{ backgroundColor: getCategoryToneStrong(categoryNameHe) }}
          className="w-fit rounded-round px-2.5 py-0.5 text-xs font-bold tracking-[0.07em] text-text-ink"
        >
          {categoryLabel}
        </p>
      )}

      {/*
       * ISSUE-127b/c + DEC-110 (the user's 3B pick): the identity block is
       * BRAND ABOVE NAME — a small tracked muted brand line, then the name
       * one step bolder (16/700) so the product leads the block. Standard
       * commerce hierarchy: the eye reads brand, then product.
       *
       * 🔴 ISSUE-047, cause 2 of 2, recomputed for 16px: `line-clamp-2` +
       * `min-h-12` reserves EXACTLY two lines (leading-6 = 24px x 2 = 48px)
       * whether the name wraps or not. The clamp and the min-height are one
       * fix, not two — both are needed for every card to land on one height.
       */}
      <div className="flex flex-col gap-0.5">
        {brandName && (
          <p className="text-[11px] font-semibold tracking-[0.08em] text-text-muted">{brandName}</p>
        )}
        <Heading className="line-clamp-2 min-h-12 text-base font-bold leading-6 text-text-ink">
          <Link to={`/product/${slug}`} className={`${FOCUS_RING} rounded-compact`}>
            {name}
          </Link>
        </Heading>
      </div>

      {/* Pass 131 (the user's reference card): the quantity/form line left
          the card — the DESCRIPTION TEASER took its slot (two lines,
          clamped, reserved so rows align; the full text lives on the
          detail page). The quantity still renders on the detail page and
          the cart row. showPackageMeta is kept in the props contract but
          no longer renders here. */}
      {description && (
        <p className="line-clamp-2 min-h-[2.6em] text-[13px] leading-[1.3] text-text-muted">
          {description}
        </p>
      )}

      {/* Pass 131 round 3 (the user): the DOSAGE line returned under the
          teaser — quantity + unit/form ("60 טבליות" / "250 מ״ל"). Same
          rules as before its brief removal: volume forms pair the number
          with the UNIT, countable forms with the form label; the numeral
          is LTR-isolated inside the RTL run. Home shelf still hides it
          via showPackageMeta. */}
      {showPackageMeta && (dosageForm || packageQuantity) && (
        <p className="text-xs text-text-muted">
          {packageQuantity && dosageForm ? (
            <>
              <span dir="ltr" style={{ unicodeBidi: 'isolate' }}>
                {packageQuantity}
              </span>{' '}
              {packageUnit ?? dosageForm}
            </>
          ) : (
            (packageQuantity ?? dosageForm)
          )}
        </p>
      )}

      <StockState stockQuantity={stockQuantity} lowStockThreshold={lowStockThreshold} />

      {/*
       * DEC-110 (area 1) — the COMMERCE row: ONE row pinned to the card's
       * bottom edge (mt-auto) so price rows align across the grid. Price at
       * inline-start, the action at inline-end (the hairline separator and
       * the stepper-plus-full-width-button stack are gone — the pre-add
       * quantity chooser lives on the detail page now).
       *
       * The action is the user's 3B pick: a white floating pill (soft
       * shadow, ink text) reading הוסף; once the product is in the cart the
       * SAME footprint shows the cart-line stepper. Out of stock keeps the
       * pill mounted but inert (aria-disabled — never `disabled`, the
       * ISSUE-098 family) on the sunken surface.
       */}
      {onAddToCart ? (
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1.5">
          <PriceBlock price={price} size="price" />
          {line ? (
            <CardCartStepper
              ref={increaseRef}
              quantity={line.quantity}
              productName={name}
              pending={cardCart?.pending ?? false}
              isOut={isOut}
              onIncrease={() => {
                // 🔴 + goes through the SAME add choreography as the pill
                // (onAddToCart → useAddToCart), never a raw PATCH: the
                // quiet-add rules, the cart-wide announcement, and the
                // clamped-add-reopens-the-drawer behaviour all live there,
                // and a second path would fork them (the exact defect
                // ISSUE-105 removed).
                void onAddToCart(slug, 1)
              }}
              onDecrease={() => {
                if (line.quantity <= 1) {
                  // Removing the last unit unmounts the stepper — record the
                  // hand-off intent first; the effect above moves focus to
                  // the pill only when the removal actually lands.
                  setFocusIntent('pill')
                  whenSettled(cardCart?.removeLine(line.id, name), (result) => {
                    if (result === null) setFocusIntent(null)
                    else setDecreaseAnnouncement(t('card.removedFromCart', { name }))
                  })
                } else {
                  whenSettled(cardCart?.setLineQuantity(line.id, name, line.quantity - 1), (result) => {
                    if (result === null) return
                    // The server's settled quantity, not `line.quantity - 1`
                    // — the client is not a source of truth (§3.4), and a
                    // concurrent clamp/edit can settle on a different number.
                    const settled = result.cart.items.find((item) => item.id === line.id)?.quantity ?? 0
                    setDecreaseAnnouncement(
                      // 'quantity', not 'count' — count would engage
                      // i18next's plural-suffix lookup, and these keys
                      // are deliberately singular-form.
                      t('card.quantityInCart', { quantity: settled }),
                    )
                  })
                }
              }}
            />
          ) : (
            <button
              ref={pillRef}
              type="button"
              aria-disabled={isOut || undefined}
              onClick={() => {
                if (isOut) return
                setFocusIntent('stepper')
                whenSettled(onAddToCart(slug, 1), (taken) => {
                  if (!taken) setFocusIntent(null)
                })
              }}
              {...{ [ADD_TO_CART_ATTRIBUTE]: slug }}
              className={`${FOCUS_RING} ${ARIA_DISABLED_CLASS} inline-flex h-11 items-center justify-center rounded-round bg-well px-5 text-sm font-semibold text-text-ink shadow-[0_2px_8px_rgb(31_37_46_/_0.16)] transition-[box-shadow,background-color] duration-150 ease-standard aria-disabled:cursor-not-allowed hover:shadow-[0_4px_14px_rgb(31_37_46_/_0.22)] motion-safe:active:scale-[0.96] md:h-9`}
            >
              {t('card.add')}
              {/* The visible label is short; the hidden suffix completes it
                  into the full per-product sentence ("הוסף" + "לעגלה, X" /
                  "Add" + "to cart, X"), so cards stay distinguishable to a
                  screen reader and the visible label is part of the
                  accessible name. The explicit {' '} is load-bearing: name
                  computation joins element boundaries WITHOUT whitespace. */}
              {' '}
              <VisuallyHidden>{t('card.addSrSuffix', { name })}</VisuallyHidden>
            </button>
          )}
        </div>
      ) : (
        <div className="mt-auto pt-1.5">
          <PriceBlock price={price} size="price" />
        </div>
      )}

      {/* The decrease-path live region — mounted from first render (never
          born with its message), populated only from settled responses. */}
      {onAddToCart && (
        <div aria-live="polite" className="sr-only">
          {decreaseAnnouncement}
        </div>
      )}
    </Surface>
  )
}
