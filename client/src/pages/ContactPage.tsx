import { useId, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Field, FormError } from '../components/auth/AuthLayout'
import { Button } from '../components/ui/Button'
import { FOCUS_RING } from '../components/ui/focusRing'

/**
 * ISSUE-125 — the יצירת קשר page, MOCK BY THE USER'S INSTRUCTION: the form
 * renders and validates, and submits NOWHERE — no email service, no API
 * key (DEC-014 untouched). The named reference sites informed the LAYOUT
 * only (a short intro over a narrow labelled form); nothing of their
 * branding is copied (DESIGN_BRIEF's anti-copy rule).
 *
 * 🔴 The received-state contract (the unmount-takes-focus family):
 * submitting NEVER unmounts the form or the button — the confirmation is
 * an ALWAYS-mounted polite region above the form, the fields clear, and
 * focus stays exactly where the user left it. No invented contact details
 * (address/phone/email) — details the mock store does not have are
 * details the page does not show.
 */
export function ContactPage() {
  const { t } = useTranslation('info')
  const titleId = useId()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [errors, setErrors] = useState<{ name?: string; email?: string; message?: string }>({})
  const [received, setReceived] = useState(false)
  const hasErrors = Object.keys(errors).length > 0

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const next: typeof errors = {}
    if (name.trim().length === 0) next.name = t('contact.errorRequired')
    if (email.trim().length === 0) next.email = t('contact.errorRequired')
    // Contact-ONLY shallow shape-check: the auth forms do no client-side
    // email validation (the server decides there), but this mock form HAS
    // no server, so the shallow check is its only guard. It says "this
    // does not look like an address", nothing stronger.
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) next.email = t('contact.errorEmail')
    if (message.trim().length === 0) next.message = t('contact.errorRequired')

    setErrors(next)
    if (Object.keys(next).length > 0) {
      setReceived(false)
      return
    }

    // 🔴 MOCK: nothing is sent anywhere, by instruction.
    // flushSync empties the status region in its OWN commit first: a live
    // region announces on TEXT CHANGE, and a second successful submit
    // re-setting `true` over `true` would render byte-identical text —
    // silence (review of this diff; the class AdminOrdersPage's tests
    // document). Clearing-then-setting produces a change every time.
    flushSync(() => setReceived(false))
    setReceived(true)
    setName('')
    setEmail('')
    setMessage('')
  }

  return (
    <div className="px-7 py-8">
      <section aria-labelledby={titleId} className="mx-auto max-w-xl">
        <h1 id={titleId} className="heading-page">
          {t('contact.title')}
        </h1>
        <p className="mt-3 text-base text-text-muted">{t('contact.intro')}</p>

        {/* Always mounted — announces the received state politely without
            interrupting, and never appears at the same moment as its text. */}
        <p role="status" className="mt-4 min-h-[1.25rem] text-sm font-medium text-brand-teal">
          {received ? t('contact.received') : ''}
        </p>

        <form onSubmit={onSubmit} noValidate>
          <Field
            label={t('contact.nameLabel')}
            autoComplete="name"
            value={name}
            onChange={setName}
            error={errors.name}
          />
          <Field
            label={t('contact.emailLabel')}
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={setEmail}
            error={errors.email}
          />
          <MessageField
            label={t('contact.messageLabel')}
            value={message}
            onChange={setMessage}
            error={errors.message}
          />

          {/* The auth forms' assertive form-level region — a failed submit
              re-renders in place with no focus change, so without this a
              screen-reader user is told NOTHING (review of this diff). */}
          <FormError message={hasErrors ? t('contact.errorSummary') : undefined} />

          <Button type="submit" variant="primary" className="mt-4">
            {t('contact.submit')}
          </Button>
        </form>
      </section>
    </div>
  )
}

/**
 * The textarea sibling of AuthLayout's Field — same association contract
 * (htmlFor/id, aria-describedby, --border-control), just multiline. Kept
 * here because this page is its only consumer.
 */
function MessageField({
  label,
  value,
  onChange,
  error,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
}) {
  const id = useId()
  const errorId = error ? `${id}-error` : undefined

  return (
    <div className="mt-4">
      <label htmlFor={id} className="block text-sm font-medium text-text-ink">
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        required
        rows={5}
        aria-describedby={errorId}
        aria-invalid={error ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
        // rounded-compact + FOCUS_RING: the same radius and ring source as
        // the Input two fields up — a textarea with a different corner or a
        // string-literal ring is exactly the drift focusRing.ts warns about.
        className={`${FOCUS_RING} mt-1 block w-full resize-y rounded-compact border border-border-control bg-well px-3 py-2 text-base text-text-ink placeholder:text-text-muted`}
      />
      {error && (
        <p id={errorId} className="mt-1 text-xs text-state-error">
          {error}
        </p>
      )}
    </div>
  )
}
