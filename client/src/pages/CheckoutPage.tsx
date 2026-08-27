import { useCallback, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { TextLink } from '../components/ui/TextLink'
import { useUnsavedChangesWarning } from '../hooks/useUnsavedChangesWarning'
import { Trans, useTranslation } from 'react-i18next'
import { Button } from '../components/ui/Button'
import { FOCUS_RING } from '../components/ui/focusRing'
import { Icon } from '../components/ui/Icon'
import { VisuallyHidden } from '../components/ui/VisuallyHidden'
import {
  ClockIcon,
  CreditCardIcon,
  LockIcon,
  MapPinIcon,
  PackageIcon,
  ShieldCheckIcon,
  StoreIcon,
  TruckIcon,
} from '../components/icons'
import { PriceBlock } from '../components/catalog/PriceBlock'
import { payForCheckout, requestCheckoutQuote } from '../lib/checkoutApi'
import { newIdempotencyKey } from '../lib/idempotencyKey'
import { useCartRefresh } from '../state/CartContext'
import { orderStatusLabelKey } from '../lib/orderStatus'
import { PICKUP_POINTS, pickupPointAddress } from '../lib/pickupPoints'
import { cardNumberProblem, cvvProblem, expiryProblem, holderProblem } from '../lib/cardValidation'
import { requestAddressBook, requestShopperProfile } from '../lib/accountApi'
import type { ManagedAddress, ShopperProfile } from '../types/account'
import {
  DELIVERY_METHOD_NAMES,
  type CheckoutQuote,
  type CheckoutBlockedLine,
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

/**
 * DEC-110.3 (area 4) — the method card's icon + static estimate line,
 * rendered on EVERY card (review finding: the first cut's comment
 * claimed unselected-only, which the code never did). The ranges are
 * FROZEN server constants (deliveryEstimate.ts's ESTIMATES) restated as
 * static i18n copy — checkout.estimates.test.ts pins each locale string
 * to the server source so a range bump cannot leave the cards lying —
 * while the SELECTED method's live estimate renders from the quote in
 * the summary. No prices here: a per-card cost would restate
 * shipping.ts's figures client-side, which is exactly the duplication
 * §3.4 exists to stop.
 */
const METHOD_CARD: Record<DeliveryMethodName, { icon: ReactElement; estKey: string }> = {
  courier: { icon: <TruckIcon />, estKey: 'delivery.estCourier' },
  pickup_point: { icon: <PackageIcon />, estKey: 'delivery.estPickupPoint' },
  self_pickup: { icon: <StoreIcon />, estKey: 'delivery.estSelfPickup' },
}

/**
 * Area 4's section rhythm: icon + display-face title + a hairline rule.
 * VISUAL ONLY (aria-hidden) — each section keeps a real, sr-only
 * <legend>/heading carrying the same string, so the accessible structure
 * is unchanged while sighted rhythm comes from one place.
 */
function SectionHead({ icon, children }: { icon: ReactElement; children: ReactNode }) {
  // Second consumer outside this page (area 5/6 will want the rhythm) →
  // EXTRACT to components/ui, never copy (review of this diff).
  return (
    <div aria-hidden="true" className="mb-4 flex items-center gap-2.5">
      <Icon size={19} className="text-brand-teal-strong">
        {icon}
      </Icon>
      <span className="heading-subsection">{children}</span>
      <span className="h-px flex-1 bg-border-hairline" />
    </div>
  )
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; quote: CheckoutQuote }
  | { status: 'failed'; failure: CheckoutQuoteFailure }

export function CheckoutPage() {
  const { t, i18n } = useTranslation('checkout')
  // F0's six status labels live in their own namespace, shared with the admin
  // orders page and, later, order history.
  const { t: statusT } = useTranslation('orders')
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
   * ⚠️ Since M-009 the ADDRESS half comes from the address book (the
   * labelled picker below), not from `defaultAddress` — that field is
   * legacy. The profile supplies the name/phone line only.
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
  // The lecturer-fixes list (2026-08-23) — pickup_point picks a POINT, not
  // a typed address. Always a valid selection (default first), so the
  // method can never fail ADDRESS_REQUIRED.
  const [pickupPointId, setPickupPointId] = useState(PICKUP_POINTS[0].id)
  /**
   * M-009 / DEC-090 O3 — REQ-F-051: "at order time the user picks a saved
   * address or enters a new one." `null` until the book loads (or when it
   * fails/is empty — the form alone then, exactly as before this
   * milestone). Picking a row COPIES it into the fields; the FIELDS remain
   * the single source of what `/pay` receives, so the wire is unchanged.
   */
  const [savedAddresses, setSavedAddresses] = useState<ManagedAddress[] | null>(null)
  const [pickedAddressId, setPickedAddressId] = useState<string | 'new'>('new')
  /*
   * 🔴 VALIDATION FIRES ON BLUR, BY DECISION. (ISSUE-059 sweep: this once
   * read "not on a submit that does not exist yet" — F2c's confirm step has
   * long existed; blur stays the trigger because a field the shopper has
   * left is the honest moment to speak, not the final button.)
   *
   * ⚠️ This is DISPLAY ONLY. `addressProblem` on the server is the rule that
   * decides, and it refuses the order regardless of what this form thinks.
   */
  const [touched, setTouched] = useState<{ line1: boolean; city: boolean }>({
    line1: false,
    city: false,
  })

  /*
   * DEC-098 (2026-08-21, the user's decision on the eleventh list's item
   * 14): NO card details render at payment at all — the demo card form is
   * gone, restoring REQ-F-043's original posture ("no card fields, nothing
   * that resembles a card number"). A save-card option is a LATER decision
   * of the user's; nothing here stores or asks for card data.
   */

  /**
   * The lecturer-fixes list (2026-08-23) — the card form returns,
   * REVERSING DEC-098 at the user's explicit instruction, with one hard
   * rule kept from it: THE DETAILS GO NOWHERE. They live in this
   * component's state for validation only — payForCheckout takes no card
   * argument, nothing is stored, and the payment stays simulated.
   */
  const [card, setCard] = useState({ number: '', expiry: '', cvv: '', holder: '' })
  const [cardTouched, setCardTouched] = useState(false)
  const [saveAddress, setSaveAddress] = useState(false)
  const [payState, setPayState] = useState<
    | { status: 'idle' }
    | { status: 'paying' }
    | { status: 'done'; order: PaymentSuccess }
    | { status: 'failed'; failure: PaymentFailure }
  >({ status: 'idle' })

  // Warn before the tab closes while a payment is IN FLIGHT (closing there
  // races the order commit), or while a hand-typed address would be lost.
  // A prefilled/saved address is recoverable and earns no warning, and a
  // completed order ('done') clears it.
  useUnsavedChangesWarning(
    payState.status === 'paying' ||
      (payState.status !== 'done' &&
        pickedAddressId === 'new' &&
        (address.line1 !== '' || address.city !== '' || address.zipCode !== '')),
  )

  /**
   * 🔴 ONE KEY PER CHECKOUT ATTEMPT, HELD IN A REF — INV-05's client half.
   * Regenerating it per press would turn a retried payment into a second
   * order; the server answers a seen key from the stored order, which is the
   * only reason a dropped connection is recoverable here.
   */
  const idempotencyKey = useRef(newIdempotencyKey())
  const confirmationHeading = useRef<HTMLHeadingElement>(null)
  // ISSUE-178 — the order transaction CLEARS the cart server-side, but the
  // app-wide CartContext (header badge, drawer, /cart) kept the stale
  // snapshot until its next mount. The success branch re-reads it.
  const refreshCart = useCartRefresh()

  useEffect(() => {
    let live = true
    void requestShopperProfile().then((result) => {
      if (!live) return
      if (!result.ok) {
        setProfileState({ status: 'unavailable' })
        return
      }
      setProfileState({ status: 'ready', profile: result.profile })
    })
    /*
     * M-009 — the ADDRESS BOOK replaces the old silent defaultAddress
     * prefill: the default row arrives SELECTED and labelled instead of
     * appearing as mysteriously pre-typed text. A failed/empty book leaves
     * the plain form — the picker is a convenience, never a gate.
     *
     * 🔴 NEVER OVERWRITE WHAT THE SHOPPER HAS ALREADY TYPED: the book
     * resolves asynchronously, so the default is copied into the fields
     * only while they are still empty (the original prefill's rule).
     */
    void requestAddressBook().then((result) => {
      if (!live || !result.ok || result.book.addresses.length === 0) return
      setSavedAddresses(result.book.addresses)
      const preferred = result.book.addresses.find((a) => a.isDefault) ?? result.book.addresses[0]!
      /*
       * 🔴 THE PICK AND THE COPY SHARE ONE CONDITION (review finding): the
       * pick was unconditional while the copy respected typed fields, so a
       * shopper typing during the load ended with the radio claiming an
       * address the payload did not carry — and the save-checkbox hidden.
       * A functional update reads the CURRENT fields, then both happen or
       * neither does.
       */
      setAddress((current) => {
        const untouched = current.line1 === '' && current.city === '' && current.zipCode === ''
        if (!untouched) return current
        setPickedAddressId(preferred.id)
        return { line1: preferred.line1, city: preferred.city, zipCode: preferred.zipCode ?? '' }
      })
    })
    return () => {
      live = false
    }
  }, [])

  function pickAddress(value: string) {
    setPickedAddressId(value)
    if (value === 'new') {
      setAddress({ line1: '', city: '', zipCode: '' })
      setTouched({ line1: false, city: false })
      return
    }
    const row = savedAddresses?.find((a) => a.id === value)
    if (row) {
      // A deliberate pick OVERWRITES — that is what picking means.
      setAddress({ line1: row.line1, city: row.city, zipCode: row.zipCode ?? '' })
      setTouched({ line1: false, city: false })
      /*
       * 🔴 THE SAVE CONSENT DIES WITH ITS CHECKBOX (review finding): the
       * box renders only on 'new', and a true left behind travelled in
       * the /pay body with no visible control consenting to it.
       */
      setSaveAddress(false)
    }
  }

  /**
   * 🔴 EDITING UNPICKS (review finding): a field change after picking a
   * saved row left the radio asserting an address the payload no longer
   * matched — and kept the save offer hidden for what is genuinely a new
   * address. Every address-field onChange routes through here.
   */
  function editAddressField(patch: Partial<{ line1: string; city: string; zipCode: string }>) {
    setAddress((a) => ({ ...a, ...patch }))
    setPickedAddressId((current) => (current === 'new' ? current : 'new'))
  }

  const load = useCallback(async (next: DeliveryMethodName) => {
    const id = ++requestId.current
    setState({ status: 'loading' })
    /*
     * 🔴 THE PAY RESULT BELONGS TO THE QUOTE IT WAS ATTEMPTED AGAINST. Without
     * this, a decline stuck to the screen while the shopper switched delivery
     * method, so a brand-new pickup quote rendered under "the payment was
     * declined" for a payment never attempted against it — and `changed`
     * survived the very re-confirmation it asked for.
     */
    setPayState({ status: 'idle' })
    const result = await requestCheckoutQuote(next)
    if (id !== requestId.current) return
    setState(result.ok ? { status: 'ready', quote: result.quote } : { status: 'failed', failure: result.failure })
  }, [])

  useEffect(() => {
    void load(method)
  }, [load, method])

  // Focus the confirmation once, when it appears.
  useEffect(() => {
    if (payState.status === 'done') confirmationHeading.current?.focus()
  }, [payState.status])

  const cardProblems = {
    number: cardNumberProblem(card.number),
    expiry: expiryProblem(card.expiry),
    cvv: cvvProblem(card.cvv),
    holder: holderProblem(card.holder),
  }
  const cardValid =
    cardProblems.number === null &&
    cardProblems.expiry === null &&
    cardProblems.cvv === null &&
    cardProblems.holder === null

  async function confirmAndPay(quote: CheckoutQuote) {
    // The card gate: invalid details surface their errors and the request
    // never leaves. Display-only — the server neither sees nor wants them.
    if (!cardValid) {
      setCardTouched(true)
      return
    }
    /*
     * 🔴 THE SAME TOKEN THE QUOTE LOADER USES. `CHECKOUT_CHANGED` writes a new
     * quote into `state`, and that write was the ONE writer bypassing the
     * staleness rule the ref exists to enforce: pressing Confirm and then
     * switching delivery method landed the OLD method's quote on top of the
     * new one, leaving a courier summary beside a checked self-pickup radio
     * and a permanently disabled button.
     */
    const id = requestId.current
    setPayState({ status: 'paying' })
    const result = await payForCheckout({
      // 🔴 THE FINGERPRINT THE SHOPPER WAS SHOWN, unchanged. DEC-060's gate
      // compares it against one re-derived from live data.
      fingerprint: quote.fingerprint,
      deliveryMethod: quote.deliveryMethod,
      address:
        quote.deliveryMethod === 'self_pickup'
          ? null
          : quote.deliveryMethod === 'pickup_point'
            ? pickupPointAddress(
                PICKUP_POINTS.find((point) => point.id === pickupPointId) ?? PICKUP_POINTS[0],
              )
            : { ...address, zipCode: address.zipCode || null },
      idempotencyKey: idempotencyKey.current,
      // ISSUE-174 (the eleventh list, the user's own spec deviation from
      // REQ-F-043's selector): the outcome control is gone from the UI —
      // the client always requests success. The declined branch stays
      // fully supported server-side (and still renders here on a 402).
      simulatedOutcome: 'success',
      // Belt to the checkbox gate: consent is only meaningful for 'new'.
      saveAddress: saveAddress && pickedAddressId === 'new' && quote.deliveryMethod === 'courier',
    })

    /*
     * ⚠️ DELIBERATELY NOT BEHIND THE STALENESS CHECK. An order EXISTS at this
     * point; discarding the confirmation because the shopper touched a radio
     * mid-flight would hide a placed order — §8.12's defect with a fresh cause.
     * Staleness governs QUOTES, never a receipt.
     */
    if (result.ok) {
      setPayState({ status: 'done', order: result.order })
      // ISSUE-178: the server emptied the cart inside the order
      // transaction; pull the shared state up to date so the badge, the
      // drawer and /cart show the emptiness immediately.
      void refreshCart()
      return
    }

    /*
     * 🔴 THE GATE REFUSING IS NOT AN ERROR STATE — it is a NEW QUOTE to
     * confirm. REQ-F-042 requires the updated figures to be shown; the
     * refusal carried them, so they replace what is on screen and the next
     * press sends the new fingerprint.
     */
    // A quote request started after this payment has already superseded it.
    if (id !== requestId.current) return

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
    // ISSUE-176 — the receipt is a RECEIPT now: a centred ticket card with
    // a confirmation mark, the order number in its own stub, and the total
    // writ large. Same a11y spine as before (focused role=status heading,
    // isolated numeric runs); the creativity is composition, not noise.
    return (
      <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-10">
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-border-hairline bg-well p-7 text-center shadow-[0_10px_36px_rgb(31_37_46/0.08)]">
          <span aria-hidden="true" className="flex size-14 items-center justify-center rounded-round bg-brand-teal text-white">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4.5 12.5 9.5 17.5 19.5 6.5" />
            </svg>
          </span>
        {/*
          🔴 THE BUTTON THAT WAS PRESSED IS UNMOUNTED, so focus falls to
          <body> and nothing is announced: a keyboard or screen-reader user
          gets no signal the order was placed and has to hunt for the number.
          `role="status"` announces it; `tabIndex={-1}` plus the autofocus
          effect puts the caret on it.
        */}
          <h1
            ref={confirmationHeading}
            tabIndex={-1}
            role="status"
            className={`${FOCUS_RING} rounded-card heading-page`}
          >
            {t('done.heading')}
          </h1>
          <p className="text-sm leading-6 text-text-muted">{t('done.subtitle')}</p>
        {/*
          🔴 THE NUMBER IS ISOLATED, NOT THE SENTENCE. `dir="ltr"` on the whole
          paragraph forced the Hebrew label into LTR and put the colon on the
          wrong side. Every other site in this codebase isolates only the
          numeric run — `PriceBlock`, the catalogue's count, the quantity
          stepper — which is what "LTR numeric isolation" means in
          .claude/rules/browser-verification.md.
        */}
          {/* The ticket stub — dashed like a tear-off, the number isolated. */}
          <p className="w-full rounded-card border border-dashed border-border-control bg-surface-page px-4 py-3 text-sm font-semibold text-text-ink">
            <Trans
              i18nKey="done.orderNumber"
              t={t}
              values={{ number: payState.order.orderNumber }}
              components={{ n: <span dir="ltr" style={{ unicodeBidi: 'isolate' }} /> }}
            />
          </p>
          <p className="flex flex-wrap items-baseline justify-center gap-1.5">
            <span className="text-sm text-text-muted">{t('done.total')}</span>
            <PriceBlock price={payState.order.totalAmount} size="price" />
          </p>
          <p className="text-sm leading-6 text-text-muted">{estimateText(payState.order.estimate, t)}</p>
        {/*
          🔴 A REPLAY IS A CONFIRMATION, AND IT SAYS SO. §8.12 records the
          opposite defect four times: a retry told the shopper the order
          failed, for an order that existed. This says the order exists AND
          that nothing was charged twice.
        */}
          {payState.order.replayed && (
            <p className="text-sm text-text-ink">{t('done.replayed')}</p>
          )}

        {/*
          🔴 THE STORED STATUS, RENDERED — it was validated, carried and then
          DROPPED, while a comment in the transport claimed it "travels to the
          screen". A replay of an order already `shipped` or `delivered`, or
          one stuck at `pending_payment` because `settleAsPaid` failed
          (ISSUE-082), rendered an identical "Order received". Checkpoint F0's
          labels exist for exactly this.
        */}
          {payState.order.status && orderStatusLabelKey(payState.order.status) && (
            <p className="text-sm text-text-muted">
              {t('done.status', {
                status: statusT(orderStatusLabelKey(payState.order.status)!),
              })}
            </p>
          )}
          <div className="mt-1 flex flex-wrap items-center justify-center gap-4">
            <TextLink to="/account/orders">
              {t('done.viewOrders')}
            </TextLink>
            <TextLink to="/catalog">
              {t('done.backToCatalog')}
            </TextLink>
          </div>
        </div>
      </main>
    )
  }

  // Item COUNT (not money): the sum of the quote's line quantities, the
  // same figure the header badge convention uses. Shown in the summary
  // header and the mobile jump strip.
  const itemCount =
    state.status === 'ready'
      ? state.quote.lines.reduce((sum, line) => sum + line.quantity, 0)
      : 0

  return (
    <main className="mx-auto max-w-[1160px] px-4 py-6 lg:px-7">
      {/*
        DEC-110.3 — below lg the summary sits at the FLOW'S END (the aside
        renders after the form in DOM order); this strip is the way to peek
        at it early: an anchor showing the count and the server's total,
        jumping to the full summary. A link, not a second summary — no
        figure here is derived, and the one CTA stays singular.
      */}
      {state.status === 'ready' && (
        <a
          href="#checkout-summary"
          className={`${FOCUS_RING} mb-5 flex items-center justify-between gap-3 rounded-card border border-border-hairline bg-well px-4 py-3 text-sm lg:hidden`}
        >
          <span className="font-semibold text-text-ink">
            {t('page.summaryHeading')}
            {' · '}
            {t('summary.itemCount', { count: itemCount })}
          </span>
          <span className="flex items-center gap-1.5">
            <PriceBlock price={state.quote.totalAmount} />
            <VisuallyHidden>{t('summary.jumpToSummary')}</VisuallyHidden>
          </span>
        </a>
      )}

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-11">
        <div className="flex min-w-0 flex-col gap-9">
          <h1 className="heading-page">{t('page.title')}</h1>

          <fieldset className="min-w-0 border-0 p-0">
            <legend id={legendId} className="sr-only">
              {t('delivery.legend')}
            </legend>
            <SectionHead icon={<TruckIcon />}>{t('delivery.legend')}</SectionHead>
            {/* DEC-110.3 — SELECTION CARDS, not bare radio rows: hairline
                border, selected = teal ring + soft teal fill, an icon and
                the frozen estimate range per method. Still NATIVE radios
                (sr-only inside the label) — keyboard and SR behaviour are
                the browser's, only the paint changed. */}
            <div className="grid gap-2.5 sm:grid-cols-3">
              {DELIVERY_METHOD_NAMES.map((name) => {
                const checked = method === name
                // The sr-only radio still carries disabled= while paying;
                // the CARD must say so too (review finding: the old native
                // radio grayed itself, the painted card kept a live hover
                // and pointer over a control that silently no-ops).
                const paying = payState.status === 'paying'
                return (
                  <label
                    key={name}
                    className={`focus-ring-within relative flex min-h-[92px] flex-col gap-1.5 rounded-card border p-3.5 pe-10 transition-[border-color,box-shadow,background-color,opacity] duration-150 ease-standard ${
                      paying ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                    } ${
                      checked
                        ? 'border-brand-teal bg-brand-teal/[0.045] shadow-[inset_0_0_0_1px_var(--brand-teal),0_2px_10px_rgb(21_112_106/0.10)]'
                        : `border-border-hairline bg-well ${paying ? '' : 'hover:border-border-control'}`
                    }`}
                  >
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
                      checked={checked}
                      // 🔴 A payment is in flight against THIS quote; changing the
                      // method underneath it is what produced the mismatch above.
                      disabled={payState.status === 'paying'}
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
                      className="sr-only"
                    />
                    {/* The radio AFFORDANCE, painted: the dot fills teal on
                        selection — a radio's own grammar, not a checkmark. */}
                    <span
                      aria-hidden="true"
                      className={`absolute top-3 end-3 size-4 rounded-round bg-well transition-[border-color,border-width] duration-150 ease-standard ${
                        checked
                          ? 'border-[5px] border-brand-teal-strong'
                          : 'border-[1.5px] border-border-control'
                      }`}
                    />
                    <Icon size={21} className={checked ? 'text-brand-teal-strong' : 'text-text-muted'}>
                      {METHOD_CARD[name].icon}
                    </Icon>
                    <span className="text-sm font-semibold leading-tight text-text-ink">
                      {t(`delivery.${name}`)}
                    </span>
                    <span className="text-xs leading-snug text-text-muted">
                      {t(METHOD_CARD[name].estKey)}
                    </span>
                  </label>
                )
              })}
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
          ) : method === 'pickup_point' ? (
            /* The point picker — a labelled native select (CatalogSortSelect's
               §10 reasoning), replacing the home-address fields the lecturer-
               fixes list called out as wrong for this method. */
            <div className="min-w-0">
              <SectionHead icon={<MapPinIcon />}>{t('address.pickupLegend')}</SectionHead>
              <label htmlFor="checkout-pickup-point" className="sr-only">
                {t('address.pickupLegend')}
              </label>
              <select
                id="checkout-pickup-point"
                value={pickupPointId}
                onChange={(event) => setPickupPointId(event.target.value)}
                className={`${FOCUS_RING} mt-2 h-11 w-full cursor-pointer rounded-card border border-border-control bg-well px-3 text-base text-text-ink`}
              >
                {PICKUP_POINTS.map((point) => (
                  <option key={point.id} value={point.id}>
                    {i18n.language === 'he'
                      ? `${point.nameHe} — ${point.cityHe}`
                      : `${point.nameEn} — ${point.cityEn}`}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs text-text-muted">{t('address.pickupNote')}</p>
            </div>
          ) : (
            <fieldset className="min-w-0 border-0 p-0">
              <legend className="sr-only">{t('address.legend')}</legend>
              <SectionHead icon={<MapPinIcon />}>{t('address.legend')}</SectionHead>

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

              {profileState.status !== 'loading' && savedAddresses === null && (
                <p className="mb-2 text-xs text-text-muted">
                  {profileState.status === 'unavailable'
                    ? t('address.unavailable')
                    : t('address.noSavedAddress')}
                </p>
              )}

              {/* M-009 — the saved-address PICKER (REQ-F-051's own wording). */}
              {savedAddresses !== null && (
                <div className="mb-3 flex flex-col gap-2" role="radiogroup" aria-label={t('address.pickerLegend')}>
                  {savedAddresses.map((saved) => (
                    <label key={saved.id} className="flex min-h-11 items-center gap-2 text-sm text-text-ink">
                      <input
                        type="radio"
                        name="savedAddress"
                        value={saved.id}
                        checked={pickedAddressId === saved.id}
                        disabled={payState.status === 'paying'}
                        onChange={() => pickAddress(saved.id)}
                        className={`${FOCUS_RING} size-4 shrink-0 accent-brand-teal`}
                      />
                      <span>
                        {saved.line1}, {saved.city}
                        {saved.zipCode ? `, ${saved.zipCode}` : ''}
                        {saved.isDefault ? ` · ${t('address.pickerDefault')}` : ''}
                      </span>
                    </label>
                  ))}
                  <label className="flex min-h-11 items-center gap-2 text-sm text-text-ink">
                    <input
                      type="radio"
                      name="savedAddress"
                      value="new"
                      checked={pickedAddressId === 'new'}
                      disabled={payState.status === 'paying'}
                      onChange={() => pickAddress('new')}
                      className={`${FOCUS_RING} size-4 shrink-0 accent-brand-teal`}
                    />
                    <span>{t('address.pickerNew')}</span>
                  </label>
                </div>
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
                    onChange={(event) => editAddressField({ line1: event.target.value })}
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
                    onChange={(event) => editAddressField({ city: event.target.value })}
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
                    onChange={(event) => editAddressField({ zipCode: event.target.value })}
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

          {/* DEC-110.3 — the ORDER SUMMARY moved into the sticky receipt aside
              below; the payment fields stay in the form column, the one submit
              CTA lives in the receipt (its DOM position doubles as the mobile
              flow's end). */}
          {state.status === 'ready' && (
            <fieldset className="min-w-0 border-0 p-0">
              <legend className="sr-only">{t('pay.legend')}</legend>
              <SectionHead icon={<CreditCardIcon />}>{t('pay.legend')}</SectionHead>

              <div className="mb-1 grid gap-x-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label htmlFor="pay-card-number" className="block text-sm font-medium text-text-ink">
                    {t('pay.card.number')}
                  </label>
                  <input
                    id="pay-card-number"
                    inputMode="numeric"
                    autoComplete="cc-number"
                    dir="ltr"
                    value={card.number}
                    onChange={(event) => setCard((c) => ({ ...c, number: event.target.value }))}
                    aria-invalid={cardTouched && cardProblems.number !== null}
                    aria-describedby={cardTouched && cardProblems.number ? 'pay-card-number-error' : undefined}
                    className={`${FOCUS_RING} mt-1 h-11 w-full rounded-card border bg-well px-3 text-base ${cardTouched && cardProblems.number ? 'border-state-error' : 'border-border-control'}`}
                  />
                  <p id="pay-card-number-error" className="mt-1 min-h-4 text-xs text-state-error">
                    {cardTouched && cardProblems.number ? t(`pay.card.errors.${cardProblems.number}`) : ''}
                  </p>
                </div>
                <div>
                  <label htmlFor="pay-card-expiry" className="block text-sm font-medium text-text-ink">
                    {t('pay.card.expiry')}
                  </label>
                  <input
                    id="pay-card-expiry"
                    inputMode="numeric"
                    autoComplete="cc-exp"
                    dir="ltr"
                    placeholder="MM/YY"
                    value={card.expiry}
                    onChange={(event) => setCard((c) => ({ ...c, expiry: event.target.value }))}
                    aria-invalid={cardTouched && cardProblems.expiry !== null}
                    aria-describedby={cardTouched && cardProblems.expiry ? 'pay-card-expiry-error' : undefined}
                    className={`${FOCUS_RING} mt-1 h-11 w-full rounded-card border bg-well px-3 text-base ${cardTouched && cardProblems.expiry ? 'border-state-error' : 'border-border-control'}`}
                  />
                  <p id="pay-card-expiry-error" className="mt-1 min-h-4 text-xs text-state-error">
                    {cardTouched && cardProblems.expiry ? t(`pay.card.errors.${cardProblems.expiry}`) : ''}
                  </p>
                </div>
                <div>
                  <label htmlFor="pay-card-cvv" className="block text-sm font-medium text-text-ink">
                    {t('pay.card.cvv')}
                  </label>
                  <input
                    id="pay-card-cvv"
                    inputMode="numeric"
                    autoComplete="cc-csc"
                    dir="ltr"
                    value={card.cvv}
                    onChange={(event) => setCard((c) => ({ ...c, cvv: event.target.value }))}
                    aria-invalid={cardTouched && cardProblems.cvv !== null}
                    aria-describedby={cardTouched && cardProblems.cvv ? 'pay-card-cvv-error' : undefined}
                    className={`${FOCUS_RING} mt-1 h-11 w-full rounded-card border bg-well px-3 text-base ${cardTouched && cardProblems.cvv ? 'border-state-error' : 'border-border-control'}`}
                  />
                  <p id="pay-card-cvv-error" className="mt-1 min-h-4 text-xs text-state-error">
                    {cardTouched && cardProblems.cvv ? t(`pay.card.errors.${cardProblems.cvv}`) : ''}
                  </p>
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="pay-card-holder" className="block text-sm font-medium text-text-ink">
                    {t('pay.card.holder')}
                  </label>
                  <input
                    id="pay-card-holder"
                    autoComplete="cc-name"
                    value={card.holder}
                    onChange={(event) => setCard((c) => ({ ...c, holder: event.target.value }))}
                    aria-invalid={cardTouched && cardProblems.holder !== null}
                    aria-describedby={cardTouched && cardProblems.holder ? 'pay-card-holder-error' : undefined}
                    className={`${FOCUS_RING} mt-1 h-11 w-full rounded-card border bg-well px-3 text-base ${cardTouched && cardProblems.holder ? 'border-state-error' : 'border-border-control'}`}
                  />
                  <p id="pay-card-holder-error" className="mt-1 min-h-4 text-xs text-state-error">
                    {cardTouched && cardProblems.holder ? t(`pay.card.errors.${cardProblems.holder}`) : ''}
                  </p>
                </div>
              </div>
              {/*
                REQ-F-043's posture as amended by the user (2026-08-23,
                reversing DEC-098): card FIELDS with real validation, and the
                simulated-payment sentence stays so nobody believes a charge
                happens. Area 4 merged the two honesty sentences into ONE quiet
                shield-marked note — both i18n keys kept, rendered together.
              */}
              <p className="mt-1 flex items-start gap-2 text-xs leading-relaxed text-text-muted">
                <Icon size={14} className="mt-0.5 shrink-0 text-brand-teal-strong">
                  <ShieldCheckIcon />
                </Icon>
                <span>
                  {t('pay.simulated')} {t('pay.card.notStored')}
                </span>
              </p>

              {/* ISSUE-093 — opt-in, default off; M-009: offered only for a NEW
                  address (saving an already-saved row would duplicate it, and
                  the transport dedups — but the offer itself would be noise). */}
              {state.quote.deliveryMethod !== 'self_pickup' && pickedAddressId === 'new' && (
                <label className="mt-3 flex min-h-11 items-center gap-2 text-sm text-text-ink">
                  <input
                    type="checkbox"
                    checked={saveAddress}
                    onChange={(event) => setSaveAddress(event.target.checked)}
                    className={`${FOCUS_RING} size-4 shrink-0 accent-brand-teal`}
                  />
                  <span>{t('pay.saveAddress')}</span>
                </label>
              )}
            </fieldset>
          )}
        </div>

        {/*
          DEC-110.3 — THE RECEIPT: the order summary as a sticky card that
          holds the one submit CTA. At lg+ it rides the right column; below
          lg its DOM position (after the form) is the flow's end, which is
          exactly where the plan wants the CTA on mobile — one CTA total,
          one DOM node, no breakpoint duplicate for jsdom to double-count.
        */}
        {state.status === 'ready' && (
          /*
           * scroll-mt + sticky top ride --sticky-header-h (review finding:
           * fixed 24px values slid the receipt's header band under the
           * app's 113/118px sticky header — on scroll at lg, and on the
           * jump-strip anchor landing on mobile). Same contract every
           * other sticky/jump surface uses.
           */
          <aside
            id="checkout-summary"
            aria-labelledby={`${legendId}-summary`}
            className="mt-9 scroll-mt-[calc(var(--sticky-header-h)+12px)] overflow-hidden rounded-card border border-border-hairline bg-well shadow-[0_10px_28px_-8px_rgb(31_37_46/0.13)] lg:sticky lg:top-[calc(var(--sticky-header-h)+16px)] lg:mt-0"
          >
            <div className="border-b border-border-hairline bg-brand-teal/5 px-5 pb-3.5 pt-4">
              <div className="flex items-baseline justify-between gap-2">
                <h2
                  id={`${legendId}-summary`}
                  className="font-display text-base font-medium text-text-ink"
                >
                  {t('page.summaryHeading')}
                </h2>
                <span className="text-xs text-text-muted">
                  {t('summary.itemCount', { count: itemCount })}
                </span>
              </div>
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-text-muted">
                <Icon size={13}>
                  <ClockIcon />
                </Icon>
                {estimateText(state.quote.estimate, t)}
              </p>
            </div>

            <div className="flex flex-col px-5 pb-5 pt-3.5">
              <ul className="flex flex-col">
                {state.quote.lines.map((line) => (
                  <li
                    key={line.id}
                    className="flex items-baseline justify-between gap-2.5 py-1 text-[13px]"
                  >
                    <span className="min-w-0 flex-1 truncate text-text-ink">
                      {i18n.language === 'he' ? line.nameHe : line.nameEn}
                    </span>
                    {/* The quantity rides beside the NAME (the user's mock
                        call) but OUTSIDE the truncating span — inside it, a
                        long Hebrew name ellipsized the ×N away and a
                        multi-unit line read as one unit beside a multi-unit
                        price (review finding). SR hears the full
                        "Quantity: N" sentence; the visual compact form is
                        an i18n key with the numeral LTR-isolated, per the
                        browser-verification bidi rule. */}
                    {line.quantity > 1 && (
                      <span className="shrink-0 text-xs text-text-muted">
                        <VisuallyHidden>
                          {t('summary.lineQuantity', { quantity: line.quantity })}
                        </VisuallyHidden>
                        <span aria-hidden="true" dir="ltr" style={{ unicodeBidi: 'isolate' }}>
                          {t('summary.lineQuantityCompact', { quantity: line.quantity })}
                        </span>
                      </span>
                    )}
                    <PriceBlock price={line.lineTotal} />
                  </li>
                ))}
              </ul>

              <dl className="mt-3 flex flex-col gap-1.5 border-t border-dashed border-border-hairline pt-3 text-[13px]">
                {/*
                  The seventh list, item 2 — the included club discount, stated
                  rather than implied. It is NOT a subtractable row: the item
                  total below is ALREADY the member figure, and the label says
                  "included" so nobody re-derives the total minus it. The
                  SERVER zeroes this figure for non-members (review finding —
                  the wire cannot express a join pitch on a confirm-and-pay
                  screen), so the '0.00' gate covers both readings; clubMember
                  stays in the condition as belt-and-braces against a consumer
                  of an older cached quote. String comparison, §3.4.
                */}
                {state.quote.clubMember && state.quote.clubSavings !== '0.00' && (
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-state-commerce">{t('savings.checkout', { ns: 'club' })}</dt>
                    <dd>
                      <PriceBlock price={state.quote.clubSavings} />
                    </dd>
                  </div>
                )}
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
                      <span className="font-semibold text-state-commerce">
                        {t('summary.shippingFree')}
                      </span>
                    ) : (
                      <PriceBlock price={state.quote.shipping.cost} />
                    )}
                  </dd>
                </div>
                {/* The grand total STAYS a dt/dd inside this dl (review
                    finding: the first cut closed the list before it, so an
                    SR user walking the price breakdown exited before the
                    one number that matters). */}
                <div className="mt-1 flex items-baseline justify-between gap-2 border-t border-border-hairline pt-3">
                  <dt className="text-sm font-bold text-text-ink">{t('summary.total')}</dt>
                  <dd>
                    <PriceBlock price={state.quote.totalAmount} size="price" />
                  </dd>
                </div>
              </dl>

              {payState.status === 'failed' && (
                <div className="mt-3">
                  <PayFailureNotice failure={payState.failure} />
                </div>
              )}

              <Button
                fullWidth
                icon={<LockIcon />}
                className="mt-4"
                onClick={() => void confirmAndPay(state.quote)}
                disabled={
                  payState.status === 'paying' ||
                  /*
                   * 🔴 COURIER ONLY (review finding, a PRE-EXISTING gate bug
                   * this restructure surfaced): the old `!== 'self_pickup'`
                   * also fired for pickup_point, whose payload sends the
                   * PICKED POINT's address — the typed fields are unmounted
                   * for it, so a shopper with an empty address book had no
                   * fields to fill and a permanently dead button. The typed
                   * address gates courier alone, matching what /pay sends.
                   */
                  (state.quote.deliveryMethod === 'courier' &&
                    (address.line1.trim() === '' || address.city.trim() === ''))
                }
              >
                {payState.status === 'paying' ? t('pay.submitting') : t('pay.submit')}
              </Button>
              <TextLink to="/cart" block className="mt-2">
                {t('page.backToCart')}
              </TextLink>
            </div>
          </aside>
        )}
      </div>

      {/* The receipt owns the back link once a quote is on screen; the
          loading/failed states keep their own way back. */}
      {state.status !== 'ready' && (
        <TextLink to="/cart" className="mt-6">
          {t('page.backToCart')}
        </TextLink>
      )}
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
  if (failure.kind === 'blocked') return <BlockedLinesNotice lines={failure.lines} />

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
        <TextLink to="/login">
          {t('state.signIn')}
        </TextLink>
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
/**
 * The blocked-order panel, shared by BOTH failure surfaces.
 *
 * 🔴 IT WAS DUPLICATED-BY-OMISSION, WHICH IS WORSE THAN DUPLICATED. The pay
 * path had no branch for `blocked` at all, so a 409 UNPURCHASABLE_LINE from
 * `/pay` — reachable from the route's re-quote and from its halt — fell
 * through to "the order could not be calculated", naming no line. One
 * component now serves both, so a third caller cannot omit it either.
 */
function BlockedLinesNotice({ lines }: { lines: readonly CheckoutBlockedLine[] }) {
  const { t } = useTranslation('checkout')
  return (
    <section className="flex flex-col gap-2 rounded-card border border-state-error p-4" role="alert">
      <h2 className="text-base font-semibold text-state-error">{t('blocked.heading')}</h2>
      <p className="text-sm text-text-ink">{t('blocked.intro')}</p>
      <ul className="flex flex-col gap-1 text-sm text-text-ink">
        {lines.map((line) => (
          <li key={line.lineId}>
            <span className="font-medium">{line.slug}</span>{' '}
            <span>{t(`blocked.${line.why}`, { available: line.available })}</span>
          </li>
        ))}
      </ul>
      <TextLink to="/cart">
        {t('page.backToCart')}
      </TextLink>
    </section>
  )
}

/**
 * 🔴 EXPLICIT BRANCHES, NOT A TERNARY CHAIN — and the shape is the fix.
 *
 * The first version was one nested ternary ending in `: t('state.error')`, and
 * it silently had no branch for `blocked` or `emptyCart`. Both are reachable
 * from `/pay`, and both rendered "the order could not be calculated" while the
 * screen one component above already knew how to name every blocked line.
 * That is §8.12's flattening, committed by code whose own comment says it
 * exists to prevent it. A chain with a fallback swallows a missing case; a
 * switch-like body makes the omission visible.
 */
function PayFailureNotice({ failure }: { failure: PaymentFailure }) {
  const { t } = useTranslation('checkout')

  // The order cannot be placed at all, and WHICH line is the whole message.
  if (failure.kind === 'blocked') return <BlockedLinesNotice lines={failure.lines} />

  if (failure.kind === 'emptyCart') {
    return (
      <p role="alert" className="mb-3 text-sm text-state-error">
        {t('state.emptyCart')}
      </p>
    )
  }

  /*
   * 🔴 A LINK, exactly as the quote path already does. `/pay` is the LAST call
   * of a long form, so an expired session is the common case here — and
   * `RequireAuth` cannot rescue it, because `SessionContext` still believes
   * the session is live. This branch shipped as a sentence with nowhere to go.
   */
  if (failure.kind === 'unauthenticated') {
    return (
      <div role="alert" className="mb-3 flex flex-col items-start gap-2">
        <p className="text-sm text-state-error">{t('state.unauthenticated')}</p>
        <TextLink to="/login">
          {t('state.signIn')}
        </TextLink>
      </div>
    )
  }

  const message =
    failure.kind === 'declined'
      ? t('payFailure.declined')
      : failure.kind === 'changed'
        ? t('payFailure.changed')
        : failure.kind === 'orderCancelled'
          ? failure.orderNumber
            ? t('payFailure.orderCancelled', { number: failure.orderNumber })
            : // The server always sends the number today; if it ever does not,
              // "Order  was cancelled" is a rendering fault a shopper reads as
              // one. The same file refuses a SUCCESS whose number is blank.
              t('payFailure.orderCancelledUnnamed')
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
                    : t('state.error')

  return (
    <p role="alert" className="mb-3 text-sm text-state-error">
      {message}
    </p>
  )
}

