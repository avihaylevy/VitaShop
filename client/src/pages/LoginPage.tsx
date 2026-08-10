import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { AuthCard, Field, FormError } from '../components/auth/AuthLayout'
import { Button } from '../components/ui/Button'
import { login, type AuthFailure } from '../lib/authApi'
import { useSession } from '../state/SessionContext'

/**
 * MILESTONE-006 Checkpoint H — the login form.
 *
 * 🔴 CLAUSE H2. A1 IS UNDONE BY A HELPFUL UI AS EASILY AS BY A HELPFUL API.
 * The server returns ONE failure for unknown email, wrong password, locked
 * account and disabled account. This form renders that one message and does
 * nothing to enrich it:
 *
 *   · it does NOT add "we couldn't find that email"
 *   · it does NOT check existence client-side, ever
 *   · it does NOT mark the EMAIL FIELD invalid on a failed login — styling
 *     one of the two fields as the culprit is the same disclosure as saying
 *     so in words, just quieter
 *
 * Format validation is fine; existence checking is not. The distinction is
 * that format is a fact about what was typed, existence is a fact about who
 * is registered.
 */
export function LoginPage() {
  const { t } = useTranslation('auth')
  const navigate = useNavigate()
  const { refresh } = useSession()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [failure, setFailure] = useState<AuthFailure | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setFailure(null)

    const result = await login(email, password)
    setSubmitting(false)

    if (result.ok) {
      // The header reads session state from the context; without this it
      // keeps showing "sign in" until a full reload.
      await refresh()
      void navigate('/')
      return
    }
    setFailure(result.failure)
  }

  // 🔴 One message for every credential failure, and H3's message for a 429 —
  // which says only "too many attempts", never which limit fired and never a
  // countdown, since a countdown that appears for some addresses and not
  // others is the disclosure the single message avoids.
  const message =
    failure === null
      ? undefined
      : failure.kind === 'rateLimited'
        ? t('errors.rateLimited')
        : failure.kind === 'network'
          ? t('errors.network')
          : t('login.failed')

  return (
    <AuthCard titleId="login-title" title={t('login.title')}>
      <form onSubmit={onSubmit} noValidate>
        <Field
          label={t('login.emailLabel')}
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
          // 🔴 No `error` prop, deliberately. See the H2 note above: marking
          // this field invalid on a failed login points at the email as the
          // problem, which is exactly what A1 refuses to say.
        />
        <Field
          label={t('login.passwordLabel')}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
        />

        <FormError message={message} />

        <Button type="submit" disabled={submitting} className="mt-2 w-full">
          {submitting ? t('login.submitting') : t('login.submit')}
        </Button>
      </form>

      <p className="mt-6 text-sm">
        <Link to="/forgot-password" className="text-brand-primary underline">
          {t('login.forgotPassword')}
        </Link>
      </p>
      <p className="mt-2 text-sm text-text-muted">
        {t('login.noAccount')}{' '}
        <Link to="/register" className="text-brand-primary underline">
          {t('login.registerLink')}
        </Link>
      </p>
    </AuthCard>
  )
}
