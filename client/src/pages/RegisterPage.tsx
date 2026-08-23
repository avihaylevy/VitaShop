import { useState, type FormEvent } from 'react'
import { TextLink, textLinkClass } from '../components/ui/TextLink'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { AuthCard, Field, FormError } from '../components/auth/AuthLayout'
import { PasswordField } from '../components/auth/PasswordField'
import { Icon } from '../components/ui/Icon'
import { CheckCircleIcon, UserIcon } from '../components/icons'
import signupHe from '../assets/brand/signup-he.jpg'
import signupEn from '../assets/brand/signup-en.jpg'
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
  const { t, i18n } = useTranslation('auth')

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
          <TextLink to="/login">
            {t('register.loginLink')}
          </TextLink>
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
    /* The signup redesign (2026-08-23, the user's mock): a two-panel card —
       the form beside the brand panel. The panel is PER-LANGUAGE artwork
       (logo, tagline and feature icons baked in — one image per language,
       the hero-banner pattern), decorative to assistive tech; the <h1>
       carries the page. Below md the panel is hidden: the form is the
       point on a phone. */
    <section
      aria-labelledby="register-title"
      className="mx-auto grid w-full max-w-5xl gap-0 overflow-hidden px-4 py-10 sm:py-14 md:grid-cols-2 md:rounded-card md:border md:border-border-card md:bg-well md:px-0 md:py-0"
    >
      <div className="md:p-8">
        <h1 id="register-title" className="heading-section">
          {t('register.title')}
        </h1>
      <form onSubmit={onSubmit} noValidate>
        {/* One row for the two names (the mock); each Field keeps its own
            error slot so a single missing name never shifts its sibling. */}
        <div className="grid gap-x-3 sm:grid-cols-2">
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
        </div>
        <Field
          label={t('register.emailLabel')}
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
          error={errorFor('EMAIL_INVALID')}
        />
        <PasswordField
          label={t('register.passwordLabel')}
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          error={
            errorFor('PASSWORD_TOO_SHORT') ??
            errorFor('PASSWORD_NEEDS_UPPERCASE') ??
            errorFor('PASSWORD_NEEDS_DIGIT') ??
            errorFor('PASSWORD_TOO_LONG')
          }
        >
          <PasswordChecklist password={password} />
        </PasswordField>
        <PasswordField
          label={t('register.confirmPasswordLabel')}
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
            className={textLinkClass({ inline: true })}
          >
            {t('register.termsReadLink')}
          </Link>
        </p>

        <FormError message={formMessage} />

        <Button type="submit" disabled={submitting} className="mt-2 w-full">
          <Icon size={18}>
            <UserIcon />
          </Icon>
          {submitting ? t('register.submitting') : t('register.submit')}
        </Button>
      </form>

      {/* The mock's divider — decorative; the login link is the content. */}
      <div aria-hidden="true" className="mt-6 flex items-center gap-3">
        <span className="h-px flex-1 bg-border-hairline" />
        <span className="text-sm text-text-muted">{t('register.orDivider')}</span>
        <span className="h-px flex-1 bg-border-hairline" />
      </div>

      <p className="mt-4 text-center text-sm text-text-muted">
        {t('register.hasAccount')}{' '}
        <TextLink to="/login" inline>
          {t('register.loginLink')}
        </TextLink>
      </p>
      </div>

      {/* The brand panel — per-language artwork; the FORM stays the
          start-side column (first in reading order) in both directions. */}
      <img
        src={i18n.language === 'he' ? signupHe : signupEn}
        alt=""
        className="hidden h-full w-full object-cover md:block"
      />
    </section>
  )
}

/**
 * The live requirements checklist — the REAL server policy (Table 3 field
 * 23: >= 8 characters, an uppercase letter, a digit), never the mock's
 * looser "any letter" wording: a checklist that green-ticks a password the
 * server rejects is worse than none. Each met rule turns teal and appends
 * an sr-only "done"; the icons are decorative.
 */
function PasswordChecklist({ password }: { password: string }) {
  const { t } = useTranslation('auth')
  const rules = [
    { key: 'req8', met: password.length >= 8 },
    { key: 'reqUpper', met: /[A-Z]/.test(password) },
    { key: 'reqDigit', met: /\d/.test(password) },
  ]
  return (
    <div className="mt-2 rounded-card bg-surface-section px-3 py-2">
      <p className="text-xs text-text-muted">{t('register.checklistTitle')}</p>
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {rules.map((rule) => (
          <li
            key={rule.key}
            className={`flex items-center gap-1.5 text-xs ${rule.met ? 'font-semibold text-brand-teal-strong' : 'text-text-muted'}`}
          >
            <Icon size={14} className={rule.met ? '' : 'opacity-40'}>
              <CheckCircleIcon />
            </Icon>
            {t(`register.${rule.key}`)}
            {rule.met && <span className="sr-only"> — {t('register.reqMet')}</span>}
          </li>
        ))}
      </ul>
    </div>
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
