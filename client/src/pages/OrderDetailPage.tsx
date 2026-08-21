import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/ui/Button'
import { FOCUS_RING } from '../components/ui/focusRing'
import { PriceBlock } from '../components/catalog/PriceBlock'
import { requestOrder } from '../lib/ordersApi'
import { addCartItem } from '../lib/cartApi'
import { useCartRefresh } from '../state/CartContext'
import { orderStatusLabelKey } from '../lib/orderStatus'
import type { SupportedLanguage } from '../i18n'
import type { OrderDetail, OrderDetailResult } from '../types/orderHistory'

/**
 * MILESTONE-008 Checkpoint G2 — one order, REQ-F-050's other half.
 *
 * 🔴 THIS IS THE ONLY CONSUMER OF `GET /api/orders/:id`, the route TEST-050b
 * guards. Without it that endpoint would exist purely to satisfy a contract and
 * a security test, which is how a route drifts out of use and then out of
 * correctness.
 *
 * 🔴 "NOT FOUND" IS ONE MESSAGE, and deliberately so. DEC-070 makes an order
 * that does not exist and an order belonging to somebody else byte-identical on
 * the wire; rendering two different sentences here would rebuild the
 * enumeration oracle in the interface, where it reads just as clearly.
 */

type LoadState = { status: 'loading' } | { status: 'done'; result: OrderDetailResult }

/**
 * 🔴 OFFERED FOR A FAILURE, AND KEPT MOUNTED WHILE A RETRY IS IN FLIGHT —
 * `retryPending` is what distinguishes "still loading for the first time"
 * (no button, nothing has failed yet) from "retrying" (button stays, holding
 * focus). The home page's ISSUE-098 fix uses the same flag for the same reason.
 *
 * ⚠️ Not offered for `rateLimited` or `unauthenticated`: waiting fixes one and
 * signing in fixes the other, and a button that re-hits either is a dead end.
 */
function retryable(state: LoadState, retryPending: boolean): boolean {
  if (state.status === 'loading') return retryPending
  if (state.result.ok) return false
  const kind = state.result.failure.kind
  return kind !== 'rateLimited' && kind !== 'unauthenticated'
}

export function OrderDetailPage() {
  const { t, i18n } = useTranslation('orders')
  const language = i18n.language as SupportedLanguage
  const params = useParams()
  const orderId = typeof params.id === 'string' ? params.id : ''
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  /**
   * 🔴 THE RETRY BUTTON DID NOT RETRY, and this key is the fix. It called
   * `setState({ status: 'loading' })` and nothing else — the fetch lives in an
   * effect keyed on `[orderId]`, which does not change when the same order is
   * retried. So pressing Try again cleared the error, hid the button, and left
   * the page on "Loading the order…" FOREVER; only a full reload recovered.
   *
   * ⚠️ NO TEST TOUCHED THE BUTTON, which is why the suite was green. Found in
   * review, reproduced with a probe before being fixed.
   */
  const [reloadKey, setReloadKey] = useState(0)
  const [retryPending, setRetryPending] = useState(false)

  useEffect(() => {
    let live = true
    setState({ status: 'loading' })
    void requestOrder(orderId).then((result) => {
      if (live) setRetryPending(false)
      // ⚠️ Guarded, so a slow answer for a previous id — or for a superseded
      // retry — cannot overwrite a newer one.
      if (live) setState({ status: 'done', result })
    })
    return () => {
      live = false
    }
  }, [orderId, reloadKey])

  return (
    <div className="px-7 py-8">
      <Link to="/account/orders" className={`${FOCUS_RING} rounded-card text-sm text-brand-teal underline`}>
        {t('detail.back')}
      </Link>

      <p role="status" className="mt-4 text-sm text-text-muted">
        {state.status === 'loading' ? t('detail.loading') : ''}
        {state.status === 'done' && !state.result.ok
          ? state.result.failure.kind === 'notFound'
            ? t('detail.notFound')
            : t(`history.failure.${state.result.failure.kind}`)
          : ''}
      </p>

      {/*
        🔴 MOUNTED THROUGH THE RETRY, `aria-disabled` while it runs — ISSUE-098,
        which was fixed on the home page ONE COMMIT before this file was written
        and then reintroduced here. A button that unmounts under the pointer
        drops keyboard focus to <body>, and `disabled` does the same thing by
        blurring the focused element the moment the attribute lands.

        ⚠️ NO RETRY ON A 429 or on `unauthenticated`: waiting fixes the first,
        and signing in fixes the second — a button that re-hits either is the
        dead-end refusal ISSUE-080 recorded.
      */}
      {retryable(state, retryPending) && (
        <Button
          variant="secondary"
          className="mt-3"
          aria-disabled={state.status === 'loading' || undefined}
          onClick={() => {
            if (state.status === 'loading') return
            setRetryPending(true)
            setReloadKey((key) => key + 1)
          }}
        >
          {t('history.retry')}
        </Button>
      )}

      {state.status === 'done' &&
        !state.result.ok &&
        state.result.failure.kind === 'unauthenticated' && (
          <Link
            to="/login"
            className={`${FOCUS_RING} mt-3 inline-block rounded-card text-sm text-brand-teal underline`}
          >
            {t('history.signIn')}
          </Link>
        )}

      {state.status === 'done' && state.result.ok && (
        <OrderBody order={state.result.order} language={language} />
      )}
    </div>
  )
}

