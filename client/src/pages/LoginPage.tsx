import { useState, type FormEvent } from 'react'
import { TextLink } from '../components/ui/TextLink'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { AuthCard, Field, FormError } from '../components/auth/AuthLayout'
import { Button } from '../components/ui/Button'
import { login, type AuthFailure } from '../lib/authApi'
import { isCartMergeReport } from '../lib/cartApi'
import { useSession } from '../state/SessionContext'
import { useCart } from '../state/CartContext'
import type { CartMergeReport } from '../types/cart'

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
  const { t, i18n } = useTranslation('auth')
  const { t: tCart } = useTranslation('cart')
  const navigate = useNavigate()
  const { refresh } = useSession()
  const { refresh: refreshCart, cart } = useCart()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [failure, setFailure] = useState<AuthFailure | null>(null)
  const [submitting, setSubmitting] = useState(false)
  /**
   * 🔴 WHAT LOGIN DID TO THE GUEST CART, when it did anything the shopper did
   * not ask for. MILESTONE-007 Checkpoint F merges a guest cart into the
   * account cart at login, and §7.15 decided that a merge FAILURE is caught so
   * it cannot lock anyone out — but reported, never swallowed.
   *
   * Navigation is held only when there is a LOSS to report (a failure, a
   * clamp, or a dropped line). A clean merge changes nothing the shopper would
   * be surprised by, so it navigates exactly as before.
   */
  const [mergeReport, setMergeReport] = useState<CartMergeReport | null>(null)

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
      // 🔴 The cart identity changed with the session — the account's cart is
      // now the cart. Without this the badge keeps showing the guest count.
      await refreshCart()

      const report = isCartMergeReport(result.value.cart) ? result.value.cart : null
      const lostSomething =
        report !== null &&
        (report.mergeFailed || report.clampedSlugs.length > 0 || report.dropped.length > 0)

      if (lostSomething) {
        // Held here on purpose. Navigating away would leave the shopper to
        // discover the change by noticing a missing line later, which is the
        // silent loss the server's report exists to prevent.
        setMergeReport(report)
        return
      }

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

  /**
   * A clamped product is still IN the cart, so its name is resolvable from the
   * refreshed cart. A DROPPED one is not — it was removed — which is why the
   * server now sends the names WITH the report (ISSUE-073): before that, the
   * shopper was shown the slug itself. The slug remains the last resort for a
   * report that somehow arrived without names — better machine-readable truth
   * than an invented name or silence.
   */
  const nameForSlug = (slug: string) => {
    const line = cart.items.find((item) => item.slug === slug)
    return line ? (i18n.language === 'he' ? line.nameHe : line.nameEn) : slug
  }
  const nameForDropped = (entry: { slug: string; nameHe?: string; nameEn?: string }) => {
    // Type-checked AT USE, not at the transport guard — a malformed name must
    // cost the shopper the name, never the report (review finding).
    const name = i18n.language === 'he' ? entry.nameHe : entry.nameEn
    return typeof name === 'string' && name.trim() !== '' ? name : nameForSlug(entry.slug)
  }

  if (mergeReport) {
    const inactive = mergeReport.dropped.filter((entry) => entry.reason === 'INACTIVE')
    const unavailable = mergeReport.dropped.filter((entry) => entry.reason === 'UNAVAILABLE')

    return (
      <AuthCard titleId="login-title" title={t('login.title')}>
        {/* One region, polite: this is a report, not an error to interrupt with. */}
        <div role="status" className="flex flex-col gap-3 text-sm text-text-ink">
          {mergeReport.mergeFailed && <p className="text-state-error">{tCart('merge.failed')}</p>}
          {mergeReport.merged && !mergeReport.mergeFailed && <p>{tCart('merge.merged')}</p>}
          {mergeReport.clampedSlugs.length > 0 && (
            <p>{tCart('merge.clamped', { products: mergeReport.clampedSlugs.map(nameForSlug).join(', ') })}</p>
          )}
          {inactive.length > 0 && (
            <p>{tCart('merge.droppedInactive', { products: inactive.map(nameForDropped).join(', ') })}</p>
          )}
          {unavailable.length > 0 && (
            <p>
              {tCart('merge.droppedUnavailable', {
                products: unavailable.map(nameForDropped).join(', '),
              })}
            </p>
          )}
        </div>

        <Button className="mt-6 w-full" onClick={() => void navigate('/cart')}>
          {tCart('drawer.goToCart')}
        </Button>
        <p className="mt-2 text-sm">
          <TextLink to="/catalog">
            {tCart('page.backToCatalog')}
          </TextLink>
        </p>
      </AuthCard>
    )
  }

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
        <TextLink to="/forgot-password">
          {t('login.forgotPassword')}
        </TextLink>
      </p>
      <p className="mt-2 text-sm text-text-muted">
        {t('login.noAccount')}{' '}
        <TextLink to="/register" inline>
          {t('login.registerLink')}
        </TextLink>
      </p>
    </AuthCard>
  )
}
