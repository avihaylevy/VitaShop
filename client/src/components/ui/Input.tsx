import type { InputHTMLAttributes, ReactElement } from 'react'
import { FOCUS_RING } from './focusRing'
import { Icon } from './Icon'

type InputProps = {
  invalid?: boolean
  leadingIcon?: ReactElement
  trailingIcon?: ReactElement
  /** className for the positioning wrapper (sizing, layout). `className` stays on the native input itself. */
  wrapperClassName?: string
} & InputHTMLAttributes<HTMLInputElement>

/**
 * Raw control only — label/error placement is Field's job (not in this
 * slice). Uses --border-control, never --border-hairline (DESIGN_SYSTEM.md
 * §12). `invalid` is authoritative for `aria-invalid` — a caller-supplied
 * `aria-invalid` in the spread cannot override `invalid={true}`.
 */
export function Input({
  invalid = false,
  leadingIcon,
  trailingIcon,
  wrapperClassName = '',
  className = '',
  ...rest
}: InputProps) {
  return (
    <span className={`relative inline-flex w-full items-center ${wrapperClassName}`}>
      {leadingIcon && (
        <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-text-muted">
          <Icon size={18}>{leadingIcon}</Icon>
        </span>
      )}
      {/*
       * 🔴 ISSUE-046 — text-base (16px), NOT text-sm. iOS Safari ZOOMS THE
       * WHOLE PAGE when a focused input computes under 16px, and the zoom
       * PERSISTS after the keyboard closes, leaving the layout scaled and
       * scrolled sideways. Every text-entry control in this app carries this
       * class for that reason.
       *
       * ⚠️ NOT a design-token change. --text-sm still means 13px and is
       * untouched; DESIGN_SYSTEM.md (Accepted, DEC-035) specifies input
       * COLOUR, RADIUS and FOCUS RING but says nothing about input font size,
       * so no accepted value was overridden. Changing the token itself would
       * have been a stop-and-ask.
       */}
      <input
        {...rest}
        aria-invalid={invalid || undefined}
        className={`${FOCUS_RING} h-11 w-full rounded-compact border bg-well text-base text-text-ink placeholder:text-text-muted disabled:cursor-not-allowed disabled:border-border-hairline disabled:bg-surface-sunken disabled:text-text-muted disabled:placeholder:text-text-muted ${
          leadingIcon ? 'ps-10' : 'ps-3'
        } ${trailingIcon ? 'pe-10' : 'pe-3'} ${invalid ? 'border-state-error' : 'border-border-control'} ${className}`}
      />
      {trailingIcon && (
        <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-text-muted">
          <Icon size={18}>{trailingIcon}</Icon>
        </span>
      )}
    </span>
  )
}
