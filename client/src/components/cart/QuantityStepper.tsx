import { useTranslation } from 'react-i18next'
import { IconButton } from '../ui/IconButton'
import { VisuallyHidden } from '../ui/VisuallyHidden'
import { MinusIcon, PlusIcon } from '../icons'

type QuantityStepperProps = {
  quantity: number
  /**
   * This line's snapshot stock ceiling — DEC-044: no invented cap. 🔴 A
   * snapshot, not live stock: `/cart` performs no catalogue refresh and no
   * server validation, and REQ-F-022's server-side check remains
   * unimplemented.
   */
  max: number
  /** Language-resolved product name, for the group's accessible name. */
  productName: string
  onIncrement: () => void
  onDecrement: () => void
}

/**
 * DESIGN_SYSTEM.md §8 — quantity control.
 *
 * 🔴 DOM order is [decrease] [value] [increase], and it is the SAME DOM in
 * both directions. In RTL the first child renders rightmost, producing the
 * standardised decrease-right / increase-left order; in LTR the same source
 * produces the LTR convention. There is deliberately no `row-reverse`, no
 * mirroring override and no direction-specific branch — do not "fix" this.
 *
 * `min` is not a prop: it is 1, fixed by DEC-044, and a prop would invite a
 * second value. Both disabled states are derived from `quantity`/`max` by the
 * caller's display model rather than passed in, so a disabled control can
 * never disagree with the number beside it. Both buttons are natively
 * `disabled` — never a click-guard.
 */
export function QuantityStepper({ quantity, max, productName, onIncrement, onDecrement }: QuantityStepperProps) {
  const { t } = useTranslation('cart')

  return (
    <div
      role="group"
      aria-label={t('quantity.groupLabel', { product: productName })}
      className="inline-flex items-center gap-1"
    >
      <IconButton
        variant="secondary"
        icon={<MinusIcon />}
        aria-label={t('quantity.decrease', { product: productName })}
        disabled={quantity <= 1}
        onClick={onDecrement}
      />
      {/*
        DESIGN_SYSTEM.md §8/§12: the quantity is exposed to assistive
        technology with a `כמות:` prefix and announced politely on change. The
        region is always in the DOM (never conditionally mounted), otherwise
        the first change would not be announced at all. dir="ltr" + isolation
        keeps the numeral LTR inside Hebrew text.
      */}
      <span aria-live="polite" className="min-w-11 text-center text-sm font-medium text-text-ink">
        <VisuallyHidden>{t('quantity.valueLabel')} </VisuallyHidden>
        <span dir="ltr" style={{ unicodeBidi: 'isolate' }}>
          {quantity}
        </span>
      </span>
      <IconButton
        variant="secondary"
        icon={<PlusIcon />}
        aria-label={t('quantity.increase', { product: productName })}
        disabled={quantity >= max}
        onClick={onIncrement}
      />
    </div>
  )
}
