import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ProductCardModel } from '../../types/product'
import { getStockState } from '../../lib/stockState'
import { getCategoryTone } from '../../lib/categoryTone'
import { ProductImage } from './ProductImage'
import { PriceBlock } from './PriceBlock'
import { StockState } from './StockState'
import { Button } from '../ui/Button'
import { Surface } from '../ui/Surface'
import { FOCUS_RING } from '../ui/focusRing'

type ProductCardProps = ProductCardModel & {
  onAddToCart: (slug: string) => void
  /** Defaults to h3 — caller raises it when the card sits directly under an h2 grid heading. */
  headingLevel?: 'h2' | 'h3' | 'h4'
  /** Defaults to true — unchanged from the Checkpoint B contract. ProductGrid passes this through. */
  showCategoryEyebrow?: boolean
}

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
      <ProductImage imageFile={imageFile} alt={name} />

      {showCategoryEyebrow && <p className="text-xs text-text-muted">{categoryLabel}</p>}

      <Heading className="text-sm font-semibold text-text-ink">
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

      <Button variant="primary" disabled={isOut} onClick={() => onAddToCart(slug)}>
        {t('addToCart')}
      </Button>
    </Surface>
  )
}
