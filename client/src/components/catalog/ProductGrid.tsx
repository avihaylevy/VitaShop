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
}

/**
 * Checkpoint C — presentation only, no fetching or data transformation.
 * `ul`/`li`, keyed by slug. Column count and gap are the only responsive
 * behavior here; RTL/LTR share the same grid (CSS grid auto-placement
 * already follows document direction, no separate rule needed).
 *
 * Breakpoints: 1 col below 420px, 2 from 420px, 3 from 1024px (Tailwind's
 * own `lg`), 4 from 1280px (Tailwind's own `xl`) — 420px has no built-in
 * Tailwind screen, so it's the one arbitrary `min-[420px]:` variant.
 */
export function ProductGrid({
  products,
  showCategoryEyebrow,
  showPackageMeta,
  emptyState,
  onFavouriteToggled,
  ...action
}: ProductGridProps) {
  if (products.length === 0) {
    return emptyState ?? null
  }

  return (
    <ul className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 md:gap-4">
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
