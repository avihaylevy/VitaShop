import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { AuthCard, Field, FormError } from '../components/auth/AuthLayout'
import { Button } from '../components/ui/Button'
import { requestPasswordReset, type AuthFailure } from '../lib/authApi'

/**
 * MILESTONE-006 Checkpoint H — requesting a password reset. REQ-F-032, A3.
 *
 * 🔴 CLAUSE H2 / A3. The server returns the SAME 200 whether or not the
 * address exists, and this page renders the SAME confirmation either way.
 *
 * The tempting change is a kindness: "no account with that address, check for
 * a typo". It is also an account-enumeration oracle available to anyone, with
 * no password guess required — which is why A3 exists, and why the copy below
 * is deliberately conditional in tone ("if an account exists…") rather than
 * asserting that anything was sent.
 */
export function ForgotPasswordPage() {
  const { t } = useTranslation('auth')

  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [failure, setFailure] = useState<AuthFailure | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setFailure(null)

    const result = await requestPasswordReset(email)
    setSubmitting(false)

    if (result.ok) {
      setSent(true)
      return
    }
    setFailure(result.failure)
  }

  if (sent) {
    return (
      <AuthCard titleId="forgot-sent-title" title={t('forgotPassword.sent.title')}>
        <p className="mt-3 text-sm text-text-muted">{t('forgotPassword.sent.body')}</p>
        <p className="mt-6 text-sm">
          <Link to="/login" className="text-brand-primary underline">
            {t('forgotPassword.backToLogin')}
          </Link>
        </p>
      </AuthCard>
    )
  }

  // 🔴 A 429 here is the ONE case that differs from the success path, and it
  // still says nothing about the address — only that too many attempts were
  // made. No countdown: the reset limiter is email-keyed, so a countdown that
  // appeared for some addresses and not others would leak exactly what A3
  // hides.
  const message =
    failure === null
      ? undefined
      : failure.kind === 'rateLimited'
        ? t('errors.rateLimited')
        : failure.kind === 'network'
          ? t('errors.network')
          : t('errors.unexpected')

  return (
    <AuthCard titleId="forgot-title" title={t('forgotPassword.title')}>
      <p className="mt-3 text-sm text-text-muted">{t('forgotPassword.intro')}</p>

      <form onSubmit={onSubmit} noValidate>
        <Field
          label={t('forgotPassword.emailLabel')}
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
        />

        <FormError message={message} />

        <Button type="submit" disabled={submitting} className="mt-2 w-full">
          {submitting ? t('forgotPassword.submitting') : t('forgotPassword.submit')}
        </Button>
      </form>

      <p className="mt-6 text-sm">
        <Link to="/login" className="text-brand-primary underline">
          {t('forgotPassword.backToLogin')}
        </Link>
      </p>
    </AuthCard>
  )
}
