import type { ReactNode } from 'react'
import type { ProductCardModel } from '../../types/product'
import { ProductCard } from './ProductCard'

type ProductGridProps = {
  products: readonly ProductCardModel[]
  onAddToCart: (slug: string) => void
  showCategoryEyebrow?: boolean
  emptyState?: ReactNode
  /** Additive, Slice 6 Checkpoint E — forwarded to every ProductCard unchanged. */
  addToCartUnavailableId?: string
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
export function ProductGrid({ products, onAddToCart, showCategoryEyebrow, emptyState, addToCartUnavailableId }: ProductGridProps) {
  if (products.length === 0) {
    return emptyState ?? null
  }

  return (
    <ul className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 md:gap-4">
      {products.map((product) => (
        <li key={product.slug}>
          <ProductCard
            {...product}
            onAddToCart={onAddToCart}
            showCategoryEyebrow={showCategoryEyebrow}
            addToCartUnavailableId={addToCartUnavailableId}
          />
        </li>
      ))}
    </ul>
  )
}
