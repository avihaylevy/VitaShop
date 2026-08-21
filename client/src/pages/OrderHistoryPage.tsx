import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/ui/Button'
import { CenterDialog } from '../components/ui/CenterDialog'
import { FOCUS_RING } from '../components/ui/focusRing'
import { PriceBlock } from '../components/catalog/PriceBlock'
import { cancelOrder, requestOrderHistory } from '../lib/ordersApi'
import { orderStatusLabelKey } from '../lib/orderStatus'
import type { SupportedLanguage } from '../i18n'
import type {
  CancelOrderResult,
  OrderHistoryFailure,
  OrderHistoryRow,
} from '../types/orderHistory'

/**
 * MILESTONE-008 Checkpoint G2 — REQ-F-050, the shopper's own order history.
 *
 * 🔴 THIS SCREEN ALSO GIVES THE SHOPPER-CANCEL ROUTE ITS FIRST UI.
 * `POST /api/orders/:id/cancel` shipped at Checkpoint E3, tested, and has been
 * reachable only by an HTTP client ever since — the same gap ISSUE-083 recorded
 * on the admin side, and the one ISSUE-097 records for the admin screen's
 * navigation. A route nobody can reach is not a feature.
 *
 * 🔴 THE CANCEL BUTTON IS OFFERED FROM STATUS, NOT FROM A LOCAL COPY OF §8.9.
 * The server owns the table; this file knows only that two statuses are
 * cancellable by a shopper, and the route refuses anything else — a refusal is
 * rendered, never prevented by hiding.
 *
 * ⚠️ NOT BROWSER-VERIFIED BY THE AGENT. `/account/orders` sits behind
 * `RequireAuth` and the agent handles no credential, so the matrix for this
 * screen is the user's, exactly like `/checkout` and `/admin/orders`.
 */

/**
 * Offered for a failure a retry can fix, and kept mounted WHILE one runs so the
 * button never disappears under the shopper's focus.
 */
function retryOffered(state: LoadState, retryPending: boolean): boolean {
  if (state.status === 'loading') return retryPending
  if (state.status !== 'failed') return false
  return state.failure.kind !== 'rateLimited' && state.failure.kind !== 'unauthenticated'
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; orders: OrderHistoryRow[] }
  | { status: 'failed'; failure: OrderHistoryFailure }

/*
 * 🔴 NO LOCAL COPY OF CANCELLABILITY. The row's server-computed
 * `cancellable` flag decides whether the button is OFFERED (§8.9's shopper
 * statuses + the twelfth list's 10-day window on `paid`, on the SERVER's
 * clock); the cancel route re-checks on press. The first draft mirrored the
 * statuses AND the window here — two constants the server could amend
 * without any test going red, plus a device-clock skew that silently hid a
 * server-permitted cancel. Both removed in the hundred-second pass review.
 */

/**
 * Wave 4, the "my-orders look" item — the status is a tinted OUTLINE PILL,
 * not a muted afterthought. Colour accompanies the translated label, never
 * replaces it, and an unknown status falls back to the neutral pill rather
 * than crashing or vanishing. ⚠️ `state-commerce` is deliberately absent —
 * DEC-038 reserves it for sale badges and product-level promotion.
 */
const STATUS_BADGE_CLASS: Record<string, string> = {
  pending_payment: 'border-state-lowstock text-state-lowstock',
  paid: 'border-brand-teal text-brand-teal',
  processing: 'border-brand-teal text-brand-teal',
  shipped: 'border-brand-teal-strong text-brand-teal-strong',
  delivered: 'border-brand-teal-strong text-brand-teal-strong',
  cancelled: 'border-state-error text-state-error',
}

function statusBadgeClass(status: string): string {
  return STATUS_BADGE_CLASS[status] ?? 'border-border-control text-text-muted'
}

/**
 * ⚠️ FAILURES ONLY. A refusal keeps its row, so the sentence renders beside
 * it AND feeds the page's live region — written once so the two can never
 * disagree. A SUCCESS never comes here: its row is about to leave the list,
 * the confirmation lives in the dialog, and the page's live region would be
 * INERT under that dialog anyway (Modal inerts #root — an announcement
 * written there in the same commit is never spoken; hundred-second review).
 */
