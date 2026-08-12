import { useTranslation } from 'react-i18next'
import type { CartLineDisplay } from '../../lib/cartDisplay'
import { ProductImage } from '../catalog/ProductImage'
import { PriceBlock } from '../catalog/PriceBlock'
import { StockState } from '../catalog/StockState'
import { Button } from '../ui/Button'
import { TrashIcon } from '../icons'
import { QuantityStepper } from './QuantityStepper'

/**
 * Slug-bound hook so a caller can locate exactly one row in the committed DOM.
 * It is a data attribute rather than a prop because the row already knows its
 * own slug: no public contract grows, and no selector can collide with another
 * row or depend on translated text.
 */
export const CART_ROW_ATTRIBUTE = 'data-cart-row'

type CartItemRowProps = {
  line: CartLineDisplay
  /** True while a cart request is in flight — every control disables honestly. */
  busy: boolean
  onIncrement: (line: CartLineDisplay) => void
  onDecrement: (line: CartLineDisplay) => void
  onRemove: (line: CartLineDisplay) => void
}

/**
 * DESIGN_SYSTEM.md §8 — one item-row structure, used for every line.
 *
 * Desktop `88px | 1fr | auto`; on mobile the image and text share one row and
 * the controls take a full-width row beneath, with remove in its own row away
 * from the stepper so a mistap cannot delete a line.
 *
 * 🔴 EVERY VALUE HERE CAME FROM THE SERVER on the last response — quantity,
 * unit price, line total and live stock. Checkpoint G removed the browser-memory
 * cart that used to supply them (§3.4: a client is not a source of truth).
 *
 * 🔴 C3 — A LINE WHOSE PRODUCT WENT INACTIVE IS SHOWN, STRUCK THROUGH, WITH AN
 * EXPLANATION, and it blocks checkout until the shopper removes it. It is NOT
 * dropped: dropping it silently makes the cart lie about what was put in it.
 * Its stepper is disabled — changing the quantity of something we no longer
 * sell is not an operation — while REMOVE stays enabled, because removing it is
 * the whole way out.
 *
 * 🔴 Renders cart fields only — no description, ingredients, warnings,
 * allergens, dosage claims or medical content.
 *
 * 🔴 The row owns NO separator. Separation between rows is a list concern, so
 * the divider lives on the `<li>` in `CartPage` with `last:border-b-0`.
 */
export function CartItemRow({ line, busy, onIncrement, onDecrement, onRemove }: CartItemRowProps) {
  const { t } = useTranslation('cart')

  return (
    <div
      {...{ [CART_ROW_ATTRIBUTE]: line.slug }}
      className="grid grid-cols-[88px_1fr] items-start gap-3 py-4 md:grid-cols-[88px_1fr_auto] md:items-center md:gap-4"
    >
      <div className={`w-[88px] ${line.isActive ? '' : 'opacity-50'}`}>
        <ProductImage imageFile={line.imageFile} alt={line.name} />
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        {/*
          Struck through AND explained in words below — never strike-through
          alone, which is a visual-only signal a screen reader does not report.
        */}
        <p
          className={`text-sm font-semibold text-text-ink ${line.isActive ? '' : 'line-through decoration-2'}`}
        >
          {line.name}
        </p>

        {line.brandName && <p className="text-xs text-text-muted">{line.brandName}</p>}

        <p className="text-xs text-text-muted">
          {t('item.packageQuantity', { quantity: line.packageQuantity })}
        </p>

        {/*
          REQ-F-021 requires the unit price. It is labelled, so "94.90 ₪" is
          never left to be read as a line total. PriceBlock owns the LTR
          isolation and the single Intl.NumberFormat path.
        */}
        <p className="flex flex-wrap items-baseline gap-1.5 text-xs text-text-muted">
          <span>{t('item.unitPrice')}</span>
          <PriceBlock price={line.unitPrice} />
        </p>

        {/*
          🔴 The line total, computed SERVER-SIDE and rendered as given. The
          client does not multiply money — it never has, and now it has no
          price of its own to multiply.
        */}
        <p className="flex flex-wrap items-baseline gap-1.5 text-xs text-text-muted">
          <span>{t('item.lineTotal')}</span>
          <PriceBlock price={line.lineTotal} />
        </p>

        {line.isActive ? (
          <StockState stockQuantity={line.maxQuantity} lowStockThreshold={line.lowStockThreshold} />
        ) : (
          <p className="text-xs font-medium text-state-error">{t('item.unavailable')}</p>
        )}
      </div>

      <div className="col-span-2 flex flex-col items-start gap-3 md:col-span-1 md:items-end">
        <QuantityStepper
          quantity={line.quantity}
          canIncrement={line.canIncrement && line.isActive && !busy}
          canDecrement={line.canDecrement && line.isActive && !busy}
          productName={line.name}
          onIncrement={() => onIncrement(line)}
          onDecrement={() => onDecrement(line)}
        />

        {/*
          🔴 Deliberately static, not a live region: the increment button is
          natively disabled at the stock ceiling, so this note explains a state
          rather than reporting an event. It describes LIVE stock as the server
          reported it on the last response — but it is still not a reservation,
          and another shopper may take the last unit before checkout.
        */}
        {line.isActive && line.atStockCap && (
          <p className="max-w-xs text-xs text-text-muted md:text-end">{t('quantity.atStockCap')}</p>
        )}

        {/*
          DESIGN_SYSTEM.md §8: icon PLUS the visible word — never an icon
          alone, never colour alone. The accessible name names the product.
          🔴 Enabled even for an inactive line: removal is the only way to
          unblock checkout.
        */}
        <Button
          variant="danger"
          icon={<TrashIcon />}
          aria-label={t('remove.ariaLabel', { product: line.name })}
          disabled={busy}
          onClick={() => onRemove(line)}
        >
          {t('remove.label')}
        </Button>
      </div>
    </div>
  )
}
