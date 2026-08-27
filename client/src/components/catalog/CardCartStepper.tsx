import { forwardRef } from 'react'
import { useTranslation } from 'react-i18next'
import { FOCUS_RING } from '../ui/focusRing'
import { Icon } from '../ui/Icon'
import { MinusIcon, PlusIcon } from '../icons'
import { MAX_ADD_QUANTITY } from './AddQuantityStepper'

type CardCartStepperProps = {
  /** The server-reported line quantity — never a local count. */
  quantity: number
  onIncrease: () => void
  onDecrease: () => void
  /** Language-resolved product name — folded into the group's accessible name. */
  productName: string
  /** True while a cart mutation is in flight — presses no-op honestly. */
  pending: boolean
  /** True when stock is exhausted — the ONLY other reason + is unavailable, same as the pill's own isOut gate. */
  isOut?: boolean
}

/**
 * DEC-110 (UI refresh, area 1) — the stepper that takes the add pill's place
 * once the product is IN the cart. Unlike AddQuantityStepper (a local
 * "how many will the next press add" chooser, still used on the detail
 * page), this one edits the CART LINE: + / − go to the server through
 * CartContext, and the number shown is always the quantity the server last
 * returned (§3.4 — the client is not a source of truth).
 *
 * 🔴 `aria-disabled`, never `disabled` — a `disabled` attribute landing on
 * the focused button blurs it (the ISSUE-098 family). The click handler
 * enforces the no-op. That matters doubly here: pressing − at quantity 1
 * REMOVES the line and this whole control unmounts — ProductCard owns the
 * deliberate focus hand-off back to the add pill (the unmount-takes-focus
 * family).
 *
 * The ref lands on the + button — ProductCard focuses it when the pill
 * hands over after a confirmed add.
 */
export const CardCartStepper = forwardRef<HTMLButtonElement, CardCartStepperProps>(
  function CardCartStepper({ quantity, onIncrease, onDecrease, productName, pending, isOut = false }, increaseRef) {
    const { t } = useTranslation('catalog')
    const increaseDisabled = quantity >= MAX_ADD_QUANTITY || isOut

    const buttonClass = `${FOCUS_RING} flex h-11 w-10 items-center justify-center rounded-round text-text-ink transition-colors duration-150 ease-standard hover:bg-surface-sunken aria-disabled:cursor-not-allowed aria-disabled:text-text-muted aria-disabled:hover:bg-transparent md:h-9`

    return (
      <div
        role="group"
        aria-label={t('quantity.labelFor', { product: productName })}
        className="inline-flex items-center rounded-round bg-well text-text-ink shadow-[0_2px_8px_rgb(31_37_46_/_0.16)]"
      >
        <button
          type="button"
          aria-label={t('quantity.decrease')}
          aria-disabled={pending || undefined}
          onClick={() => {
            if (!pending) onDecrease()
          }}
          className={buttonClass}
        >
          <Icon size={16}>
            <MinusIcon />
          </Icon>
        </button>
        {/* The server's settled quantity — LTR-isolated for RTL stability. */}
        <span dir="ltr" className="min-w-6 text-center text-sm font-bold">
          {quantity}
        </span>
        <button
          ref={increaseRef}
          type="button"
          aria-label={t('quantity.increase')}
          aria-disabled={increaseDisabled || pending || undefined}
          onClick={() => {
            if (!increaseDisabled && !pending) onIncrease()
          }}
          className={buttonClass}
        >
          <Icon size={16}>
            <PlusIcon />
          </Icon>
        </button>
      </div>
    )
  },
)
