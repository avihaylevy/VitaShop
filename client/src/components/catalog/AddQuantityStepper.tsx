import { useTranslation } from 'react-i18next'
import { FOCUS_RING } from '../ui/focusRing'
import { Icon } from '../ui/Icon'
import { MinusIcon, PlusIcon } from '../icons'

type AddQuantityStepperProps = {
  value: number
  onChange: (value: number) => void
  /** Language-resolved product name — folded into the group's accessible name. */
  productName?: string
  className?: string
}

/**
 * ISSUE-118 — how many to add, chosen BEFORE the add, on the card and the
 * detail page. Renamed from `QuantityStepper` in the ISSUE-120/128 design
 * pass: the cart owns a DIFFERENT `QuantityStepper` (per-line, server-bound
 * caps), and two components with one name is how a fix lands in the wrong
 * file. This one chooses the INCREMENT only; the cart's edits the line.
 *
 * ISSUE-128 — the control carries the SAME visual weight as `Button`: a
 * constant 44px height (no desktop shrink — Button has none), 44×44 button
 * targets, the shared icon set, `border-border-control` and `rounded-card`.
 *
 * 🔴 The 1..10 bounds MIRROR C2's per-line cap; the SERVER still clamps
 * (§3.4 — the client is not a source of truth), so a stale UI cap degrades
 * to a clamped add with the drawer explaining, never an oversell.
 *
 * 🔴 `aria-disabled` AT THE BOUNDS, never `disabled` — a disabled attribute
 * landing on the focused button blurs it (the ISSUE-098 family); the click
 * handler enforces the no-op instead.
 */
export const MAX_ADD_QUANTITY = 10

export function AddQuantityStepper({
  value,
  onChange,
  productName,
  className = '',
}: AddQuantityStepperProps) {
  const { t } = useTranslation('catalog')

  const atMin = value <= 1
  const atMax = value >= MAX_ADD_QUANTITY

  const buttonClass = `${FOCUS_RING} flex h-11 w-11 items-center justify-center text-text-ink transition-colors duration-150 ease-standard hover:bg-surface-sunken aria-disabled:cursor-not-allowed aria-disabled:text-text-muted aria-disabled:hover:bg-transparent`

  return (
    <div
      role="group"
      aria-label={
        productName ? t('quantity.labelFor', { product: productName }) : t('quantity.label')
      }
      className={`inline-flex items-center overflow-hidden rounded-card border border-border-control bg-well ${className}`}
    >
      <button
        type="button"
        aria-label={t('quantity.decrease')}
        aria-disabled={atMin || undefined}
        onClick={() => {
          if (!atMin) onChange(value - 1)
        }}
        className={buttonClass}
      >
        <Icon size={18}>
          <MinusIcon />
        </Icon>
      </button>
      {/* The chosen amount — LTR-isolated so the numeral is stable in RTL. */}
      <span dir="ltr" className="min-w-8 text-center text-base font-semibold text-text-ink">
        {value}
      </span>
      <button
        type="button"
        aria-label={t('quantity.increase')}
        aria-disabled={atMax || undefined}
        onClick={() => {
          if (!atMax) onChange(value + 1)
        }}
        className={buttonClass}
      >
        <Icon size={18}>
          <PlusIcon />
        </Icon>
      </button>
    </div>
  )
}
