import { useTranslation } from 'react-i18next'
import { ARIA_DISABLED_CLASS } from '../ui/Button'
import { FOCUS_RING } from '../ui/focusRing'
import { Icon } from '../ui/Icon'
import { VisuallyHidden } from '../ui/VisuallyHidden'
import { MinusIcon, PlusIcon } from '../icons'

/**
 * Area 3 (UI refresh) — compact at md+ (44px stays the floor below md, the
 * global guardrail), matching the shape language already established
 * elsewhere rather than IconButton's fixed 44x44: IconButton has no
 * responsive size, and the compact stepper the user approved needs one.
 *
 * The rest tokens (border-border-control bg-well text-text-ink) mirror
 * Button's VARIANT_CLASS.secondary; only the hover deliberately diverges
 * (teal lift, matching the chrome controls, instead of secondary's sunken
 * fill). The aria-disabled look is COMPOSED from Button's exported
 * ARIA_DISABLED_CLASS, never restated — review of this diff: a hand
 * copy here had already dropped aria-disabled:bg-surface-sunken while
 * claiming to be verbatim, the exact ISSUE-098 drift the export kills.
 * aria-disabled, never native `disabled` — see the component header.
 */
const STEPPER_BUTTON_CLASS = `${ARIA_DISABLED_CLASS} flex h-11 w-11 items-center justify-center rounded-card border border-border-control bg-well text-text-ink transition-colors duration-150 ease-standard hover:border-brand-teal hover:text-brand-teal-strong active:scale-[0.97] md:h-9 md:w-9`

type QuantityStepperProps = {
  quantity: number
  /**
   * 🔴 BOTH DISABLED STATES ARE PASSED IN, NOT DERIVED HERE — Checkpoint G.
   *
   * This used to take a `max` and compute `quantity >= max` itself. That made
   * the stepper a second opinion about a bound the SERVER owns, and it could
   * only ever be as fresh as the snapshot it was handed. The caller's display
   * model now answers both questions from the server's own line, and folds in
   * whether a request is in flight and whether the product is still active.
   */
  canIncrement: boolean
  canDecrement: boolean
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
 * The floor is 1 and is not configurable — reaching 0 is a REMOVAL, which has
 * its own labelled control.
 *
 * 🔴 `aria-disabled` + a click guard, NOT native `disabled` — REVERSED from
 * the original contract by the DEC-073 review. Chromium BLURS a focused
 * element the moment it becomes natively disabled (the second defect family
 * in .claude/rules/browser-verification.md). On the cart page that dropped
 * focus to the page; inside the cart DRAWER — a focus-trapped dialog — it
 * dropped focus outside the trap entirely, and the stepper that hit its cap
 * stayed disabled after `pending` cleared, making the escape permanent.
 * jsdom cannot represent the blur, so no green test is evidence here.
 */
export function QuantityStepper({
  quantity,
  canIncrement,
  canDecrement,
  productName,
  onIncrement,
  onDecrement,
}: QuantityStepperProps) {
  const { t } = useTranslation('cart')

  return (
    <div
      role="group"
      aria-label={t('quantity.groupLabel', { product: productName })}
      className="inline-flex items-center gap-1"
    >
      <button
        type="button"
        className={`${FOCUS_RING} ${STEPPER_BUTTON_CLASS}`}
        aria-label={t('quantity.decrease', { product: productName })}
        aria-disabled={!canDecrement || undefined}
        onClick={() => {
          if (canDecrement) onDecrement()
        }}
      >
        <Icon size={14}>
          <MinusIcon />
        </Icon>
      </button>
      {/*
        DESIGN_SYSTEM.md §8/§12: the quantity is exposed to assistive
        technology with a `כמות:` prefix and announced politely on change. The
        region is always in the DOM (never conditionally mounted), otherwise
        the first change would not be announced at all. dir="ltr" + isolation
        keeps the numeral LTR inside Hebrew text.
      */}
      <span aria-live="polite" className="min-w-8 text-center text-sm font-semibold text-text-ink">
        <VisuallyHidden>{t('quantity.valueLabel')} </VisuallyHidden>
        <span dir="ltr" style={{ unicodeBidi: 'isolate' }}>
          {quantity}
        </span>
      </span>
      <button
        type="button"
        className={`${FOCUS_RING} ${STEPPER_BUTTON_CLASS}`}
        aria-label={t('quantity.increase', { product: productName })}
        aria-disabled={!canIncrement || undefined}
        onClick={() => {
          if (canIncrement) onIncrement()
        }}
      >
        <Icon size={14}>
          <PlusIcon />
        </Icon>
      </button>
    </div>
  )
}
