import { useTranslation } from 'react-i18next'
import type { CartLineDisplay } from '../../lib/cartDisplay'
import { ProductImage } from '../catalog/ProductImage'
import { PriceBlock } from '../catalog/PriceBlock'
import { StockState } from '../catalog/StockState'
import { Button } from '../ui/Button'
import { TrashIcon } from '../icons'
import { QuantityStepper } from './QuantityStepper'

/**
 * Slug-bound hook so a caller can locate exactly one row in the committed DOM
 * — used by `CartPage` to move focus into a row it has just restored. It is a
 * data attribute rather than a prop because the row already knows its own
 * slug: no public contract grows, and no selector can collide with another
 * row or depend on translated text.
 */
export const CART_ROW_ATTRIBUTE = 'data-cart-row'

type CartItemRowProps = {
  line: CartLineDisplay
  onIncrement: (slug: string) => void
  onDecrement: (slug: string) => void
  onRemove: (slug: string) => void
}

/**
 * DESIGN_SYSTEM.md §8 — one item-row structure, used for every line.
 *
 * Desktop `88px | 1fr | auto`; on mobile the image and text share one row and
 * the controls take a full-width row beneath, with remove in its own row away
 * from the stepper so a mistap cannot delete a line.
 *
 * 🔴 The product name is TEXT, not a link: `/product/:slug` does not exist
 * yet, and a dead or disabled link is worse than none. Product-detail
 * navigation is deferred to its own route slice.
 *
 * 🔴 Renders cart fields only — no description, ingredients, warnings,
 * allergens, dosage claims or medical content. None of it is stored in
 * `CartItem` and none of it is fetched.
 *
 * 🔴 No line total. The client does not multiply money for display; the only
 * displayed total is the reducer's own `subtotalMinor` selector.
 *
 * All derivation lives in `lib/cartDisplay.ts`; this component renders a
 * prepared line and nothing else.
 *
 * 🔴 The row owns NO separator. Separation between rows is a list concern, so
 * the divider lives on the `<li>` in `CartPage` with `last:border-b-0` — that
 * is what keeps a trailing divider off the final row without adding a
 * `isLast`-style prop to this component's public API, and it lets Slice 8's
 * drawer choose its own list treatment.
 */
export function CartItemRow({ line, onIncrement, onDecrement, onRemove }: CartItemRowProps) {
  const { t } = useTranslation('cart')

  return (
    <div
      {...{ [CART_ROW_ATTRIBUTE]: line.slug }}
      className="grid grid-cols-[88px_1fr] items-start gap-3 py-4 md:grid-cols-[88px_1fr_auto] md:items-center md:gap-4"
    >
      <div className="w-[88px]">
        <ProductImage imageFile={line.imageFile} alt={line.name} />
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm font-semibold text-text-ink">{line.name}</p>

        {line.brandName && <p className="text-xs text-text-muted">{line.brandName}</p>}

        {line.packageQuantity !== undefined && (
          <p className="text-xs text-text-muted">
            {t('item.packageQuantity', { quantity: line.packageQuantity })}
          </p>
        )}

        {/*
          REQ-F-021 requires the unit price. It is labelled, so "94.90 ₪" is
          never left to be read as a line total. PriceBlock owns the LTR
          isolation and the single Intl.NumberFormat path.
        */}
        <p className="flex flex-wrap items-baseline gap-1.5 text-xs text-text-muted">
          <span>{t('item.unitPrice')}</span>
          <PriceBlock price={line.unitPrice} />
        </p>

        <StockState stockQuantity={line.maxQuantity} lowStockThreshold={line.lowStockThreshold} />
      </div>

      <div className="col-span-2 flex flex-col items-start gap-3 md:col-span-1 md:items-end">
        <QuantityStepper
          quantity={line.quantity}
          max={line.maxQuantity}
          productName={line.name}
          onIncrement={() => onIncrement(line.slug)}
          onDecrement={() => onDecrement(line.slug)}
        />

        {/*
          🔴 Deliberately static, not a live region: the increment button is
          natively disabled at the ceiling, so this note explains a state
          rather than reporting an event. It describes the stock SNAPSHOT
          observed when the product was last seen — never live stock, never a
          server check, never a reservation.
        */}
        {line.atStockCap && (
          <p className="max-w-xs text-xs text-text-muted md:text-end">{t('quantity.atStockCap')}</p>
        )}

        {/*
          DESIGN_SYSTEM.md §8: icon PLUS the visible word — never an icon
          alone, never colour alone. The accessible name names the product.
        */}
        <Button
          variant="danger"
          icon={<TrashIcon />}
          aria-label={t('remove.ariaLabel', { product: line.name })}
          onClick={() => onRemove(line.slug)}
        >
          {t('remove.label')}
        </Button>
      </div>
    </div>
  )
}
