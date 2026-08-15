import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { AuthCard, Field, FormError } from '../components/auth/AuthLayout'
import { Button } from '../components/ui/Button'
import { FOCUS_RING } from '../components/ui/focusRing'
import { register, type AuthFailure } from '../lib/authApi'

/**
 * MILESTONE-006 Checkpoint H — registration. REQ-F-030, Table 3's 7 fields.
 *
 * 🔴 CLAUSE H2 / DEC-053 4b. The server returns the SAME 201 whether or not
 * the address is already registered, and this form renders the SAME
 * confirmation either way. It never says "that email is taken" — there is no
 * response it could learn that from, and adding a client-side check to
 * produce one would rebuild the enumeration oracle 4b closes.
 *
 * Field-level validation errors ARE surfaced: they are facts about what the
 * user typed, not about who is registered.
 */
export function RegisterPage() {
  const { t } = useTranslation('auth')

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  // The seventh list, item 1 / DEC-086 — the club opt-in. UNCHECKED by
  // default (the user's decision): a true opt-in, not a pre-ticked one.
  const [joinClub, setJoinClub] = useState(false)

  const [failure, setFailure] = useState<AuthFailure | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [received, setReceived] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setFailure(null)

    const result = await register({
      firstName,
      lastName,
      email,
      password,
      confirmPassword,
      phone,
      acceptedTerms,
      joinClub,
    })
    setSubmitting(false)

    if (result.ok) {
      setReceived(true)
      return
    }
    setFailure(result.failure)
  }

  if (received) {
    // 🔴 Identical for a new address and an already-registered one.
    return (
      <AuthCard titleId="register-received-title" title={t('register.received.title')}>
        <p className="mt-3 text-sm text-text-muted">{t('register.received.body')}</p>
        <p className="mt-6 text-sm">
          <Link to="/login" className="text-brand-primary underline">
            {t('register.loginLink')}
          </Link>
        </p>
      </AuthCard>
    )
  }

  const invalidCodes = failure?.kind === 'invalid' ? failure.codes : []
  const errorFor = (code: string) =>
    invalidCodes.includes(code) ? t(`register.errors.${code}`) : undefined

  const formMessage =
    failure === null || failure.kind === 'invalid'
      ? undefined
      : failure.kind === 'rateLimited'
        ? t('errors.rateLimited')
        : failure.kind === 'network'
          ? t('errors.network')
          : t('errors.unexpected')

  return (
    <AuthCard titleId="register-title" title={t('register.title')}>
      <form onSubmit={onSubmit} noValidate>
        <Field
          label={t('register.firstNameLabel')}
          autoComplete="given-name"
          value={firstName}
          onChange={setFirstName}
          error={errorFor('FIRST_NAME_REQUIRED')}
        />
        <Field
          label={t('register.lastNameLabel')}
          autoComplete="family-name"
          value={lastName}
          onChange={setLastName}
          error={errorFor('LAST_NAME_REQUIRED')}
        />
        <Field
          label={t('register.emailLabel')}
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
          error={errorFor('EMAIL_INVALID')}
        />
        <Field
          label={t('register.passwordLabel')}
          hint={t('register.passwordHint')}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          error={
            errorFor('PASSWORD_TOO_SHORT') ??
            errorFor('PASSWORD_NEEDS_UPPERCASE') ??
            errorFor('PASSWORD_NEEDS_DIGIT') ??
            errorFor('PASSWORD_TOO_LONG')
          }
        />
        <Field
          label={t('register.confirmPasswordLabel')}
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          error={errorFor('PASSWORD_CONFIRMATION_MISMATCH')}
        />
        <Field
          label={t('register.phoneLabel')}
          hint={t('register.phoneHint')}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={setPhone}
          error={errorFor('PHONE_INVALID')}
        />

        {/* The seventh list, item 1 — join the club while registering. A
            benefit, not a consent: no error state, default off. */}
        <CheckboxRow
          id="register-join-club"
          checked={joinClub}
          onChange={setJoinClub}
          label={t('register.clubLabel')}
        />

        <CheckboxRow
          id="register-terms"
          checked={acceptedTerms}
          onChange={setAcceptedTerms}
          error={errorFor('TERMS_REQUIRED')}
          label={t('register.termsLabel')}
        />
        {/*
          The seventh list, item 3 — the terms the label claims the user read
          now EXIST and are one click away. 🔴 The link sits BESIDE the
          label, never inside it (review finding): a link nested in a <label>
          swallows most of the click-to-toggle area and embeds itself in the
          checkbox's accessible name — the nested-interactive shape
          browser-verification.md forbids. target="_blank" so the half-filled
          form survives the read.
        */}
        <p className="ms-6 mt-1 text-xs">
          <Link
            to="/terms"
            target="_blank"
            rel="noreferrer"
            className={`${FOCUS_RING} rounded-compact text-brand-teal underline`}
          >
            {t('register.termsReadLink')}
          </Link>
        </p>

        <FormError message={formMessage} />

        <Button type="submit" disabled={submitting} className="mt-2 w-full">
          {submitting ? t('register.submitting') : t('register.submit')}
        </Button>
      </form>

      <p className="mt-6 text-sm text-text-muted">
        {t('register.hasAccount')}{' '}
        <Link to="/login" className="text-brand-primary underline">
          {t('register.loginLink')}
        </Link>
      </p>
    </AuthCard>
  )
}

/**
 * Table 3 field 26's consent control, generalised for the club opt-in too.
 * Its own component so the label wraps correctly beside the box.
 *
 * 🔴 `label` is a STRING on purpose (review finding): it guarantees every
 * row a non-empty text accessible name, and it keeps interactive content
 * out of the <label> — the terms link lives beside the row, not in it.
 */
function CheckboxRow({
  id,
  checked,
  onChange,
  label,
  error,
}: {
  id: string
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  error?: string
}) {
  const errorId = error ? `${id}-error` : undefined

  return (
    <div className="mt-5">
      {/* `items-start` + `me-*` on the box: logical spacing, so the checkbox
          sits on the inline-start side in both directions with no RTL branch. */}
      <div className="flex items-start">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          aria-describedby={errorId}
          aria-invalid={error ? true : undefined}
          onChange={(event) => onChange(event.target.checked)}
          // The codebase's one checkbox recipe (CatalogFilterPanel,
          // CheckoutPage) — review finding: these two were the only
          // checkboxes in the app without a visible focus ring.
          className={`${FOCUS_RING} mt-0.5 size-4 shrink-0 rounded-compact border-border-control accent-brand-teal`}
        />
        <label htmlFor={id} className="ms-2 text-sm text-text-ink">
          {label}
        </label>
      </div>
      {error && (
        <p id={errorId} className="mt-1 text-xs text-state-error">
          {error}
        </p>
      )}
    </div>
  )
}
