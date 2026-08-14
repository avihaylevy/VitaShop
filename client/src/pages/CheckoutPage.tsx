import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/ui/Button'
import { FOCUS_RING } from '../components/ui/focusRing'
import { PriceBlock } from '../components/catalog/PriceBlock'
import { payForCheckout, requestCheckoutQuote } from '../lib/checkoutApi'
import { newIdempotencyKey } from '../lib/idempotencyKey'
import { requestShopperProfile } from '../lib/accountApi'
import type { ShopperProfile } from '../types/account'
import {
  DELIVERY_METHOD_NAMES,
  type CheckoutQuote,
  type CheckoutQuoteFailure,
  type DeliveryEstimate,
  type DeliveryMethodName,
  type PaymentFailure,
  type PaymentSuccess,
} from '../types/checkout'

/**
 * MILESTONE-008 Checkpoint F2a — the checkout screen's FIRST half: choosing
 * how the order arrives, and seeing what it costs.
 *
 * 🔴 WHAT THIS SCREEN DOES NOT DO YET. No address form, no confirmation gate,
 * no payment — F2b and F2c. The quote's `fingerprint` is held in state from
 * the moment it arrives because DEC-060 requires `/pay` to receive the SAME
 * one the shopper was shown; capturing it here rather than re-fetching it at
 * submit time is the whole point of the gate.
 *
 * 🔴 EVERY FIGURE IS THE SERVER'S. The screen renders `basis`, the shipping
 * cost and `totalAmount` as strings. It never adds them, and a shopper
 * changing the delivery method triggers a NEW QUOTE rather than a local
 * recalculation — §3.4, and the reason `/validate` exists as a read at all.
 */

function estimateText(
  estimate: DeliveryEstimate,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  return estimate.kind === 'ready_within'
    ? t('delivery.readyWithin', { days: estimate.businessDays })
    : t('delivery.deliveredBetween', {
        min: estimate.minBusinessDays,
        max: estimate.maxBusinessDays,
      })
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; quote: CheckoutQuote }
  | { status: 'failed'; failure: CheckoutQuoteFailure }

