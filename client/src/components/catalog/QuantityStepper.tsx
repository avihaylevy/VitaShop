import { useTranslation } from 'react-i18next'
import { FOCUS_RING } from '../ui/focusRing'

type QuantityStepperProps = {
  value: number
  onChange: (value: number) => void
  className?: string
}

/**
 * ISSUE-118 — how many to add, chosen BEFORE the add. One shared control for
 * every add-to-cart surface (card, detail page), so the bounds and the
 * accessibility shape exist once.
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

export function QuantityStepper({ value, onChange, className = '' }: QuantityStepperProps) {
  const { t } = useTranslation('catalog')

  const atMin = value <= 1
  const atMax = value >= MAX_ADD_QUANTITY

  const buttonClass = `${FOCUS_RING} flex h-11 w-9 items-center justify-center text-base font-medium text-text-ink transition-colors duration-150 ease-standard hover:bg-surface-sunken aria-disabled:cursor-not-allowed aria-disabled:text-text-muted aria-disabled:hover:bg-transparent md:h-9`

  return (
    <div
      role="group"
      aria-label={t('quantity.label')}
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
        <span aria-hidden="true">−</span>
      </button>
      {/* The chosen amount — LTR-isolated so the numeral is stable in RTL. */}
      <span dir="ltr" className="min-w-7 text-center text-sm font-semibold text-text-ink">
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
        <span aria-hidden="true">+</span>
      </button>
    </div>
  )
}
