import { useCallback, useEffect, useRef, useState } from 'react'
import { TextLink } from '../components/ui/TextLink'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/ui/Button'
import { FOCUS_RING } from '../components/ui/focusRing'
import { Pager } from '../components/ui/Pager'
import { PriceBlock } from '../components/catalog/PriceBlock'
import {
  reconcileStuckOrders as reconcileApi,
  requestAdminOrders,
  requestStuckOrders,
  transitionOrder,
} from '../lib/adminOrdersApi'
import { orderStatusLabelKey, type OrderStatusName } from '../lib/orderStatus'
import type {
  AdminListFailure,
  AdminOrdersPage as AdminOrdersPageModel,
  TransitionFailure,
} from '../types/adminOrders'

/**
 * MILESTONE-008 Checkpoint F3 — the minimal admin orders screen. ISSUE-083's
 * remaining half.
 *
 * 🔴 THE FOUR ADMIN TRANSITIONS HAVE BEEN IMPLEMENTED, TESTED AND UNREACHABLE
 * SINCE CHECKPOINT E. `requireAdmin` and `PATCH /:id/status` arrived with
 * DEC-065, the list with F3a; this is the screen that lets a human use them.
 *
 * 🔴 EVERY BUTTON COMES FROM THE ROW'S OWN `allowedTransitions`, computed
 * server-side from §8.9's table. This file contains no copy of that table and
 * must never grow one.
 *
 * ⚠️ THE CLIENT GUARD IS UX ONLY. `requireAdmin` reads the role from the
 * database on every request (DEC-065); nothing here is a security boundary.
 */

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; page: AdminOrdersPageModel }
  | { status: 'failed'; failure: AdminListFailure }

type RowOutcome =
  | { kind: 'moved'; status: OrderStatusName; restoredStock: boolean }
  | { kind: 'unchanged' }
  | { kind: 'failed'; failure: TransitionFailure }

