import { useTranslation } from 'react-i18next'
import type { CartLineDisplay } from '../../lib/cartDisplay'
import { ProductImage } from '../catalog/ProductImage'
import { PriceBlock } from '../catalog/PriceBlock'

type CartDrawerLineProps = {
  line: CartLineDisplay
}

/**
 * DEC-047 D4 — a separate presentational line, NOT `CartItemRow` with a
 * variant. It carries no callback of any kind in its props; the absence is
 * the contract, not an omission. Shares no code with `CartItemRow`, which is
 * untouched by Slice 8.
 *
 * Displays only what D4 permits: image, name, brand, labelled unit price,
 * and the current cart quantity as static text.
 *
 * 🔴 No increment, decrement, remove, undo, or line total. Quantity is text,
 * never a control — this component contains no interactive element at all.
 */
export function CartDrawerLine({ line }: CartDrawerLineProps) {
  const { t } = useTranslation('cart')

  return (
    <div className="grid grid-cols-[64px_1fr] items-start gap-3">
      <div className="w-16">
        <ProductImage imageFile={line.imageFile} alt={line.name} />
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm font-semibold text-text-ink">{line.name}</p>

        {line.brandName && <p className="text-xs text-text-muted">{line.brandName}</p>}

        {/*
          REQ-F-021's unit price, labelled — same pattern as CartItemRow, so
          the figure is never mistaken for a line total. PriceBlock owns the
          LTR isolation and the single Intl.NumberFormat path.
        */}
        <p className="flex flex-wrap items-baseline gap-1.5 text-xs text-text-muted">
          <span>{t('item.unitPrice')}</span>
          <PriceBlock price={line.unitPrice} />
        </p>

        <p className="text-xs text-text-muted">{t('drawer.quantityLabel', { quantity: line.quantity })}</p>

        {/*
          🔴 The LINE TOTAL, computed server-side. It appears here as well as
          on /cart because the drawer's quantity is now a SERVER quantity that
          may differ from the one the shopper asked for.
        */}
        <p className="flex flex-wrap items-baseline gap-1.5 text-xs text-text-muted">
          <span>{t('item.lineTotal')}</span>
          <PriceBlock price={line.lineTotal} />
        </p>
      </div>
    </div>
  )
}
