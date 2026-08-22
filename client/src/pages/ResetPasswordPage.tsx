import { useState, type FormEvent } from 'react'
import { TextLink } from '../components/ui/TextLink'
import { useTranslation } from 'react-i18next'
import { AuthCard, Field, FormError } from '../components/auth/AuthLayout'
import { Button } from '../components/ui/Button'
import { completePasswordReset, type AuthFailure } from '../lib/authApi'
import { useUrlToken } from '../lib/useUrlToken'

/**
 * MILESTONE-006 Checkpoint H — choosing a new password. REQ-F-032, A4.
 *
 * 🔴 CLAUSE H1. The reset link arrives as `/reset-password?token=…`, so the
 * plaintext token is in the URL on arrival. `useUrlToken` captures it and
 * immediately removes it from the address bar via `history.replaceState`,
 * keeping it only in component state — see that module for why a URL is not a
 * private place to hold a credential.
 */
export function ResetPasswordPage() {
  const { t } = useTranslation('auth')
  const token = useUrlToken()

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [failure, setFailure] = useState<AuthFailure | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (submitting || token === null) return

    // The confirmation is checked here purely to save a round trip; the server
    // enforces it too (A11 / §3.4 — the client is not a source of truth).
    if (password !== confirmPassword) {
      setFailure({ kind: 'invalid', codes: ['PASSWORD_CONFIRMATION_MISMATCH'], fields: [] })
      return
    }

    setSubmitting(true)
    setFailure(null)
    const result = await completePasswordReset(token, password)
    setSubmitting(false)

    if (result.ok) {
      setDone(true)
      return
    }
    setFailure(result.failure)
  }

  // No token at all — the same state as a bad one. There is nothing to tell
  // apart and no reason to try.
  if (token === null) return <InvalidLink />

  if (done) {
    return (
      <AuthCard titleId="reset-done-title" title={t('resetPassword.done.title')}>
        {/* A8 destroyed every session, including this browser's, so "log in
            again" is a statement of fact rather than a suggestion. */}
        <p className="mt-3 text-sm text-text-muted">{t('resetPassword.done.body')}</p>
        <p className="mt-6 text-sm">
          <TextLink to="/login">
            {t('resetPassword.done.loginLink')}
          </TextLink>
        </p>
      </AuthCard>
    )
  }

  // 🔴 `failed` covers missing, expired, already-used and disabled — the
  // server refuses to distinguish them and neither does this.
  if (failure?.kind === 'failed') return <InvalidLink />

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
    <AuthCard titleId="reset-title" title={t('resetPassword.title')}>
      <form onSubmit={onSubmit} noValidate>
        <Field
          label={t('resetPassword.passwordLabel')}
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
          label={t('resetPassword.confirmPasswordLabel')}
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          error={errorFor('PASSWORD_CONFIRMATION_MISMATCH')}
        />

        <FormError message={formMessage} />

        <Button type="submit" disabled={submitting} className="mt-2 w-full">
          {submitting ? t('resetPassword.submitting') : t('resetPassword.submit')}
        </Button>
      </form>
    </AuthCard>
  )
}

function InvalidLink() {
  const { t } = useTranslation('auth')
  return (
    <AuthCard titleId="reset-invalid-title" title={t('resetPassword.invalid.title')}>
      <p className="mt-3 text-sm text-text-muted">{t('resetPassword.invalid.body')}</p>
      <p className="mt-6 text-sm">
        <TextLink to="/forgot-password">
          {t('resetPassword.invalid.requestNew')}
        </TextLink>
      </p>
    </AuthCard>
  )
}