export function AdminOrdersPage() {
  const { t, i18n } = useTranslation('admin')
  const { t: statusT } = useTranslation('orders')
  const [page, setPage] = useState(1)
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  /**
   * 🔴 KEYED BY ORDER, NOT ONE GLOBAL SLOT — both of them.
   *
   * `busyRow` was a single id cleared unconditionally, so with two moves in
   * flight the first response re-enabled the SECOND row's buttons while its
   * own request was still running, inviting a duplicate PATCH. `outcome` was
   * one slot, so the second result overwrote the first and a completed move
   * showed no confirmation at all.
   */
  const [busy, setBusy] = useState<Record<string, true>>({})
  const [outcomes, setOutcomes] = useState<Record<string, RowOutcome>>({})
  /** Which row is asking "are you sure?" — cancellation is irreversible. */
  const [confirmingCancel, setConfirmingCancel] = useState<string | null>(null)
  /**
   * ISSUE-103 — which row is collecting a tracking number for the move to
   * `shipped`, and the draft value. One row at a time, like the cancel
   * question; the number is OPTIONAL (REQ-F-047: "where one exists"), so the
   * confirm goes through with the field empty.
   */
  const [shippingRow, setShippingRow] = useState<string | null>(null)
  const [trackingDraft, setTrackingDraft] = useState('')
  /**
   * 🔴 THE SHIP FLOW MOVES FOCUS DELIBERATELY, three times — review finding,
   * and the exact unmount-on-success family browser-verification.md names.
   * Opening the panel unmounts the pressed trigger, so focus goes TO the
   * tracking input (the thing the admin was just asked to fill). Aborting
   * unmounts the abort button, so focus goes BACK to the re-rendered trigger
   * (found by [data-ship-trigger] inside the row — Button forwards no ref,
   * ISSUE-026). Confirming unmounts the whole panel, so focus lands on the
   * row itself (tabIndex -1) while the existing live region announces the
   * outcome. Without this, all three paths dropped focus to <body>.
   */
  const trackingInputRef = useRef<HTMLInputElement>(null)
  const rowRefs = useRef(new Map<string, HTMLLIElement>())
  const previousShippingRow = useRef<string | null>(null)
  const shipCloseIntent = useRef<'abort' | 'confirm' | null>(null)

  useEffect(() => {
    const previous = previousShippingRow.current
    previousShippingRow.current = shippingRow
    if (shippingRow !== null) {
      trackingInputRef.current?.focus()
      return
    }
    if (previous === null) return
    const row = rowRefs.current.get(previous)
    const intent = shipCloseIntent.current
    shipCloseIntent.current = null
    if (!row) return
    if (intent === 'abort') {
      row.querySelector<HTMLElement>('[data-ship-trigger]')?.focus()
    } else if (intent === 'confirm') {
      row.focus()
    }
  }, [shippingRow])
  /**
   * Announced to assistive tech; see the live region below.
   *
   * 🔴 THE NONCE IS LOAD-BEARING. A live region announces a CHANGE in its
   * text. Move order A to picking, then order B to picking: the string is
   * identical, React bails out, the DOM never changes and nothing is
   * announced — so a screen-reader admin working a queue is told about the
   * first order and then nothing at all, which is precisely the workflow this
   * screen exists for. Alternating an invisible trailing space guarantees the
   * text differs every time.
   */
  const [announcement, setAnnouncement] = useState({ text: '', nonce: 0 })
  const requestId = useRef(0)

  /**
   * ISSUE-082's trigger — DEC-069. The READ runs on load because it is safe;
   * the REPAIR is a deliberate act behind a confirmation.
   */
  const [stuck, setStuck] = useState<
    { status: 'idle' } | { status: 'ready'; count: number } | { status: 'failed' }
  >({ status: 'idle' })
  const reconcileHeadingRef = useRef<HTMLHeadingElement>(null)
  const [confirmingReconcile, setConfirmingReconcile] = useState(false)
  const [reconciling, setReconciling] = useState(false)
  const [reconcileOutcome, setReconcileOutcome] = useState<string | null>(null)

  const countStuck = useCallback(async () => {
    const result = await requestStuckOrders()
    /*
     * ⚠️ A FAILED COUNT IS QUIET, NOT INVISIBLE. It stays a diagnostic beside
     * the queue rather than an error banner pushing the orders down — but it
     * must not HIDE THE REPAIR, which is what the first version did: the panel
     * was gated on `count > 0`, so a 503 from the count made a perfectly
     * healthy sweep unreachable with nothing on screen to explain it.
     */
    setStuck(result.ok ? { status: 'ready', count: result.count } : { status: 'failed' })
  }, [])

  useEffect(() => {
    void countStuck()
  }, [countStuck])

  async function runReconcile() {
    setReconciling(true)
    const result = await reconcileApi()
    setReconciling(false)
    setConfirmingReconcile(false)

    const text = result.ok
      ? [
          result.report.failed.length > 0
            ? t('reconcile.outcome.partial', {
                repaired: result.report.repaired,
                failed: result.report.failed.length,
              })
            : t('reconcile.outcome.repaired', { count: result.report.repaired }),
          /*
           * 🔴 AND HOW MANY REMAIN, because one sweep repairs at most 100. A
           * run that hit the cap otherwise reads as complete — "100 repaired"
           * with no hint of the 300 still stuck. Found in review.
           */
          result.report.remaining > 0
            ? t('reconcile.failure.remaining', { count: result.report.remaining })
            : '',
        ]
          .filter((part) => part !== '')
          .join(' ')
      /*
       * ⚠️ NOT `failure.*` — that holds the TRANSITION refusals (terminal,
       * concurrent, …), which say nothing about a sweep being refused; the
       * first version reached for it and rendered a raw key.
       *
       * 🔴 AND NOT `state.unavailable` EITHER, which reads "The orders could
       * not be loaded" — telling an admin the LIST failed while the list is
       * visibly fine, and saying nothing about the repair they just ran. The
       * generic failure gets its own sentence; the rest (`notAdmin`,
       * `unauthenticated`, `offline`, `rateLimited`) describe the CALLER's
       * situation and read correctly either way. Found in review.
       */
      : result.failure.kind === 'unavailable'
        ? t('reconcile.failure.unavailable')
        : t(`state.${result.failure.kind}`)

    setReconcileOutcome(text)
    // The same nonce the row outcomes use: a live region announces a CHANGE,
    // and two identical reports would otherwise be spoken once.
    setAnnouncement((previous) => ({ text, nonce: previous.nonce + 1 }))

    /*
     * 🔴 FOCUS GOES SOMEWHERE DELIBERATE. The confirm button unmounts the
     * moment the confirmation closes, so without this it falls to <body> and
     * the admin tabs from the top of the document — on the screen whose whole
     * job is working through a queue.
     */
    reconcileHeadingRef.current?.focus()

    if (result.ok) {
      await countStuck()
      // Repaired orders have MOVED, so the queue below is now stale.
      if (result.report.repaired > 0) void load(page, { quiet: true })
    }
  }

  const load = useCallback(async (next: number, options?: { quiet?: boolean }) => {
    // The same staleness rule the checkout screen settled: the last REQUEST
    // wins, not the last response.
    const id = ++requestId.current
    /*
     * 🔴 A REFRESH AFTER A MOVE IS QUIET. Replacing the whole list with the
     * loading line unmounted the row an admin was working, dropped keyboard
     * focus to <body>, and forced a tab from the top of the document for every
     * single order in the queue.
     */
    if (!options?.quiet) setState({ status: 'loading' })
    const result = await requestAdminOrders(next)
    if (id !== requestId.current) return
    setState(result.ok ? { status: 'ready', page: result.page } : { status: 'failed', failure: result.failure })
  }, [])

  useEffect(() => {
    void load(page)
  }, [load, page])

  function statusLabel(status: OrderStatusName): string {
    const key = orderStatusLabelKey(status)
    return key ? statusT(key) : status
  }

  function outcomeText(outcome: RowOutcome): string {
    if (outcome.kind === 'moved') {
      return `${t('result.moved', { status: statusLabel(outcome.status) })}${
        outcome.restoredStock ? ` ${t('result.stockRestored')}` : ''
      }`
    }
    if (outcome.kind === 'unchanged') return t('result.unchanged')
    return failureText(outcome.failure, t)
  }

  async function move(orderId: string, to: OrderStatusName, trackingNumber?: string) {
    setConfirmingCancel(null)
    setShippingRow(null)
    setBusy((current) => ({ ...current, [orderId]: true }))
    setOutcomes((current) => {
      const next = { ...current }
      delete next[orderId]
      return next
    })

    const result = await transitionOrder(orderId, to, trackingNumber)

    // 🔴 Clear only THIS row. Clearing unconditionally re-enabled whichever
    // row happened to be busy, which is not the one that just finished.
    setBusy((current) => {
      const next = { ...current }
      delete next[orderId]
      return next
    })

    const outcome: RowOutcome = result.ok
      ? result.changed
        ? { kind: 'moved', status: result.status, restoredStock: result.restoredStock }
        : { kind: 'unchanged' }
      : { kind: 'failed', failure: result.failure }

    setOutcomes((current) => ({ ...current, [orderId]: outcome }))
    /*
     * 🔴 ANNOUNCED THROUGH A LIVE REGION THAT ALREADY EXISTS. Inserting a
     * `role="status"` element together with its text is commonly not announced
     * at all, so the confirmation was visual-only in practice. The region is
     * rendered empty from the start and only its CONTENT changes here.
     */
    setAnnouncement((current) => ({ text: outcomeText(outcome), nonce: current.nonce + 1 }))

    // The row's allowed moves were computed for the status it HAD; a quiet
    // reload replaces them without tearing the screen down.
    if (result.ok) void load(page, { quiet: true })
  }

  return (
    <main className="mx-auto flex max-w-[1100px] flex-col gap-4 px-4 py-6">
      <h1 className="heading-page">{t('page.title')}</h1>

      {/* Present from first render, so a later message is an UPDATE to it. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement.text}
        {announcement.nonce % 2 === 1 ? ' ' : ''}
      </p>

      {/*
        🔴 ISSUE-082'S TRIGGER — DEC-069, Checkpoint G3.

        The sweep has existed since Checkpoint E and NOTHING HAS EVER CALLED
        IT: a swallowed failure returns 201, so no retry is sent, and an order
        can sit at `pending_payment` with its stock gone and no transition out
        — not even an admin's, because §8.9 allows only `paid` or `cancelled`
        from there.

        ⚠️ THE COUNT IS SHOWN BEFORE THE REPAIR IS OFFERED. Counting changes
        nothing; repairing MARKS ORDERS PAID. An admin should not be asked to
        run a batch write to find out whether it was needed — and if the
        payment ordering ever changes, this button starts inventing revenue,
        which is the warning `orderReconciliation.ts` carries in its header.
      */}
      {/*
        🔴 SHOWN WHILE ANYTHING IS STUCK, WHILE AN OUTCOME IS UNREAD, OR WHEN
        THE COUNT COULD NOT BE READ — and each of those three is a defect this
        panel had.

        A fully successful sweep set the outcome text and then refreshed the
        count to ZERO, which unmounted this whole section: the "2 orders
        repaired" line vanished with it, and the confirm button that still had
        focus went with it too — ISSUE-098 for the THIRD time, in the very
        commit whose own test was written to prevent it. A partial repair
        survived, because the count stayed above zero, which is exactly why it
        looked fine.

        And gating solely on `count > 0` made the whole feature unreachable
        whenever the COUNT read failed — a diagnostic that is allowed to fail
        silently was standing in front of a repair that was perfectly healthy.
      */}
      {(stuck.status === 'failed' || (stuck.status === 'ready' && stuck.count > 0) || reconcileOutcome !== null) && (
        <section className="flex flex-col gap-2 rounded-card border border-state-warning bg-well p-4">
          <h2
            id="reconcile-heading"
            // -1: a landing target for the focus move after a sweep, and NOT in
            // anyone's tab order.
            tabIndex={-1}
            ref={reconcileHeadingRef}
            className={`${FOCUS_RING} rounded-card text-base font-semibold text-text-ink`}
          >
            {t('reconcile.title')}
          </h2>
          {/*
            ⚠️ THREE STATES, NOT TWO. A count of ZERO is not "0 orders are
            stuck" — after a successful sweep the panel is open only to show
            its report, and announcing a count of nothing beside it reads as a
            broken template. Nothing is said in that case; the outcome speaks.
          */}
          {stuck.status === 'ready' && stuck.count > 0 && (
            <p className="text-sm text-text-muted">{t('reconcile.found', { count: stuck.count })}</p>
          )}
          {stuck.status === 'failed' && (
            <p className="text-sm text-text-muted">{t('reconcile.countUnavailable')}</p>
          )}

          {confirmingReconcile ? (
            <div className="flex flex-col gap-2 rounded-card border border-state-error p-3">
              {/* It marks orders PAID in a batch, with no per-order review. */}
              <p className="text-sm text-state-error">{t('reconcile.ask')}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="danger"
                  aria-disabled={reconciling || undefined}
                  onClick={() => {
                    if (reconciling) return
                    void runReconcile()
                  }}
                >
                  {t('reconcile.confirm')}
                </Button>
                <Button onClick={() => setConfirmingReconcile(false)}>{t('reconcile.abort')}</Button>
              </div>
            </div>
          ) : (
            <div>
              <Button variant="secondary" onClick={() => setConfirmingReconcile(true)}>
                {t('reconcile.action')}
              </Button>
            </div>
          )}

          {reconcileOutcome !== null && (
            <p className="text-sm text-text-muted">{reconcileOutcome}</p>
          )}
        </section>
      )}

      {state.status === 'loading' && <p className="text-sm text-text-muted">{t('state.loading')}</p>}

      {state.status === 'failed' && (
        <ListFailureNotice failure={state.failure} onRetry={() => void load(page)} />
      )}

      {state.status === 'ready' && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-text-muted">{t('page.count', { count: state.page.totalItems })}</p>
            {/*
              🔴 FOUR FAILURE MESSAGES TELL THE ADMIN TO REFRESH THE LIST, and
              until now the screen offered no way to do it — the retry existed
              only when the initial load had failed. They were being told to do
              something only the browser's reload button could.
            */}
            <Button onClick={() => void load(page, { quiet: true })}>{t('page.refresh')}</Button>
          </div>

          {state.page.orders.length === 0 ? (
            <p className="text-sm text-text-ink">{t('page.empty')}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {state.page.orders.map((order) => {
                const rowBusy = busy[order.id] === true
                const outcome = outcomes[order.id]
                return (
                  <li
                    key={order.id}
                    // -1: a deliberate landing target after the ship panel
                    // closes on confirm — NOT in anyone's tab order.
                    tabIndex={-1}
                    ref={(element) => {
                      if (element) rowRefs.current.set(order.id, element)
                      else rowRefs.current.delete(order.id)
                    }}
                    className={`${FOCUS_RING} flex flex-col gap-2 rounded-card border border-border-card p-4`}
                  >
                    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
                      <span className="font-semibold text-text-ink" dir="ltr">
                        {order.orderNumber}
                      </span>
                      <span className="text-text-muted">{statusLabel(order.status)}</span>
                      <span className="text-text-muted">{order.customerEmail}</span>
                      {/*
                        🔴 THE DATE IS RENDERED. It was fetched, validated and
                        dropped, which made the server's deliberate
                        newest-first ordering invisible — an admin could not
                        tell a ten-minute-old order from a ten-day-old one.
                      */}
                      <span className="text-text-muted">
                        {t('row.placed', {
                          date: new Date(order.createdAt).toLocaleDateString(i18n.language),
                        })}
                      </span>
                      <span className="text-text-muted">{t('row.items', { count: order.itemCount })}</span>
                      <PriceBlock price={order.totalAmount} />
                    </div>

                    {confirmingCancel === order.id ? (
                      /*
                       * 🔴 CANCELLING IS IRREVERSIBLE AND RESTORES STOCK.
                       * `cancelled` is terminal in §8.9 — there is no undo
                       * anywhere in this system — and it sat beside "move to
                       * shipped", same size, same row, distinguished only by
                       * colour. One misclick permanently killed a customer's
                       * order. Every other move here is recoverable; this one
                       * gets a question first.
                       */
                      <div className="flex flex-col gap-2 rounded-card border border-state-error p-3">
                        <p className="text-sm text-state-error">{t('row.cancelAsk')}</p>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="danger"
                            loading={rowBusy}
                            disabled={rowBusy}
                            onClick={() => void move(order.id, 'cancelled')}
                          >
                            {t('row.cancelConfirm')}
                          </Button>
                          <Button onClick={() => setConfirmingCancel(null)}>{t('row.cancelAbort')}</Button>
                        </div>
                      </div>
                    ) : shippingRow === order.id ? (
                      /*
                       * ISSUE-103 — the tracking number's ONLY writer in the
                       * system. Optional, so confirming with the field empty
                       * ships without one ("where one exists", REQ-F-047).
                       */
                      <div className="flex flex-col gap-2 rounded-card border border-border-card p-3">
                        <label htmlFor={`tracking-${order.id}`} className="text-sm text-text-ink">
                          {t('row.trackingLabel')}
                        </label>
                        {/*
                          dir="ltr": a courier reference is LTR data; typed
                          inside the Hebrew page it would otherwise render with
                          its digits and letters reordered around the caret.
                        */}
                        <input
                          id={`tracking-${order.id}`}
                          ref={trackingInputRef}
                          dir="ltr"
                          maxLength={64}
                          autoComplete="off"
                          value={trackingDraft}
                          onChange={(event) => setTrackingDraft(event.target.value)}
                          className={`${FOCUS_RING} w-full max-w-xs rounded-card border border-border-card bg-transparent px-2 py-1 text-sm text-text-ink`}
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="primary"
                            loading={rowBusy}
                            disabled={rowBusy}
                            onClick={() => {
                              shipCloseIntent.current = 'confirm'
                              void move(order.id, 'shipped', trackingDraft)
                            }}
                          >
                            {t('row.move', { status: statusLabel('shipped') })}
                          </Button>
                          <Button
                            onClick={() => {
                              shipCloseIntent.current = 'abort'
                              setShippingRow(null)
                            }}
                          >
                            {t('row.shipAbort')}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        {order.allowedTransitions.length === 0 ? (
                          <span className="text-xs text-text-muted">{t('row.noActions')}</span>
                        ) : (
                          order.allowedTransitions.map((target) => (
                            <Button
                              key={target}
                              variant={target === 'cancelled' ? 'danger' : 'primary'}
                              // `loading` is what drives aria-busy; `disabled`
                              // alone announces nothing about being in flight.
                              loading={rowBusy}
                              disabled={rowBusy}
                              // The abort-path focus target: Button forwards
                              // no ref (ISSUE-026), so the effect finds the
                              // trigger by attribute inside the row.
                              {...(target === 'shipped' ? { 'data-ship-trigger': true } : {})}
                              onClick={() => {
                                if (target === 'cancelled') {
                                  setShippingRow(null)
                                  setConfirmingCancel(order.id)
                                } else if (target === 'shipped') {
                                  // The tracking question — ISSUE-103. One row
                                  // at a time, and a fresh draft each time.
                                  // Focus moves to the input via the effect.
                                  setConfirmingCancel(null)
                                  setTrackingDraft('')
                                  setShippingRow(order.id)
                                } else {
                                  void move(order.id, target)
                                }
                              }}
                            >
                              {t('row.move', { status: statusLabel(target) })}
                            </Button>
                          ))
                        )}
                      </div>
                    )}

                    {outcome && (
                      <p
                        className={`text-sm ${
                          outcome.kind === 'failed' ? 'text-state-error' : 'text-text-ink'
                        }`}
                      >
                        {outcomeText(outcome)}
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          {/* The shared Pager (M-010 review) — it also replaced this page's
              native `disabled`, which blurred the focused button at either
              end of the range (the Chromium disable-blur family). */}
          <Pager
            page={state.page.page}
            totalPages={state.page.totalPages}
            onPage={(next) => setPage(next)}
          />
        </>
      )}
    </main>
  )
}

/**
 * 🔴 EXPLICIT BRANCHES, NOT A TERNARY CHAIN WITH A FALLBACK. The checkout
 * screen shipped that shape and silently lost two whole outcomes.
 */
function failureText(
  failure: TransitionFailure,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  switch (failure.kind) {
    case 'terminal':
      return t('failure.terminal')
    case 'notATransition':
      return t('failure.notATransition')
    case 'concurrent':
      return t('failure.concurrent')
    case 'forbiddenMove':
      return t('failure.forbiddenMove')
    case 'gone':
      return t('failure.gone')
    case 'notAdmin':
      return t('state.notAdmin')
    case 'unauthenticated':
      return t('state.unauthenticated')
    case 'rateLimited':
      return t('state.rateLimited')
    case 'offline':
      return t('state.offline')
    case 'server':
      return t('failure.server')
  }
}

function ListFailureNotice({
  failure,
  onRetry,
}: {
  failure: AdminListFailure
  onRetry: () => void
}) {
  const { t } = useTranslation('admin')

  if (failure.kind === 'unauthenticated') {
    return (
      <div role="alert" className="flex flex-col items-start gap-2">
        <p className="text-sm text-state-error">{t('state.unauthenticated')}</p>
        <TextLink to="/login">
          {t('state.signIn')}
        </TextLink>
      </div>
    )
  }

  if (failure.kind === 'notAdmin') {
    // 🔴 No retry: pressing again cannot make an account an administrator.
    return (
      <p role="alert" className="text-sm text-state-error">
        {t('state.notAdmin')}
      </p>
    )
  }

  if (failure.kind === 'rateLimited') {
    // 🔴 No retry either — the fix is waiting, and a button says otherwise.
    return (
      <p role="alert" className="text-sm text-state-error">
        {t('state.rateLimited')}
      </p>
    )
  }

  return (
    <div role="alert" className="flex flex-col items-start gap-2">
      <p className="text-sm text-state-error">
        {failure.kind === 'offline' ? t('state.offline') : t('state.unavailable')}
      </p>
      <Button onClick={onRetry}>{t('state.retry')}</Button>
    </div>
  )
}
