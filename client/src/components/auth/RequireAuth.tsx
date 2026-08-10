import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useSession } from '../../state/SessionContext'

/**
 * MILESTONE-006 clause A10 / REQ-F-034 — the gate.
 *
 * 🔴 WHAT IT MUST NOT DO IS THE POINT.
 *
 *   OPEN TO GUESTS: browsing · searching · filtering · sorting · product
 *                   details · adding to cart
 *   REQUIRES AUTH:  saving favourites · completing an order
 *
 * Registration is required for favourites and checkout ONLY. Nothing in this
 * milestone may put a login wall in front of the catalogue or the cart, and
 * the regression that matters is **the wall appearing where it should not** —
 * not the wall failing to appear. Guests browsing is the product working.
 *
 * 🔴 Neither favourites nor checkout exists yet (M-007 / M-008), so nothing
 * is wrapped in this today. It ships as the mechanism plus the test that it
 * does not over-apply, so the milestones that add those routes have something
 * to attach rather than inventing a gate under deadline.
 *
 * It renders a prompt rather than redirecting: a redirect loses the page the
 * user was trying to reach and, on a slow session check, would bounce an
 * authenticated user to the login form for a moment.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { t } = useTranslation('auth')
  const { status } = useSession()

  if (status === 'loading') {
    // Not a spinner: the check is a single request against a local server, and
    // a flash of "log in" for an authenticated user is worse than a beat of
    // nothing. `aria-busy` tells assistive tech the region is not yet settled.
    return <div aria-busy="true" />
  }

  if (status === 'guest') {
    return (
      <section className="mx-auto max-w-md px-4 py-12 text-center" aria-labelledby="auth-gate-title">
        <h1 id="auth-gate-title" className="text-lg font-semibold text-text-ink">
          {t('gate.title')}
        </h1>
        <p className="mt-2 text-sm text-text-muted">{t('gate.body')}</p>
        <Link
          to="/login"
          className="mt-6 inline-block text-sm font-medium text-brand-primary underline"
        >
          {t('gate.loginLink')}
        </Link>
      </section>
    )
  }

  return <>{children}</>
}
