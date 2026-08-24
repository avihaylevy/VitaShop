import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { TextLink } from '../components/ui/TextLink'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { Field, FormError } from '../components/auth/AuthLayout'
import { PasswordField } from '../components/auth/PasswordField'
import { Logo } from '../components/brand/Logo'
import { Icon } from '../components/ui/Icon'
import { CheckCircleIcon } from '../components/icons'
import { Button } from '../components/ui/Button'
import { login, type AuthFailure } from '../lib/authApi'
import { isCartMergeReport } from '../lib/cartApi'
import { useSession } from '../state/SessionContext'
import { useCart } from '../state/CartContext'
import type { CartMergeReport } from '../types/cart'

/**
 * MILESTONE-006 Checkpoint H — the login form.
 * Redesigned 2026-08-25 to the user's mock, re-shaped twice on their
 * feedback (the two-panel side layout read as "same design as two other
 * pages"; the flat band "still not looking good"). The shipped shape is
 * ONE centered card whose header is the design: a warm-cream crown (the
 * user's swatch — the surface-section token) ending in a shallow PEDESTAL
 * CURVE (the home hero's ellipse language), the brand mark in a white
 * medallion straddling the curve, ברוכים הבאים in display ink, the user's
 * sentence, and the three benefits as CAPSULE PILLS — the supplement-shop
 * wink. Form below, quiet. All copy live i18n; no image asset. (An earlier
 * teal-gradient crown was rejected by the user — don't reintroduce it.)
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

/**
 * The one-card shell, shared by the form and the merge-report state so the
 * card never changes shape mid-flow. The header is real content (the <h1>
 * lives in it), never a decorative panel. The pedestal curve is drawn with
 * an asymmetric border-radius on the teal block — the white card ground
 * showing through the rounded bottom corners IS the curve; no SVG, no
 * pseudo-element, so it mirrors trivially and costs nothing.
 */
function LoginShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation(['auth', 'common'])
  return (
    <section aria-labelledby="login-title" className="mx-auto w-full max-w-md px-4 py-4 sm:max-w-lg sm:py-5">
      {/* No at-rest shadow — DESIGN_SYSTEM §3 / DEC-041 reserve elevation
          for transient hover/focus states; the border carries the edge. */}
      <div className="overflow-hidden rounded-card border border-border-card bg-well">
        {/* The crown — the user's swatch is the system's warm cream
            (surface-section), so the crown wears that token with ink text
            and a sunken-tone highlight circle, ending in the pedestal
            curve. pb accounts for the medallion overlapping below. */}
        <div
          className="relative bg-surface-section px-6 pb-9 pt-4 text-center"
          style={{ borderRadius: '0 0 50% 50% / 0 0 26px 26px' }}
        >
          {/* The clip wrapper carries the SAME border-radius as the crown:
              a rectangular clip let the circle paint over the corner where
              the white ground draws the curve (caught by review — measured
              circle bottom 259px vs crown bottom 249px). */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 overflow-hidden"
            style={{ borderRadius: '0 0 50% 50% / 0 0 26px 26px' }}
          >
            <div className="absolute -top-14 -end-10 size-44 rounded-full bg-surface-sunken/70" />
          </div>
          <p className="relative font-display text-base font-medium text-brand-teal-strong">
            {t('app.name', { ns: 'common' })}
          </p>
          <h1 id="login-title" className="relative mt-0.5 font-display text-2xl font-semibold text-text-ink">
            {t('login.welcomeTitle')}
          </h1>
        </div>
        {/* The medallion — the transparent mark in a white disc straddling
            the curve. Decorative (the wordmark above already names the
            brand); Logo's own alt is suppressed by the aria-hidden span. */}
        <span
          aria-hidden="true"
          className="relative z-10 mx-auto -mt-9 flex size-16 items-center justify-center rounded-full border border-border-card bg-well motion-safe:animate-[hero-shelf-rise_.45s_ease-out_both]"
        >
          <Logo variant="mark" size={42} />
        </span>
        <div className="px-6 pb-5 pt-2">{children}</div>
      </div>
    </section>
  )
}

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
  /**
   * 🔴 The unmount-takes-focus family (browser-verification.md): swapping the
   * form for the report unmounts the focused submit button, and a status
   * region that mounts WITH its content is not announced. Moving focus to
   * the report container makes the outcome both reachable and read aloud.
   */
  const reportRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (mergeReport) reportRef.current?.focus()
  }, [mergeReport])

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
      <LoginShell>
        {/* One region, polite: this is a report, not an error to interrupt
            with. tabIndex -1 so the effect above can land focus here after
            the form (and its focused submit button) unmounts. */}
        <div
          role="status"
          ref={reportRef}
          tabIndex={-1}
          className="mt-4 flex flex-col gap-3 text-sm text-text-ink outline-none"
        >
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
      </LoginShell>
    )
  }

  return (
    <LoginShell>
      <p className="mx-auto max-w-md text-center text-sm text-text-muted">
        {t('login.welcomeBody')}
      </p>
      {/* The three benefits as capsule pills — flat text in the mock, given
          the shop's own shape here. Soft teal fill, strong-teal ink
          (measured family: brand-teal-strong on the /10 wash ≥7:1). */}
      <ul className="mt-3 flex flex-wrap justify-center gap-2">
        {(['bullet1', 'bullet2', 'bullet3'] as const).map((key, index) => (
          <li
            key={key}
            className="flex items-center gap-1 rounded-round bg-brand-teal/10 px-2.5 py-1.5 text-xs font-medium text-brand-teal-strong motion-safe:animate-[hero-shelf-rise_.45s_ease-out_both]"
            style={{ animationDelay: `${90 + index * 70}ms` }}
          >
            <Icon size={14} className="shrink-0 text-brand-teal">
              <CheckCircleIcon />
            </Icon>
            {t(`login.${key}`)}
          </li>
        ))}
      </ul>
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
        <PasswordField
          label={t('login.passwordLabel')}
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
        />
        {/* The mock places forgot-password directly under the field, on the
            inline-end side — logical alignment, so it mirrors in RTL. */}
        <p className="mt-1 text-end text-sm">
          <TextLink to="/forgot-password">
            {t('login.forgotPassword')}
          </TextLink>
        </p>

        <FormError message={message} />

        <Button type="submit" disabled={submitting} className="mt-2 w-full">
          {submitting ? t('login.submitting') : t('login.submit')}
        </Button>
      </form>

      {/* The mock's divider — decorative; the register link is the content. */}
      <div aria-hidden="true" className="mt-4 flex items-center gap-3">
        <span className="h-px flex-1 bg-border-hairline" />
        <span className="text-sm text-text-muted">{t('login.orDivider')}</span>
        <span className="h-px flex-1 bg-border-hairline" />
      </div>

      <p className="mt-2 text-center text-sm text-text-muted">
        {t('login.noAccount')}{' '}
        <TextLink to="/register" inline>
          {t('login.registerLink')}
        </TextLink>
      </p>
    </LoginShell>
  )
}
