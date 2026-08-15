import { forwardRef, type ButtonHTMLAttributes, type ReactElement } from 'react'
import { FOCUS_RING } from './focusRing'
import { Icon } from './Icon'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

// Every variant carries its own `border` (width + colour) so toggling
// disabled/loading only ever changes the border COLOUR, never adds a
// border where none existed — a width-auto button must not shift size
// when it becomes disabled.
// Exported for LinkButton — a Link styled as a button must draw from the
// SAME variant source, or every token change forks (review of the
// ISSUE-119/125 diff: two pages carried hand-copied primary-fill strings
// that had already drifted from these values).
export const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'border border-transparent bg-brand-teal text-white hover:bg-brand-teal-strong active:bg-brand-teal-strong',
  secondary: 'border border-border-control bg-well text-text-ink hover:bg-surface-sunken',
  ghost: 'border border-transparent bg-transparent text-text-ink hover:bg-surface-sunken',
  // DESIGN_SYSTEM.md §1: "error is never filled, commerce is always filled" — a
  // filled red button collides with the commerce fill visually and by rule.
  // Destructive intent is carried by border + text colour instead.
  danger: 'border border-state-error bg-well text-state-error hover:bg-state-error/10 active:bg-state-error/15',
}

const DISABLED_CLASS =
  'disabled:pointer-events-none disabled:border-border-hairline disabled:bg-surface-sunken disabled:text-text-muted'

/**
 * 🔴 THE SAME LOOK FOR `aria-disabled`, and it belongs here rather than at the
 * call site — ISSUE-098.
 *
 * A control that must stay FOCUSABLE while unavailable cannot use `disabled`:
 * the browser blurs a disabled element the moment the attribute appears, which
 * is how the home page's Retry button dropped focus to `<body>` mid-request.
 * `aria-disabled` keeps focus and announces the same state — but it matched
 * none of the `disabled:` rules above, so such a button ANNOUNCED unavailable
 * while looking fully live.
 *
 * ⚠️ THE CALL SITE CANNOT FIX THIS WITH PLAIN CLASSES. Passing
 * `bg-surface-sunken` in `className` collides with the variant's own `bg-well`
 * at equal specificity, so the winner is whichever Tailwind emits later —
 * measured in Chromium, the variant won and the button stayed white while its
 * text and pointer-events changed. A variant selector resolves it for good:
 * `aria-disabled:bg-…` compiles to an attribute selector and outranks the
 * plain class.
 */
const ARIA_DISABLED_CLASS =
  'aria-disabled:pointer-events-none aria-disabled:border-border-hairline aria-disabled:bg-surface-sunken aria-disabled:text-text-muted'

type ButtonProps = {
  variant?: ButtonVariant
  loading?: boolean
  icon?: ReactElement
  fullWidth?: boolean
  /** Allows the label to wrap to a second line instead of staying on one. Off by default (single line, fixed 44px height). */
  wrap?: boolean
} & ButtonHTMLAttributes<HTMLButtonElement>

/**
 * States: disabled, hover, active, focus-visible. `loading` is authoritative
 * for `aria-busy` — a caller-supplied `aria-busy` in the spread cannot
 * override it. The label and icon stay in the layout (just invisible) while
 * loading, so the button's width/height never shifts when loading toggles.
 *
 * Ref-forwarding — ISSUE-026's first half, matching IconButton: callers that
 * must return focus to a specific Button (UndoRow's restore choreography, the
 * admin ship-flow) no longer need container refs plus scoped querySelectors.
 * Existing call sites keep working; new focus targets take a ref directly.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    loading = false,
    icon,
    fullWidth = false,
    wrap = false,
    disabled,
    type = 'button',
    className = '',
    children,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${FOCUS_RING} relative inline-flex items-center justify-center gap-2 rounded-card px-4 text-sm font-medium transition-colors duration-150 ease-standard ${
        wrap ? 'min-h-11 py-2 text-center leading-snug' : 'h-11 whitespace-nowrap'
      } ${fullWidth ? 'w-full' : 'min-w-11'} ${DISABLED_CLASS} ${ARIA_DISABLED_CLASS} ${VARIANT_CLASS[variant]} ${className}`}
    >
      <span className={`inline-flex items-center justify-center gap-2 ${loading ? 'invisible' : ''}`}>
        {icon && <Icon size={18}>{icon}</Icon>}
        {children}
      </span>
      {loading && (
        <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
          <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />
        </span>
      )}
    </button>
  )
})