type CancelFailure = Extract<CancelOrderResult, { ok: false }>

function outcomeText(failure: CancelFailure, t: (key: string) => string): string {
  return t(`history.outcome.${failure.failure.kind}`)
}

export function OrderHistoryPage() {
  const { t, i18n } = useTranslation('orders')
  const language = i18n.language as SupportedLanguage
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  /**
   * ⚠️ KEYED BY ORDER ID, not a single global slot. The admin screen shipped
   * one shared outcome and the first response overwrote the other row's
   * message — found in review there, avoided here.
   */
  const [outcomes, setOutcomes] = useState<Record<string, CancelFailure>>({})
  /**
   * The user's twelfth list — a SUCCESSFUL cancellation is confirmed by a
   * DIALOG, not by a line in the list: the cancelled order stops being listed
   * at all (the server filters it), so there is no row left to carry the
   * sentence. `null` = closed; otherwise whether it was already cancelled,
   * which picks the dialog's body text.
   */
  const [cancelledDialog, setCancelledDialog] = useState<{ alreadyCancelled: boolean } | null>(null)
  /** What the page-level live region says, and the toggle that forces a repeat. */
  const [announcement, setAnnouncement] = useState<string | null>(null)
  const [announceToggle, setAnnounceToggle] = useState(false)

  const [retryPending, setRetryPending] = useState(false)
  /**
   * 🔴 A REQUEST-ID GUARD, because the last answer to ARRIVE is not the last
   * one ASKED FOR. Without it, two quick Retry presses can end with the SLOW
   * FIRST failure overwriting the fast second success — the shopper watches
   * their orders appear and then be replaced by an error. It also stops a
   * setState landing after the shopper has navigated away.
   *
   * `useNewArrivals` established this shape; this file was written without it.
   * Found in review.
   */
  const requestId = useRef(0)
  const headingRef = useRef<HTMLHeadingElement>(null)

  const load = useCallback(async () => {
    const id = ++requestId.current
    setState({ status: 'loading' })
    const result = await requestOrderHistory()
    if (id !== requestId.current) return
    setRetryPending(false)
    setState(result.ok ? { status: 'ready', orders: result.orders } : { status: 'failed', failure: result.failure })
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function confirmCancel(orderId: string) {
    setBusyId(orderId)
    const result = await cancelOrder(orderId)
    setBusyId(null)
    setConfirming(null)
    if (result.ok) {
      // The user's twelfth list — success is confirmed by the DIALOG alone:
      // the row leaves the list (the server no longer returns it), and the
      // page's live region would be inert under the dialog, so nothing is
      // stored or announced here.
      setCancelledDialog({ alreadyCancelled: result.alreadyCancelled })
      await load()
      return
    }
    // 🔴 A REFUSAL leaves the list exactly as it is so the message stays
    // beside the row it belongs to; a reload would replace the row and drop
    // the explanation the shopper needs. Announced from the page's live
    // region — no dialog is open on this path, so it is NOT inert.
    setAnnouncement(outcomeText(result, t))
    // Flipped every time, so two identical outcomes are still two changes.
    setAnnounceToggle((previous) => !previous)
    setOutcomes((previous) => ({ ...previous, [orderId]: result }))
  }

  return (
    <div className="px-7 py-8">
      {/*
        tabIndex={-1} + the ref: the cancelled-order dialog's RETURN-FOCUS
        target. The confirm button that opened it unmounts with its row (the
        cancelled order leaves the list), so focus must land somewhere
        deliberate — the unmount-takes-focus family, answered the documented
        way rather than left to fall to <body>.
      */}
      <h1 ref={headingRef} tabIndex={-1} className="heading-page focus:outline-none">
        {t('history.title')}
      </h1>

      {/*
        One live region, always mounted — the shape ISSUE-098 settled on the
        home page. Loading and failure share it, so a Retry press is announced
        rather than silently swapping one conditional block for another.
      */}
      <p role="status" className="mt-4 text-sm text-text-muted">
        {state.status === 'loading' ? t('history.loading') : ''}
        {state.status === 'failed' ? t(`history.failure.${state.failure.kind}`) : ''}
      </p>

      {/*
        🔴 THE CANCEL OUTCOME IS SPOKEN HERE, from a region that is ALWAYS
        mounted and `sr-only` — the rows carry the same sentence visibly.

        ⚠️ THE TRAILING NBSP IS THE REPEAT MECHANISM, and it is load-bearing.
        React bails out on byte-identical text, so a second cancellation
        refused for the same reason would change nothing and `aria-live` would
        never fire — a shopper hearing about the first refusal and nothing
        after it. Toggling one non-breaking space alternates the TEXT, which is
        what a live region watches; the previous attempt toggled a `data-`
        attribute, which it does not.
      */}
      <p role="status" className="sr-only">
        {announcement === null ? '' : announcement + (announceToggle ? ' ' : '')}
      </p>

      {/*
        🔴 MOUNTED THROUGH THE RETRY, `aria-disabled` while it runs. Rendering
        it only for `failed` meant pressing it unmounted the focused button and
        dropped focus to <body> — ISSUE-098 exactly, reintroduced one commit
        after it was fixed on the home page. `retryPending` is what separates
        "loading for the first time" from "retrying".

        ⚠️ NO RETRY ON A 429 OR ON `unauthenticated`. Waiting fixes the first;
        the second needs a sign-in, and a button that can only 401 again is the
        dead-end refusal ISSUE-080 recorded. A link is offered instead.
      */}
      {retryOffered(state, retryPending) && (
        <Button
          variant="secondary"
          className="mt-3"
          aria-disabled={state.status === 'loading' || undefined}
          onClick={() => {
            if (state.status === 'loading') return
            setRetryPending(true)
            void load()
          }}
        >
          {t('history.retry')}
        </Button>
      )}

      {state.status === 'failed' && state.failure.kind === 'unauthenticated' && (
        <Link
          to="/login"
          className={`${FOCUS_RING} mt-3 inline-block rounded-card text-sm text-brand-teal underline`}
        >
          {t('history.signIn')}
        </Link>
      )}

      {state.status === 'ready' && state.orders.length === 0 && (
        <div className="mt-6 flex flex-col items-start gap-3">
          <p className="text-sm text-text-muted">{t('history.empty')}</p>
          <Link to="/catalog" className={`${FOCUS_RING} rounded-card text-sm text-brand-teal underline`}>
            {t('history.emptyCta')}
          </Link>
        </div>
      )}

      {state.status === 'ready' && state.orders.length > 0 && (
        <ul className="mt-6 flex flex-col gap-4">
          {state.orders.map((order) => {
            const outcome = outcomes[order.id]
            const statusKey = orderStatusLabelKey(order.status)
            return (
              <li
                key={order.id}
                className="rounded-card border border-border-hairline bg-well p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-base font-semibold text-text-ink">
                    <Link
                      to={`/account/orders/${order.id}`}
                      className={`${FOCUS_RING} rounded-card underline`}
                    >
                      {order.orderNumber}
                    </Link>
                  </h2>
                  {/*
                    🔴 THE LABEL COMES FROM `orderStatusLabelKey`, the one place
                    a wire status becomes a translation key (F0, DEC-066). An
                    unknown status never reaches here — the transport rejects
                    the row — but the null branch is rendered rather than
                    asserted away.
                  */}
                  <span
                    className={`inline-flex items-center rounded-round border px-2.5 py-0.5 text-xs font-medium ${statusBadgeClass(order.status)}`}
                  >
                    {statusKey === null ? order.status : t(statusKey)}
                  </span>
                </div>

                <p className="mt-1 text-sm text-text-muted">
                  {t('history.placed', {
                    date: new Date(order.createdAt).toLocaleDateString(i18n.language),
                  })}
                </p>

                {/* REQ-F-050's item breakdown, on the history itself. */}
                <ul className="mt-3 flex flex-col gap-1 border-t border-border-hairline pt-3">
                  {order.items.map((item) => (
                    <li key={item.productId} className="flex flex-wrap items-baseline gap-2 text-sm">
                      <Link
                        to={`/product/${item.slug}`}
                        className={`${FOCUS_RING} rounded-card text-text-ink underline`}
                      >
                        {/* The FROZEN name — what was agreed, not what the
                            catalogue calls it today. Resolved per render, so a
                            language toggle costs no request. */}
                        {language === 'he' ? item.nameHe : item.nameEn}
                      </Link>
                      <span className="text-text-muted">{t('history.quantity', { count: item.quantity })}</span>
                      <PriceBlock price={item.unitPrice} />
                    </li>
                  ))}
                </ul>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border-hairline pt-3">
                  <p className="flex items-baseline gap-2 text-sm">
                    <span className="text-text-muted">{t('history.total')}</span>
                    <PriceBlock price={order.totalAmount} />
                  </p>

                  {order.cancellable &&
                    (confirming === order.id ? (
                      /*
                       * 🔴 CANCELLING ASKS FIRST — the same treatment the admin
                       * screen got, for the same reason. `cancelled` is
                       * terminal in §8.9, it restores stock, and there is no
                       * undo anywhere in this system.
                       */
                      <div className="flex flex-col gap-2 rounded-card border border-state-error p-3">
                        <p className="text-sm text-state-error">{t('history.cancelAsk')}</p>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="danger"
                            /*
                             * 🔴 `aria-disabled`, NEVER `disabled` — and NOT
                             * `loading`, which forces `disabled` inside
                             * `Button`. A disabled attribute landing on the
                             * focused element makes the browser BLUR it, and
                             * the confirm block then unmounts, so focus is
                             * lost and never restored — on the one
                             * irreversible action this screen has. jsdom does
                             * not model that blur, so no test here can see it;
                             * ISSUE-098 measured it in Chromium.
                             */
                            aria-disabled={busyId === order.id || undefined}
                            onClick={() => {
                              if (busyId === order.id) return
                              void confirmCancel(order.id)
                            }}
                          >
                            {t('history.cancelConfirm')}
                          </Button>
                          <Button onClick={() => setConfirming(null)}>{t('history.cancelAbort')}</Button>
                        </div>
                      </div>
                    ) : (
                      <Button variant="secondary" onClick={() => setConfirming(order.id)}>
                        {t('history.cancel')}
                      </Button>
                    ))}
                </div>

                {outcome !== undefined && (
                  /*
                   * 🔴 VISIBLE ONLY — the announcing is done by the ONE live
                   * region at the top of this page, and this paragraph
                   * deliberately carries no role. Failures only: a success
                   * removes the row and speaks through the dialog.
                   *
                   * ⚠️ THE FIRST VERSION PUT `role="status"` HERE and it could
                   * announce NEVER OR ONCE: a live region inserted into the DOM
                   * together with its text is unreliably spoken, and the nonce
                   * that was meant to force a repeat sat on an ATTRIBUTE, which
                   * is not a text change at all. Both found in review.
                   */
                  <p className="mt-2 text-sm text-state-error">{outcomeText(outcome, t)}</p>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {/*
        The user's twelfth list — a successful cancellation pops a dialog.
        CenterDialog, like every other page-level confirmation (ClubPage,
        CartDrawer) — Modal underneath owns the a11y contract (trap, Escape,
        inert background); return focus goes to the page heading, because
        the button that opened this unmounted with its row.
      */}
      <CenterDialog
        open={cancelledDialog !== null}
        onClose={() => setCancelledDialog(null)}
        title={t('history.cancelledDialog.title')}
        returnFocusRef={headingRef}
      >
        <div className="flex flex-col items-start gap-4 p-5">
          <p className="text-sm text-text-ink">
            {cancelledDialog?.alreadyCancelled
              ? t('history.cancelledDialog.bodyAlready')
              : t('history.cancelledDialog.body')}
          </p>
          <Button onClick={() => setCancelledDialog(null)}>
            {t('history.cancelledDialog.ok')}
          </Button>
        </div>
      </CenterDialog>
    </div>
  )
}
