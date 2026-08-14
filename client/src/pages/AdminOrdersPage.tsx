import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/ui/Button'
import { FOCUS_RING } from '../components/ui/focusRing'
import { PriceBlock } from '../components/catalog/PriceBlock'
import { requestAdminOrders, transitionOrder } from '../lib/adminOrdersApi'
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

  async function move(orderId: string, to: OrderStatusName) {
    setConfirmingCancel(null)
    setBusy((current) => ({ ...current, [orderId]: true }))
    setOutcomes((current) => {
      const next = { ...current }
      delete next[orderId]
      return next
    })

    const result = await transitionOrder(orderId, to)

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
      <h1 className="text-2xl font-semibold text-text-ink">{t('page.title')}</h1>

      {/* Present from first render, so a later message is an UPDATE to it. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement.text}
        {announcement.nonce % 2 === 1 ? ' ' : ''}
      </p>

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
                    className="flex flex-col gap-2 rounded-card border border-border-card p-4"
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
                              onClick={() =>
                                target === 'cancelled'
                                  ? setConfirmingCancel(order.id)
                                  : void move(order.id, target)
                              }
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

          {state.page.totalPages > 1 && (
            <div className="flex items-center gap-3">
              <Button disabled={state.page.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                {t('pager.previous')}
              </Button>
              <span className="text-sm text-text-muted">
                {t('pager.position', { page: state.page.page, total: state.page.totalPages })}
              </span>
              <Button
                disabled={state.page.page >= state.page.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                {t('pager.next')}
              </Button>
            </div>
          )}
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
        <Link to="/login" className={`${FOCUS_RING} rounded-card text-sm text-brand-teal underline`}>
          {t('state.signIn')}
        </Link>
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
