import type { TextareaHTMLAttributes } from 'react'
import { FOCUS_RING } from './focusRing'

type TextareaProps = {
  invalid?: boolean
} & TextareaHTMLAttributes<HTMLTextAreaElement>

/**
 * Raw multiline control — Input's sibling, same contract: label/error
 * placement is Field's job; `--border-control`, never hairline
 * (DESIGN_SYSTEM.md §12); `invalid` is authoritative for `aria-invalid`
 * AND the error border (review finding: the first inline textarea set
 * aria-invalid but kept a neutral border, so a failed contact-form
 * submit outlined every field in red except the message).
 *
 * 🔴 text-base, not text-sm — ISSUE-046's iOS-zoom rule applies to every
 * text-entry control; see Input.tsx's comment for the full story.
 */
export function Textarea({ invalid = false, className = '', ...rest }: TextareaProps) {
  return (
    <textarea
      {...rest}
      aria-invalid={invalid || undefined}
      className={`${FOCUS_RING} block w-full resize-y rounded-compact border bg-well px-3 py-2 text-base text-text-ink placeholder:text-text-muted disabled:cursor-not-allowed disabled:border-border-hairline disabled:bg-surface-sunken disabled:text-text-muted ${
        invalid ? 'border-state-error' : 'border-border-control'
      } ${className}`}
    />
  )
}
