import type { ReactNode } from 'react'
import type { ProductCardModel } from '../../types/product'
import type { FavouriteToggleResult } from '../../state/FavouritesContext'
import { ProductCard } from './ProductCard'

/**
 * 🔴 THE SAME DISCRIMINATED UNION `ProductCard` USES, passed straight through.
 * A grid that made the handler merely optional would re-open the hole the
 * card just closed: the catalogue could lose its Add to cart buttons with a
 * green type-check and a green suite.
 */
type GridAction =
  // Two-arg + optional confirmation promise — the card resets its stepper on
  // the confirmed answer. Narrower handlers ((slug) => void) stay assignable.
  | { onAddToCart: (slug: string, quantity: number) => void | Promise<boolean>; navigational?: never }
  | { navigational: true; onAddToCart?: never }

type ProductGridProps = GridAction & {
  products: readonly ProductCardModel[]
  showCategoryEyebrow?: boolean
  showPackageMeta?: boolean
  emptyState?: ReactNode
  /** Forwarded to every card's heart — see ProductCard.onFavouriteToggled. */
  onFavouriteToggled?: (result: FavouriteToggleResult, slug: string) => void
  /**
   * Area 6 — CAPPED columns (favourites): auto-fill of card-sized tracks
   * (--card-track-min/max, index.css) packed to the inline-start, so one
   * favourite renders one card-sized card instead of ballooning across a
   * percentage column. The catalog keeps the default percentage grid:
   * its pages are full, and its column counts are pinned by the
   * responsive suite.
   */
  capped?: boolean
}

/**
 * Both templates exported so the LOADING skeleton can render the SAME
 * grid as the ready state (the skeleton/grid parity contract
 * CatalogPage.responsive.test.tsx pins for the catalog — favourites gets
 * the same guarantee by construction, not by a second copy).
 *
 * The capped min track is wrapped in min(..., 100%): auto-fill always
 * emits one track, and a fixed px floor inside a padded container
 * narrower than the floor (a 320px window with a classic scrollbar is
 * 249px of content) would otherwise overflow horizontally.
 */
export const GRID_CLASS = {
  fluid: 'grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 md:gap-4',
  capped:
    // justify-start = inline-start: the packed row sits right in RTL,
    // left in LTR, from the one logical rule (no direction branch).
    'grid grid-cols-[repeat(auto-fill,minmax(min(var(--card-track-min),100%),var(--card-track-max)))] justify-start gap-3 md:gap-4',
} as const

/**
 * Checkpoint C — presentation only, no fetching or data transformation.
 * `ul`/`li`, keyed by slug. The grid template and gap are the only
 * responsive behavior here; RTL/LTR share the same grid (CSS grid
 * auto-placement already follows document direction, no separate rule
 * needed). TWO templates since area 6 — see GRID_CLASS above.
 *
 * Default (fluid) breakpoints: 1 col below 420px, 2 from 420px, 3 from
 * 1024px (Tailwind's own `lg`), 4 from 1280px (Tailwind's own `xl`) —
 * 420px has no built-in Tailwind screen, so it's the one arbitrary
 * `min-[420px]:` variant. The capped template has no breakpoints: the
 * track pair IS its responsive rule.
 */
export function ProductGrid({
  products,
  showCategoryEyebrow,
  showPackageMeta,
  emptyState,
  onFavouriteToggled,
  capped = false,
  ...action
}: ProductGridProps) {
  if (products.length === 0) {
    return emptyState ?? null
  }

  return (
    <ul className={capped ? GRID_CLASS.capped : GRID_CLASS.fluid}>
      {products.map((product) => (
        <li key={product.slug}>
          <ProductCard
            {...product}
            {...(action.navigational ? { navigational: true as const } : { onAddToCart: action.onAddToCart! })}
            showCategoryEyebrow={showCategoryEyebrow}
            showPackageMeta={showPackageMeta}
            onFavouriteToggled={onFavouriteToggled}
          />
        </li>
      ))}
    </ul>
  )
}
