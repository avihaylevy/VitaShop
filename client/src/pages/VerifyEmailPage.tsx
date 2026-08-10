import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { AuthCard } from '../components/auth/AuthLayout'
import { verifyEmail } from '../lib/authApi'
import { useUrlToken } from '../lib/useUrlToken'

type VerifyState = 'pending' | 'verified' | 'invalid'

/**
 * MILESTONE-006 Checkpoint H — email verification. REQ-F-031.
 *
 * 🔴 CLAUSE H1, same as the reset page: the link arrives as
 * `/verify-email?token=…`, so `useUrlToken` reads the token and strips it
 * from the address bar immediately.
 *
 * The token is spent on mount. That is a side effect on render, which is
 * usually a smell — but a verification link IS a one-click action, and
 * putting a "verify" button behind it would only add a step that every user
 * completes. The `hasRun` ref keeps StrictMode's double-mount from spending
 * the token twice, which would show "invalid" to a user whose verification
 * actually succeeded.
 */
export function VerifyEmailPage() {
  const { t } = useTranslation('auth')
  const token = useUrlToken()
  const [state, setState] = useState<VerifyState>(token === null ? 'invalid' : 'pending')
  const hasRun = useRef(false)

  useEffect(() => {
    if (token === null || hasRun.current) return
    hasRun.current = true

    let cancelled = false
    void verifyEmail(token).then((result) => {
      if (cancelled) return
      // Every failure looks the same: expired, already used, unknown, and a
      // disabled account all return the server's one generic refusal.
      setState(result.ok ? 'verified' : 'invalid')
    })
    return () => {
      cancelled = true
    }
  }, [token])

  if (state === 'pending') {
    return (
      <AuthCard titleId="verify-pending-title" title={t('verifyEmail.pending')}>
        {/* aria-busy rather than a spinner: the wait is one request. */}
        <div aria-busy="true" />
      </AuthCard>
    )
  }

  if (state === 'verified') {
    return (
      <AuthCard titleId="verify-success-title" title={t('verifyEmail.success.title')}>
        <p className="mt-3 text-sm text-text-muted">{t('verifyEmail.success.body')}</p>
        <p className="mt-6 text-sm">
          <Link to="/login" className="text-brand-primary underline">
            {t('verifyEmail.success.loginLink')}
          </Link>
        </p>
      </AuthCard>
    )
  }

  return (
    <AuthCard titleId="verify-invalid-title" title={t('verifyEmail.invalid.title')}>
      <p className="mt-3 text-sm text-text-muted">{t('verifyEmail.invalid.body')}</p>
    </AuthCard>
  )
}
