import { useTranslation } from 'react-i18next'
import type { CartLineDisplay } from '../../lib/cartDisplay'
import { packageUnitLabel } from '../../lib/mapCatalogProduct'
import type { SupportedLanguage } from '../../i18n'
import { VisuallyHidden } from '../ui/VisuallyHidden'
import { ProductImage } from '../catalog/ProductImage'
import { PriceBlock } from '../catalog/PriceBlock'
import { StockState } from '../catalog/StockState'
import { Icon } from '../ui/Icon'
import { FOCUS_RING } from '../ui/focusRing'
import { TrashIcon } from '../icons'
import { QuantityStepper } from './QuantityStepper'

/**
 * Area 3 (UI refresh) — a quiet ghost control instead of the filled
 * danger Button: icon + the visible word stay (DESIGN_SYSTEM §8 — never
 * an icon alone), just smaller, with the red only appearing on
 * hover/focus rather than painted at rest. Native `disabled`, unchanged
 * from before — removal isn't part of the aria-disabled/focus-trap family
 * QuantityStepper's cap button is (there's nothing to keep focus ON once
 * the line is gone).
 *
 * ⚠️ DELIBERATE divergences from Button's grammar, not drift (review of
 * this diff asked): disabled:opacity-50 instead of the token swap —
 * this control's rest state IS text-muted on transparent, so Button's
 * disabled tokens would render it indistinguishable from enabled; and
 * the hover tint restates danger's rgb because VARIANT_CLASS.danger is
 * a whole-variant string that can't be composed piecemeal.
 */
// py-3.5 (44px floor below md, the global guardrail) → py-1.5 at md+
// where a mouse, not a fingertip, is doing the pointing.
const REMOVE_BUTTON_CLASS =
  'inline-flex items-center gap-1.5 rounded-round py-3.5 ps-2.5 pe-3 text-xs font-medium text-text-muted transition-colors duration-150 ease-standard hover:bg-state-error/10 hover:text-state-error disabled:pointer-events-none disabled:opacity-50 md:py-1.5 md:ps-2 md:pe-2.5'

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
  /** DEC-096: absent = no removal control (the drawer's quick-glance mode; the page is the editor). */
  onRemove?: (line: CartLineDisplay) => void
  /**
   * DEC-112 — the DRAWER's glance shape: name + line total + stepper +
   * remove, nothing else. Package quantity, the unit price (REQ-F-021's
   * display duty — the PAGE carries it), and the ok-state stock badge are
   * page-only detail. Purchasability WARNINGS always render — a blocked
   * line must say why in both surfaces. One component, one §8 structure;
   * the variant only omits, it never restyles.
   */
  compact?: boolean
}

