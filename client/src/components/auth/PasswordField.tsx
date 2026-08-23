import { useId, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '../ui/Input'
import { Icon } from '../ui/Icon'
import { EyeIcon, EyeOffIcon } from '../icons'
import { FOCUS_RING } from '../ui/focusRing'

/**
 * The signup redesign (2026-08-23, the user's mock) — a password field
 * with a show/hide toggle. Field's shape (label above, error below, the
 * same Input primitive) with one addition: an eye button INSIDE the
 * input's wrapper, on the inline-end side.
 *
 * 🔴 The toggle is a real <button type="button"> with aria-pressed and a
 * state-named label — never an icon-only div. It stays OUTSIDE the
 * <label> (the nested-interactive rule browser-verification.md forbids:
 * a control inside a label swallows the click-to-focus area).
 *
 * ⚠️ Toggling type never remounts the input (same element, same id), so
 * focus and the typed value survive the press.
 */
export function PasswordField({
  label,
  value,
  onChange,
  error,
  hint,
  autoComplete,
  children,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
  hint?: string
  autoComplete: string
  /** Rendered between the input and the error — the requirements checklist. */
  children?: ReactNode
}) {
  const { t } = useTranslation('auth')
  const id = useId()
  const [visible, setVisible] = useState(false)
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className="mt-4">
      <label htmlFor={id} className="block text-sm font-medium text-text-ink">
        {label}
      </label>
      <span className="relative block">
        <Input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          required
          autoComplete={autoComplete}
          aria-describedby={describedBy}
          invalid={Boolean(error)}
          wrapperClassName="mt-1"
          className="pe-11"
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          aria-pressed={visible}
          aria-label={visible ? t('passwordField.hide') : t('passwordField.show')}
          onClick={() => setVisible((current) => !current)}
          className={`${FOCUS_RING} absolute inset-y-0 end-0 top-1 flex w-11 items-center justify-center rounded-card text-text-muted hover:text-text-ink`}
        >
          <Icon size={18}>{visible ? <EyeOffIcon /> : <EyeIcon />}</Icon>
        </button>
      </span>
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-text-muted">
          {hint}
        </p>
      )}
      {children}
      {error && (
        <p id={errorId} className="mt-1 text-xs text-state-error">
          {error}
        </p>
      )}
    </div>
  )
}