export function CheckoutPage() {
  const { t, i18n } = useTranslation('checkout')
  const legendId = useId()
  /**
   * ⚠️ `courier` is the initial CHOICE, not a default the server assumes. The
   * server requires an explicit method on every quote; `lib/shipping.ts`'s own
   * default exists for the pre-checkout surfaces, and this screen must never
   * rely on it.
   */
  const [method, setMethod] = useState<DeliveryMethodName>('courier')
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  /**
   * 🔴 THE LAST REQUEST WINS, NOT THE LAST RESPONSE.
   *
   * Toggling courier → self pickup quickly puts two quotes in flight, and the
   * courier one can settle second. Without this the screen showed ₪30 shipping
   * and the courier total beside a checked self-pickup radio — and the held
   * fingerprint belonged to the method the shopper had NOT chosen, so F2c's
   * `/pay` would refuse with a mismatch the shopper could not account for.
   *
   * A counter rather than an AbortController: the request is a cheap read, and
   * what matters is which answer is allowed to reach the screen. The same
   * staleness rule the catalogue settled at §9b — an expected cancellation is
   * not a result.
   */
  const requestId = useRef(0)

  /**
   * REQ-F-041's pre-fill. 🔴 A PROFILE THAT FAILS TO LOAD MUST NOT BLOCK
   * CHECKOUT — it is a convenience, and the shopper can type the same details.
   * Only `unauthenticated` matters, and the quote below reports that anyway.
   *
   * ⚠️ `defaultAddress` is null for every real shopper today: nothing writes an
   * `Address` row (ISSUE-093). The name and phone arrive; the address does not,
   * and the form says so rather than looking mysteriously empty.
   */
  /*
   * 🔴 THREE STATES, NOT A BOOLEAN. `profileLoaded` plus a null profile said
   * "no address is saved on your account" to every shopper whose profile
   * request FAILED — a 503, a 429 from the profile limiter, a dropped
   * connection — including shoppers who do have one. "We could not load it"
   * and "there is none" are different sentences and different truths.
   */
  const [profileState, setProfileState] = useState<
    { status: 'loading' } | { status: 'ready'; profile: ShopperProfile } | { status: 'unavailable' }
  >({ status: 'loading' })
  const [address, setAddress] = useState({ line1: '', city: '', zipCode: '' })
  /*
   * 🔴 VALIDATION FIRES ON BLUR, NOT ON A SUBMIT THAT DOES NOT EXIST YET. The
   * first version held a `showErrors` flag whose only setter would have been
   * F2c's "continue to payment" button — dead state, and `tsc` said so. A
   * field the shopper has left is a real trigger available today.
   *
   * ⚠️ This is DISPLAY ONLY. `addressProblem` on the server is the rule that
   * decides, and it refuses the order regardless of what this form thinks.
   */
  const [touched, setTouched] = useState<{ line1: boolean; city: boolean }>({
    line1: false,
    city: false,
  })

  const [saveAddress, setSaveAddress] = useState(false)
  const [outcome, setOutcome] = useState<'success' | 'failure'>('success')
  const [payState, setPayState] = useState<
    | { status: 'idle' }
    | { status: 'paying' }
    | { status: 'done'; order: PaymentSuccess }
    | { status: 'failed'; failure: PaymentFailure }
  >({ status: 'idle' })

  /**
   * 🔴 ONE KEY PER CHECKOUT ATTEMPT, HELD IN A REF — INV-05's client half.
   * Regenerating it per press would turn a retried payment into a second
   * order; the server answers a seen key from the stored order, which is the
   * only reason a dropped connection is recoverable here.
   */
  const idempotencyKey = useRef(newIdempotencyKey())

  useEffect(() => {
    let live = true
    void requestShopperProfile().then((result) => {
      if (!live) return
      if (!result.ok) {
        setProfileState({ status: 'unavailable' })
        return
      }
      setProfileState({ status: 'ready', profile: result.profile })
      const saved = result.profile.defaultAddress
      if (!saved) return
      /*
       * 🔴 NEVER OVERWRITE WHAT THE SHOPPER HAS ALREADY TYPED. The profile
       * resolves asynchronously; a shopper who starts typing a street while it
       * is in flight had their words replaced by the saved address.
       *
       * ⚠️ LATENT TODAY ONLY BECAUSE `defaultAddress` IS ALWAYS NULL
       * (ISSUE-093). It goes live the moment F2c starts persisting addresses,
       * which is precisely when nobody would be looking for it.
       */
      setAddress((current) =>
        current.line1 === '' && current.city === '' && current.zipCode === ''
          ? { line1: saved.line1, city: saved.city, zipCode: saved.zipCode ?? '' }
          : current,
      )
    })
    return () => {
      live = false
    }
  }, [])

  const load = useCallback(async (next: DeliveryMethodName) => {
    const id = ++requestId.current
    setState({ status: 'loading' })
    const result = await requestCheckoutQuote(next)
    if (id !== requestId.current) return
    setState(result.ok ? { status: 'ready', quote: result.quote } : { status: 'failed', failure: result.failure })
  }, [])

  useEffect(() => {
    void load(method)
  }, [load, method])

  async function confirmAndPay(quote: CheckoutQuote) {
    setPayState({ status: 'paying' })
    const result = await payForCheckout({
      // 🔴 THE FINGERPRINT THE SHOPPER WAS SHOWN, unchanged. DEC-060's gate
      // compares it against one re-derived from live data.
      fingerprint: quote.fingerprint,
      deliveryMethod: quote.deliveryMethod,
      address: quote.deliveryMethod === 'self_pickup' ? null : { ...address, zipCode: address.zipCode || null },
      idempotencyKey: idempotencyKey.current,
      simulatedOutcome: outcome,
      saveAddress,
    })

    if (result.ok) {
      setPayState({ status: 'done', order: result.order })
      return
    }

    /*
     * 🔴 THE GATE REFUSING IS NOT AN ERROR STATE — it is a NEW QUOTE to
     * confirm. REQ-F-042 requires the updated figures to be shown; the
     * refusal carried them, so they replace what is on screen and the next
     * press sends the new fingerprint.
     */
    if (result.failure.kind === 'changed') {
      setState({ status: 'ready', quote: result.failure.quote })
    }
    setPayState({ status: 'failed', failure: result.failure })
  }

  /*
   * 🔴 THE CONFIRMATION REPLACES THE FORM ENTIRELY. Leaving the pay button on
   * screen beside a placed order invites a second press, and the order number
   * is the one thing the shopper keeps.
   */
  if (payState.status === 'done') {
    return (
      <main className="mx-auto flex max-w-[900px] flex-col gap-4 px-4 py-6">
        <h1 className="text-2xl font-semibold text-text-ink">{t('done.heading')}</h1>
        <p className="text-lg font-semibold text-text-ink" dir="ltr">
          {t('done.orderNumber', { number: payState.order.orderNumber })}
        </p>
        <p className="flex flex-wrap items-baseline gap-1.5 text-sm">
          <span className="text-text-muted">{t('done.total')}</span>
          <PriceBlock price={payState.order.totalAmount} />
        </p>
        <p className="text-sm text-text-muted">{estimateText(payState.order.estimate, t)}</p>
        {/*
          🔴 A REPLAY IS A CONFIRMATION, AND IT SAYS SO. §8.12 records the
          opposite defect four times: a retry told the shopper the order
          failed, for an order that existed. This says the order exists AND
          that nothing was charged twice.
        */}
        {payState.order.replayed && (
          <p className="text-sm text-text-ink">{t('done.replayed')}</p>
        )}
        <Link to="/catalog" className={`${FOCUS_RING} rounded-card text-sm text-brand-teal underline`}>
          {t('done.backToCatalog')}
        </Link>
      </main>
    )
  }

  return (
    <main className="mx-auto flex max-w-[900px] flex-col gap-6 px-4 py-6">
      <h1 className="text-2xl font-semibold text-text-ink">{t('page.title')}</h1>

      <fieldset className="min-w-0 border-0 p-0">
        <legend id={legendId} className="mb-2 text-sm font-semibold text-text-ink">
          {t('delivery.legend')}
        </legend>
        <div className="flex flex-col gap-2">
          {DELIVERY_METHOD_NAMES.map((name) => (
            <label key={name} className="flex min-h-11 items-center gap-2 text-sm text-text-ink">
              <input
                type="radio"
                name="deliveryMethod"
                value={name}
                /*
                 * ⚠️ THE LOCAL INTENT, and the review asked for the quote's
                 * method instead. I wrote that, then MUTATION-TESTED it: with
                 * the request-id guard above in place, no test could tell the
                 * two apart, and no scenario can either — a stale answer never
                 * reaches `ready`, and while one is in flight the state is
                 * `loading`, which falls back to this value anyway.
                 *
                 * 🔴 So the guard is the fix and this is not a second one. An
                 * unreachable branch that READS as load-bearing is the exact
                 * shape this project keeps being bitten by, so it is not kept
                 * for appearances. If the two can ever disagree again — a
                 * server that answers with a different method than it was
                 * asked for — that is a new case and it needs its own test.
                 */
                checked={method === name}
                onChange={() => {
                  setMethod(name)
                  /*
                   * ⚠️ The fieldset unmounts but its VALUES would survive, so
                   * F2c would inherit a form holding an address for a method
                   * the server refuses with ADDRESS_NOT_ALLOWED.
                   */
                  if (name === 'self_pickup') {
                    setAddress({ line1: '', city: '', zipCode: '' })
                    setTouched({ line1: false, city: false })
                  }
                }}
                className={`${FOCUS_RING} size-4 shrink-0 accent-brand-teal`}
              />
              <span>{t(`delivery.${name}`)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/*
        🔴 SELF PICKUP TAKES NO ADDRESS AT ALL, and this is not cosmetic: the
        server answers ADDRESS_NOT_ALLOWED if one is sent with it, exactly as
        it answers ADDRESS_REQUIRED when one is missing for the other two.
        `addressProblem` is the single rule; this mirrors it for display only.
      */}
      {method === 'self_pickup' ? (
        <p className="text-sm text-text-muted">{t('address.notNeeded')}</p>
      ) : (
        <fieldset className="min-w-0 border-0 p-0">
          <legend className="mb-2 text-sm font-semibold text-text-ink">{t('address.legend')}</legend>

          {/*
            🔴 THE NAME AND PHONE ARE NOW RENDERED. They were fetched, stored
            and read only as a boolean, while two comments claimed the pre-fill
            "delivers the NAME and PHONE today". A comment describing behaviour
            that does not exist is the shape this project keeps being bitten by.
          */}
          {profileState.status === 'ready' && (
            <p className="mb-1 text-xs text-text-muted">
              {t('address.deliveringTo', {
                name: `${profileState.profile.firstName} ${profileState.profile.lastName}`.trim(),
              })}
              {profileState.profile.phone
                ? ` · ${t('address.contactPhone', { phone: profileState.profile.phone })}`
                : ''}
            </p>
          )}

          {profileState.status !== 'loading' && (
            <p className="mb-2 text-xs text-text-muted">
              {profileState.status === 'unavailable'
                ? t('address.unavailable')
                : profileState.profile.defaultAddress
                  ? t('address.prefilled')
                  : t('address.noSavedAddress')}
            </p>
          )}

          <div className="flex flex-col gap-3">
            {/*
              🔴 THE ERROR SITS OUTSIDE THE <label>, and that placement is the
              fix, not a tidy-up. Inside it, the message became part of the
              input's ACCESSIBLE NAME: a screen reader announced the field as
              "City Enter a city." and the error was never announced AS an
              error. It is now linked with `aria-describedby` and lives in a
              `role="alert"` region, so it is announced when it appears.
            */}
            <div className="flex flex-col gap-1 text-sm">
              <label htmlFor={`${legendId}-line1`} className="text-text-ink">
                {t('address.line1')}
              </label>
              <input
                id={`${legendId}-line1`}
                name="line1"
                type="text"
                autoComplete="address-line1"
                required
                aria-required="true"
                value={address.line1}
                onChange={(event) => setAddress((a) => ({ ...a, line1: event.target.value }))}
                onBlur={() => setTouched((current) => ({ ...current, line1: true }))}
                aria-invalid={touched.line1 && address.line1.trim() === ''}
                aria-describedby={
                  touched.line1 && address.line1.trim() === '' ? `${legendId}-line1-error` : undefined
                }
                className={`${FOCUS_RING} h-11 rounded-card border border-border-control bg-well px-3`}
              />
              <span id={`${legendId}-line1-error`} role="alert" className="text-xs text-state-error">
                {touched.line1 && address.line1.trim() === '' ? t('address.line1Required') : ''}
              </span>
            </div>

            <div className="flex flex-col gap-1 text-sm">
              <label htmlFor={`${legendId}-city`} className="text-text-ink">
                {t('address.city')}
              </label>
              <input
                id={`${legendId}-city`}
                name="city"
                type="text"
                autoComplete="address-level2"
                required
                aria-required="true"
                value={address.city}
                onChange={(event) => setAddress((a) => ({ ...a, city: event.target.value }))}
                onBlur={() => setTouched((current) => ({ ...current, city: true }))}
                aria-invalid={touched.city && address.city.trim() === ''}
                aria-describedby={
                  touched.city && address.city.trim() === '' ? `${legendId}-city-error` : undefined
                }
                className={`${FOCUS_RING} h-11 rounded-card border border-border-control bg-well px-3`}
              />
              <span id={`${legendId}-city-error`} role="alert" className="text-xs text-state-error">
                {touched.city && address.city.trim() === '' ? t('address.cityRequired') : ''}
              </span>
            </div>

            <div className="flex flex-col gap-1 text-sm">
              <label htmlFor={`${legendId}-zip`} className="text-text-ink">
                {t('address.zipCode')}
              </label>
              <input
                id={`${legendId}-zip`}
                name="zipCode"
                type="text"
                autoComplete="postal-code"
                value={address.zipCode}
                onChange={(event) => setAddress((a) => ({ ...a, zipCode: event.target.value }))}
                className={`${FOCUS_RING} h-11 rounded-card border border-border-control bg-well px-3`}
              />
            </div>
          </div>
        </fieldset>
      )}

      {state.status === 'loading' && <p className="text-sm text-text-muted">{t('state.loading')}</p>}

      {state.status === 'failed' && (
        <FailureNotice failure={state.failure} onRetry={() => void load(method)} />
      )}

      {state.status === 'ready' && (
        <section className="flex flex-col gap-3" aria-labelledby={`${legendId}-summary`}>
          <h2 id={`${legendId}-summary`} className="text-lg font-semibold text-text-ink">
            {t('page.summaryHeading')}
          </h2>

          <p className="text-sm text-text-muted">{estimateText(state.quote.estimate, t)}</p>

          <ul className="flex flex-col gap-2">
            {state.quote.lines.map((line) => (
              <li key={line.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="text-text-ink">
                  {i18n.language === 'he' ? line.nameHe : line.nameEn}
                </span>
                <span className="text-text-muted">
                  {t('summary.lineQuantity', { quantity: line.quantity })}
                </span>
                <PriceBlock price={line.lineTotal} />
              </li>
            ))}
          </ul>

          <dl className="flex flex-col gap-1 border-t border-border-hairline pt-3 text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-text-muted">{t('summary.itemsTotal')}</dt>
              <dd>
                <PriceBlock price={state.quote.basis} />
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-text-muted">{t('summary.shipping')}</dt>
              <dd className="text-text-ink">
                {/*
                  🔴 Three outcomes, not two. Self pickup is MOOT rather than
                  free — the cart DTO carries `noDeliveryRequired` for exactly
                  this, and offering a pickup order "₪0.00 shipping" reads as a
                  discount it never received.
                */}
                {state.quote.shipping.noDeliveryRequired ? (
                  t('summary.noDeliveryRequired')
                ) : state.quote.shipping.isFree ? (
                  t('summary.shippingFree')
                ) : (
                  <PriceBlock price={state.quote.shipping.cost} />
                )}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-2 font-semibold">
              <dt className="text-text-ink">{t('summary.total')}</dt>
              <dd>
                <PriceBlock price={state.quote.totalAmount} />
              </dd>
            </div>
          </dl>
        </section>
      )}

      {state.status === 'ready' && (
        <fieldset className="min-w-0 border-0 p-0">
          <legend className="mb-2 text-sm font-semibold text-text-ink">{t('pay.legend')}</legend>

          {/*
            🔴 REQ-F-043 — SAID PLAINLY, NOT IMPLIED. No provider, no card
            fields, nothing that resembles a card number. An honest named
            control is the requirement; a fake card form would look like the
            real thing and invite someone to type a real number into it.
          */}
          <p className="mb-2 text-xs text-text-muted">{t('pay.simulated')}</p>

          <div className="mb-3 flex flex-col gap-2" role="group" aria-label={t('pay.outcomeLegend')}>
            {(['success', 'failure'] as const).map((value) => (
              <label key={value} className="flex min-h-11 items-center gap-2 text-sm text-text-ink">
                <input
                  type="radio"
                  name="simulatedOutcome"
                  value={value}
                  checked={outcome === value}
                  onChange={() => setOutcome(value)}
                  className={`${FOCUS_RING} size-4 shrink-0 accent-brand-teal`}
                />
                <span>{value === 'success' ? t('pay.outcomeSuccess') : t('pay.outcomeFailure')}</span>
              </label>
            ))}
          </div>

          {/* ISSUE-093 — opt-in, default off, and only where an address exists. */}
          {state.quote.deliveryMethod !== 'self_pickup' && (
            <label className="mb-3 flex min-h-11 items-center gap-2 text-sm text-text-ink">
              <input
                type="checkbox"
                checked={saveAddress}
                onChange={(event) => setSaveAddress(event.target.checked)}
                className={`${FOCUS_RING} size-4 shrink-0 accent-brand-teal`}
              />
              <span>{t('pay.saveAddress')}</span>
            </label>
          )}

          {payState.status === 'failed' && <PayFailureNotice failure={payState.failure} />}

          <Button
            onClick={() => void confirmAndPay(state.quote)}
            disabled={
              payState.status === 'paying' ||
              (state.quote.deliveryMethod !== 'self_pickup' &&
                (address.line1.trim() === '' || address.city.trim() === ''))
            }
          >
            {payState.status === 'paying' ? t('pay.submitting') : t('pay.submit')}
          </Button>
        </fieldset>
      )}

      <Link to="/cart" className={`${FOCUS_RING} rounded-card text-sm text-brand-teal underline`}>
        {t('page.backToCart')}
      </Link>
    </main>
  )
}

function FailureNotice({
  failure,
  onRetry,
}: {
  failure: CheckoutQuoteFailure
  onRetry: () => void
}) {
  const { t } = useTranslation('checkout')

  /*
   * 🔴 EACH FAILURE GETS ITS OWN ANSWER, and REQ-F-042's halt gets the most:
   * it names every blocked line and what to do about it. A single "something
   * went wrong" banner here would reproduce ISSUE-080's dead end one screen
   * later — the shopper is stopped, and nothing tells them which product or
   * which action clears it.
   */
  if (failure.kind === 'blocked') {
    return (
      <section className="flex flex-col gap-2 rounded-card border border-state-error p-4">
        <h2 className="text-base font-semibold text-state-error">{t('blocked.heading')}</h2>
        <p className="text-sm text-text-ink">{t('blocked.intro')}</p>
        <ul className="flex flex-col gap-1 text-sm text-text-ink">
          {failure.lines.map((line) => (
            <li key={line.lineId}>
              <span className="font-medium">{line.slug}</span>{' '}
              <span>{t(`blocked.${line.why}`, { available: line.available })}</span>
            </li>
          ))}
        </ul>
        <Link to="/cart" className={`${FOCUS_RING} rounded-card text-sm text-brand-teal underline`}>
          {t('page.backToCart')}
        </Link>
      </section>
    )
  }

  if (failure.kind === 'emptyCart') {
    return <p className="text-sm text-text-ink">{t('state.emptyCart')}</p>
  }

  if (failure.kind === 'unauthenticated') {
    /*
     * 🔴 A LINK, NOT JUST A SENTENCE. `RequireAuth` cannot rescue this:
     * `SessionContext` still believes the session is live, because only the
     * server knows it expired. Without somewhere to go, the shopper is told to
     * sign in on a page that offers no way to.
     */
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-text-ink">{t('state.unauthenticated')}</p>
        <Link to="/login" className={`${FOCUS_RING} rounded-card text-sm text-brand-teal underline`}>
          {t('state.signIn')}
        </Link>
      </div>
    )
  }

  /*
   * 🔴 DEC-067's gate. No retry and no sign-in link: the shopper IS signed in,
   * and no amount of retrying clears an unverified address. The only action
   * that helps is opening the verification mail, so that is what it says.
   * There is no resend endpoint, so nothing here offers one.
   */
  if (failure.kind === 'emailNotVerified') {
    return <p className="text-sm text-text-ink">{t('state.emailNotVerified')}</p>
  }

  // 🔴 NO RETRY BUTTON HERE, deliberately. The limiter refused; a button that
  // re-hits it immediately is a loop the screen invites the shopper into.
  if (failure.kind === 'rateLimited') {
    return <p className="text-sm text-text-ink">{t('state.rateLimited')}</p>
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-sm text-text-ink">
        {failure.kind === 'offline' ? t('state.offline') : t('state.error')}
      </p>
      <Button onClick={onRetry}>{t('state.retry')}</Button>
    </div>
  )
}

/**
 * 🔴 EACH PAYMENT REFUSAL SAYS WHAT TO DO NEXT, and they are not the same
 * thing. §8.12 records ONE defect shape appearing FOUR times in Checkpoint D —
 * a later step failed and the shopper was told the ORDER failed, for an order
 * that exists. Flattening these would rebuild it on the screen.
 */
function PayFailureNotice({ failure }: { failure: PaymentFailure }) {
  const { t } = useTranslation('checkout')

  const message =
    failure.kind === 'declined'
      ? t('payFailure.declined')
      : failure.kind === 'changed'
        ? t('payFailure.changed')
        : failure.kind === 'orderCancelled'
          ? t('payFailure.orderCancelled', { number: failure.orderNumber })
          : failure.kind === 'addressRejected'
            ? t('payFailure.addressRejected')
            : failure.kind === 'invalidRequest'
              ? t('payFailure.invalidRequest', { code: failure.code })
              : failure.kind === 'offline'
                ? // 🔴 THE ONE THAT MUST NOT SAY "FAILED". The connection dropped;
                  // the order may exist. Pressing again is SAFE because the
                  // idempotency key is unchanged, and saying so is the difference
                  // between a shopper retrying and a shopper ordering twice.
                  t('payFailure.offline')
                : failure.kind === 'emailNotVerified'
                  ? t('state.emailNotVerified')
                  : failure.kind === 'rateLimited'
                    ? t('state.rateLimited')
                    : failure.kind === 'unauthenticated'
                      ? t('state.unauthenticated')
                      : t('state.error')

  return (
    <p role="alert" className="mb-3 text-sm text-state-error">
      {message}
    </p>
  )
}