/**
 * DESIGN_SYSTEM.md §8 — one item-row structure, used for every line.
 *
 * Desktop `56px | 1fr | auto`; on mobile the image and text share one row and
 * the controls (stepper, then remove) take a full-width row beneath —
 * stacked, not side by side, so a mistap cannot delete a line.
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
export function CartItemRow({
  line,
  busy,
  onIncrement,
  onDecrement,
  onRemove,
  compact = false,
}: CartItemRowProps) {
  const { t, i18n } = useTranslation('cart')
  // The thirteenth list — a volume form's quantity carries its unit
  // ("250 מ״ל"), through the SAME lookup the card and detail page use.
  const packageUnit = packageUnitLabel(line.dosageForm, i18n.language as SupportedLanguage)

  return (
    <div
      {...{ [CART_ROW_ATTRIBUTE]: line.slug }}
      className="grid grid-cols-[56px_1fr] items-start gap-3 py-2.5 md:grid-cols-[56px_1fr_auto] md:items-center md:gap-3"
    >
      <div className={`w-14 shrink-0 ${line.isActive ? '' : 'opacity-50'}`}>
        <ProductImage imageFile={line.imageFile} alt={line.name} />
      </div>

      <div className="flex min-w-0 flex-col gap-0.5">
        {/*
          Area 3 — name and brand share one line (name carries the weight,
          brand rides beside it muted); struck through AND explained in
          words below — never strike-through alone, which is a visual-only
          signal a screen reader does not report.
        */}
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0">
          <span
            className={`text-[15px] font-semibold text-text-ink ${line.isActive ? '' : 'line-through decoration-2'}`}
          >
            {line.name}
          </span>
          {line.brandName && <span className="text-[13px] text-text-muted">{line.brandName}</span>}
        </p>

        {!compact && (
          <p className="text-xs text-text-muted">
            {packageUnit
              ? t('item.packageQuantityWithUnit', { quantity: line.packageQuantity, unit: packageUnit })
              : t('item.packageQuantity', { quantity: line.packageQuantity })}
          </p>
        )}

        {/*
          Area 3 — unit price and line total fold into ONE line (still two
          labelled figures, REQ-F-021 + the "client never multiplies money"
          rule both still hold — this is spacing, not a data change).
          PriceBlock owns the LTR isolation and the single
          Intl.NumberFormat path.
        */}
        <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0 text-xs text-text-muted">
          {!compact && (
            <>
              <span>{t('item.unitPrice')}</span>
              {/*
                The seventh list, item 2 — the struck-through base price
                beside the member price, via PriceBlock's `struck` variant
                so the ISSUE-084 bidi structure stays in ONE file (review
                finding — an inline copy here lacked the outer no-dir
                wrapper that fix added). Never strike-through alone: the
                hidden label says what the struck figure IS. Both figures
                are the server's; the row noticed two different strings,
                it computed nothing.
              */}
              {line.hasClubDiscount && (
                <>
                  <VisuallyHidden>{t('item.fullPrice')}</VisuallyHidden>
                  <PriceBlock price={line.baseUnitPrice} struck />
                </>
              )}
              <PriceBlock price={line.unitPrice} />
              <span aria-hidden="true">·</span>
            </>
          )}
          {/*
            🔴 The line total, computed SERVER-SIDE and rendered as given.
            The client does not multiply money — it never has, and now it
            has no price of its own to multiply.
          */}
          <span>{t('item.lineTotal')}</span>
          <PriceBlock price={line.lineTotal} />
        </p>

        {/*
          🔴 ISSUE-080. This branched on `isActive` alone, so the SHORT-STOCK
          line — the one the server actually blocks on — fell through to
          `StockState`, which reports 4 against a threshold of 3 as "in stock"
          and renders an EMPTY, aria-hidden box. The row said nothing at all
          while being the reason checkout was refused.

          Each state names the SHOPPER'S NEXT ACTION, not just the condition:
          two of them can only be removed, and the third is fixed by lowering
          a number, which is why they cannot share one message.
        */}
        {line.purchasability === 'ok' ? (
          !compact && (
            <StockState stockQuantity={line.maxQuantity} lowStockThreshold={line.lowStockThreshold} />
          )
        ) : (
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium text-state-error">
              {line.purchasability === 'withdrawn' && t('item.unavailable')}
              {line.purchasability === 'soldOut' && t('item.soldOut')}
              {line.purchasability === 'shortStock' &&
                t('item.shortStock', { available: line.maxQuantity })}
            </p>
            {/*
              F1a made the subtotal purchasable-only, so this line's total is
              displayed above and counted nowhere. Saying so is the difference
              between a shopper trusting the number and adding the rows up
              themselves.
            */}
            {!line.countsTowardTotal && (
              <p className="text-xs text-text-muted">{t('item.notCounted')}</p>
            )}
          </div>
        )}
      </div>

      <div className="col-span-2 mt-1 flex flex-col items-start gap-2 md:col-span-1 md:mt-0 md:items-end">
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
        {/*
          🔴 ISSUE-080 — `purchasability === 'ok'`, NOT `isActive`. At quantity
          5 against stock 4 this printed "this is all the stock currently
          available" on the very line blocking the order: reassurance that
          contradicts the block, and the shopper's actual fix (lower it to 4)
          appeared nowhere. The short-stock message above replaces it.
        */}
        {line.purchasability === 'ok' && line.atStockCap && (
          <p className="max-w-xs text-xs text-text-muted md:text-end">{t('quantity.atStockCap')}</p>
        )}

        {/*
          DESIGN_SYSTEM.md §8: icon PLUS the visible word — never an icon
          alone, never colour alone. The accessible name names the product.
          🔴 Enabled even for an inactive line: removal is the only way to
          unblock checkout.
        */}
        {onRemove !== undefined && (
          <button
            type="button"
            className={`${FOCUS_RING} ${REMOVE_BUTTON_CLASS}`}
            aria-label={t('remove.ariaLabel', { product: line.name })}
            disabled={busy}
            onClick={() => onRemove(line)}
          >
            <Icon size={14}>
              <TrashIcon />
            </Icon>
            {t('remove.label')}
          </button>
        )}
      </div>
    </div>
  )
}