function OrderBody({ order, language }: { order: OrderDetail; language: SupportedLanguage }) {
  const { t, i18n } = useTranslation('orders')
  const statusKey = orderStatusLabelKey(order.status)
  const refreshCart = useCartRefresh()
  // ISSUE-172 — reorder. Sequential adds through the SAME cart API every
  // surface uses (server clamps stock, refuses inactive rows); the outcome
  // is announced from an always-mounted status region, and the button
  // survives its own success (aria-disabled while busy, never unmounted).
  const [reorderBusy, setReorderBusy] = useState(false)
  const [reorderOutcome, setReorderOutcome] = useState<{ id: number; text: string } | null>(null)

  async function reorder() {
    if (reorderBusy) return
    setReorderBusy(true)
    const failures: string[] = []
    let added = 0
    for (const item of order.items) {
      const name = language === 'he' ? item.nameHe : item.nameEn
      const result = await addCartItem(item.slug, item.quantity, name)
      if (result.ok) {
        added += 1
      } else {
        failures.push(name)
      }
    }
    await refreshCart()
    setReorderBusy(false)
    const summary =
      failures.length === 0
        ? t('detail.reorderDone', { added })
        : t('detail.reorderPartial', { added, total: order.items.length, names: failures.join(', ') })
    setReorderOutcome((previous) => ({ id: (previous?.id ?? 0) + 1, text: summary }))
  }

  return (
    <article className="mt-4">
      <h1 className="heading-page">
        {t('detail.title', { orderNumber: order.orderNumber })}
      </h1>

      <p className="mt-1 text-sm text-text-muted">
        {t('history.placed', { date: new Date(order.createdAt).toLocaleDateString(i18n.language) })}
        {' · '}
        {statusKey === null ? order.status : t(statusKey)}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          loading={reorderBusy}
          aria-disabled={reorderBusy || undefined}
          onClick={() => void reorder()}
        >
          {t('detail.reorder')}
        </Button>
        {/* Always mounted; keyed so a repeat outcome re-announces. */}
        <p role="status" aria-live="polite" className="text-sm text-brand-teal">
          {reorderOutcome !== null && <span key={reorderOutcome.id}>{reorderOutcome.text}</span>}
        </p>
      </div>

      <ul className="mt-4 flex flex-col gap-2">
        {order.items.map((item) => (
          <li key={item.productId} className="flex flex-wrap items-baseline gap-2 text-sm">
            <Link to={`/product/${item.slug}`} className={`${FOCUS_RING} rounded-card text-text-ink underline`}>
              {language === 'he' ? item.nameHe : item.nameEn}
            </Link>
            <span className="text-text-muted">{t('history.quantity', { count: item.quantity })}</span>
            <PriceBlock price={item.unitPrice} />
          </li>
        ))}
      </ul>

      <dl className="mt-6 flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap items-baseline gap-2">
          <dt className="text-text-muted">{t('detail.shippingCost')}</dt>
          <dd>
            <PriceBlock price={order.shippingCost} />
          </dd>
        </div>

        <div className="flex flex-col gap-1">
          <dt className="text-text-muted">{t('detail.shippingTo')}</dt>
          {/*
            🔴 NULL IS SELF PICKUP, NOT A MISSING ADDRESS, and it gets its own
            sentence rather than an empty block. The server sends null for
            exactly this case, and the G1 review found the branch untested
            precisely because every fixture was a courier order.
          */}
          <dd>
            {order.shippingAddress === null ? (
              t('detail.selfPickup')
            ) : (
              <span>
                {order.shippingAddress.line1}, {order.shippingAddress.city}
                {order.shippingAddress.zipCode === null ? '' : `, ${order.shippingAddress.zipCode}`}
              </span>
            )}
          </dd>
        </div>

        <div className="flex flex-wrap items-baseline gap-2">
          <dt className="text-text-muted">{t('detail.tracking')}</dt>
          {/* REQ-F-047 asks for a tracking number "where one exists" — most
              orders have none for most of their life, so the absence is stated
              rather than left as a blank. */}
          <dd>{order.trackingNumber ?? t('detail.noTracking')}</dd>
        </div>
      </dl>

      <p className="mt-6 text-base font-semibold text-text-ink">
        <PriceBlock price={order.totalAmount} />
      </p>
    </article>
  )
}
