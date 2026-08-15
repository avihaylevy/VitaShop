import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import type { ProductCardModel } from '../../types/product'
import { getStockState } from '../../lib/stockState'
import { getCategoryTone } from '../../lib/categoryTone'
import { useFavourites } from '../../state/FavouritesContext'
import { ProductImage } from './ProductImage'
import { PriceBlock } from './PriceBlock'
import { StockState } from './StockState'
import { QuantityStepper } from './QuantityStepper'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { Surface } from '../ui/Surface'
import { HeartIcon } from '../icons'
import { FOCUS_RING } from '../ui/focusRing'

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
 * ⚠️ THE ARIA SHAPE SINCE ISSUE-115 + ISSUE-118: every card carries ONE
 * accessible link (the name) and the FAVOURITE button; a shopping card adds
 * the quantity stepper's two buttons and the add-to-cart button (1 link +
 * 4 buttons), a navigational card stays at 1 link + 1 button. Stated here
 * rather than discovered in a snapshot — ProductGrid.action.test.tsx counts
 * exactly these.
 */
type CardAction =
  | { onAddToCart: (slug: string, quantity: number) => void; navigational?: never }
  | { navigational: true; onAddToCart?: never }

type ProductCardProps = ProductCardModel &
  CardAction & {
    /** Defaults to h3 — caller raises it when the card sits directly under an h2 grid heading. */
    headingLevel?: 'h2' | 'h3' | 'h4'
    /** Defaults to true — unchanged from the Checkpoint B contract. ProductGrid passes this through. */
    showCategoryEyebrow?: boolean
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
  dosageForm,
  packageQuantity,
  imageFile,
  onAddToCart,
  headingLevel = 'h3',
  showCategoryEyebrow = true,
}: ProductCardProps) {
  const { t, i18n } = useTranslation('catalog')
  const Heading = headingLevel
  const categoryLabel = i18n.language === 'he' ? categoryNameHe : categoryName
  /*
   * ISSUE-115 / REQ-F-003 — "add to favourites from the product card". The
   * heart reads/writes through FavouritesContext (server-confirmed, never
   * optimistic); A10: a GUEST pressing it is sent to /login — the action is
   * gated, the catalogue stays open. `aria-pressed` carries the state, the
   * label says the ACTION, and HeartIcon's fill mirrors it visually.
   */
  const { isFavourite, toggle } = useFavourites()
  const navigate = useNavigate()
  const favourited = isFavourite(slug)
  const [quantity, setQuantity] = useState(1)
  // Slice 7: the only reason add-to-cart is ever disabled is real stock.
  // The Slice 6 `addToCartUnavailableId` boundary — which force-disabled
  // every button while the cart did not exist — is gone.
  const isOut = getStockState(stockQuantity, lowStockThreshold) === 'out'
  // DESIGN_SYSTEM.md §1: tone binds to Category (via categoryNameHe, regardless
  // of display language), carried alongside — never instead of — the visible
  // category text below.
  const categoryTone = getCategoryTone(categoryNameHe)

  return (
    <Surface
      as="article"
      variant="section"
      bordered
      // DESIGN_SYSTEM.md §3: card hover is translateY(-4px) scale(1.012),
      // 200ms, transform only — gated by motion-safe so the transform
      // disappears entirely under prefers-reduced-motion, leaving only the
      // (non-motion) shadow. hover:z-10 keeps the raised card from being
      // clipped by neighbouring grid cells; it never fights the app's
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
      className="group relative flex flex-col gap-3 p-4 transition-[box-shadow,border-color] duration-200 ease-standard hover:z-10 hover:shadow-[var(--shadow-card-hover)] motion-safe:transition-transform motion-safe:hover:-translate-y-1 motion-safe:hover:scale-[1.012] focus-within:border-brand-teal"
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
      {/* `block` so the inline anchor adds no descender gap under the well. */}
      <Link to={`/product/${slug}`} tabIndex={-1} aria-hidden="true" className="block">
        <ProductImage imageFile={imageFile} alt="" />
      </Link>

      {/* A SIBLING positioned over the image corner — never nested inside
          the aria-hidden image link (a focusable child would break it). */}
      <IconButton
        icon={<HeartIcon filled={favourited} />}
        aria-pressed={favourited}
        aria-label={favourited ? t('favourite.remove') : t('favourite.add')}
        variant="ghost"
        onClick={() => {
          void toggle(slug).then((result) => {
            if (result === 'auth-required') navigate('/login')
          })
        }}
        className="absolute top-6 end-6 z-10 rounded-round border border-border-hairline bg-well/90"
      />

      {showCategoryEyebrow && <p className="text-xs text-text-muted">{categoryLabel}</p>}

      {/*
       * 🔴 ISSUE-047, cause 2 of 2. `line-clamp-2` + `min-h-10` reserves
       * EXACTLY two lines (line-height 20px x 2 = 40px) whether the name wraps
       * or not. Without the reservation a two-line name made its card 20px
       * taller than its neighbours — measured as 406px against 386px.
       *
       * ⚠️ The clamp and the min-height are one fix, not two: clamping alone
       * caps the tall cards, and reserving alone leaves short names short.
       * Both are needed for every card to land on one height.
       */}
      <Heading className="line-clamp-2 min-h-10 text-sm font-semibold text-text-ink">
        <Link to={`/product/${slug}`} className={`${FOCUS_RING} rounded-compact`}>
          {name}
        </Link>
      </Heading>

      {brandName && <p className="text-xs text-text-muted">{brandName}</p>}
      {(dosageForm || packageQuantity) && (
        <p className="text-xs text-text-muted">
          {packageQuantity && dosageForm
            ? `${packageQuantity} ${dosageForm}`
            : (packageQuantity ?? dosageForm)}
        </p>
      )}

      <PriceBlock price={price} />
      <StockState stockQuantity={stockQuantity} lowStockThreshold={lowStockThreshold} />

      {onAddToCart && (
        /* ISSUE-118 — how many, chosen at the card. The stepper resets to 1
           after a confirmed hand-off to the cart flow. */
        // flex-wrap: in the 420px two-column grid the pair is wider than
        // the card, and the button (fullWidth) drops to its own line
        // instead of pushing the page sideways.
        <div className="flex flex-wrap items-center gap-2">
          <QuantityStepper value={quantity} onChange={setQuantity} className="shrink-0" />
          <Button
            variant="primary"
            fullWidth
            disabled={isOut}
            onClick={() => {
              onAddToCart(slug, quantity)
              setQuantity(1)
            }}
            {...{ [ADD_TO_CART_ATTRIBUTE]: slug }}
          >
            {t('addToCart')}
          </Button>
        </div>
      )}
    </Surface>
  )
}
