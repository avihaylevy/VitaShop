import type { ReactNode } from 'react'
import { useId } from 'react'
import { Input } from '../ui/Input'

/**
 * Shared shell and field primitives for the MILESTONE-006 auth forms.
 *
 * 🔴 Logical properties only — `ms/me/ps/pe`, never `ml/mr/pl/pr`. RTL and
 * LTR use the SAME implementation; there is no RTL-only branch anywhere in
 * this file, which is what makes the mirroring verifiable rather than
 * maintained by hand.
 */

export function AuthCard({
  titleId,
  title,
  children,
}: {
  titleId: string
  title: string
  children: ReactNode
}) {
  return (
    <section
      className="mx-auto w-full max-w-md px-4 py-10 sm:py-14"
      aria-labelledby={titleId}
    >
      <h1 id={titleId} className="text-xl font-semibold text-text-ink">
        {title}
      </h1>
      {children}
    </section>
  )
}

/**
 * A labelled control. 🔴 The label is programmatically associated via
 * `htmlFor`/`id` — a visually adjacent label is not an association, and the
 * ARIA snapshot in H's verification checks the accessible name, not the
 * presence of text nearby.
 */
export function Field({
  label,
  hint,
  error,
  type = 'text',
  value,
  onChange,
  autoComplete,
  required = true,
  inputMode,
}: {
  label: string
  hint?: string
  error?: string
  type?: string
  value: string
  onChange: (value: string) => void
  autoComplete?: string
  required?: boolean
  inputMode?: 'text' | 'email' | 'tel'
}) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className="mt-4">
      <label htmlFor={id} className="block text-sm font-medium text-text-ink">
        {label}
      </label>
      <Input
        id={id}
        type={type}
        value={value}
        required={required}
        inputMode={inputMode}
        autoComplete={autoComplete}
        aria-describedby={describedBy}
        invalid={Boolean(error)}
        wrapperClassName="mt-1"
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1 text-xs text-state-error">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * 🔴 The form-level error region, and it is an `aria-live` region on purpose.
 *
 * A failed login re-renders text in place with no focus change and no
 * navigation. Without a live region a screen-reader user submits the form and
 * is told nothing at all — the failure is rendered, not announced.
 *
 * `role="alert"` (assertive) rather than polite: the user has just acted and
 * is waiting for the outcome.
 *
 * The element is always present, even when empty, so the announcement fires
 * on content change. A region that appears at the same moment its text does
 * is frequently missed by assistive tech.
 */
export function FormError({ message }: { message?: string }) {
  return (
    <p role="alert" className="mt-4 min-h-[1.25rem] text-sm text-state-error">
      {message ?? ''}
    </p>
  )
}
