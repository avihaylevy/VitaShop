import type { ButtonHTMLAttributes, ReactElement } from 'react'
import { FOCUS_RING } from './focusRing'
import { Icon } from './Icon'

type IconButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

// Every variant carries its own `border` (width + colour) so disabling only
// changes the border COLOUR, consistent with Button (size-11 is fixed here,
// so it would not actually shift, but the same rule keeps both primitives honest).
const VARIANT_CLASS: Record<IconButtonVariant, string> = {
  primary: 'border border-transparent bg-brand-teal text-white hover:bg-brand-teal-strong active:bg-brand-teal-strong',
  secondary: 'border border-border-control bg-well text-text-ink hover:bg-surface-sunken',
  ghost: 'border border-transparent bg-transparent text-text-ink hover:bg-surface-sunken',
  // DESIGN_SYSTEM.md §1: error is never filled, commerce is the only white-on-fill token.
  danger: 'border border-state-error bg-well text-state-error hover:bg-state-error/10 active:bg-state-error/15',
}

const DISABLED_CLASS =
  'disabled:pointer-events-none disabled:border-border-hairline disabled:bg-surface-sunken disabled:text-text-muted'

type IconButtonProps = {
  icon: ReactElement
  'aria-label': string
  variant?: IconButtonVariant
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>

/** aria-label is required by type, not convention. Square 44x44 touch target, never smaller. Same radius family as Button (DESIGN_SYSTEM §3 reserves the full circle for status dots/count badges, not buttons). */
export function IconButton({
  icon,
  variant = 'ghost',
  disabled,
  type = 'button',
  className = '',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      {...rest}
      disabled={disabled}
      className={`${FOCUS_RING} inline-flex size-11 items-center justify-center rounded-card transition-colors duration-150 ease-standard ${DISABLED_CLASS} ${VARIANT_CLASS[variant]} ${className}`}
    >
      <Icon size={18}>{icon}</Icon>
    </button>
  )
}
