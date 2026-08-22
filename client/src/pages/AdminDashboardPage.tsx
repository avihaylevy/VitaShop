import { useCallback, useEffect, useState } from 'react'
import { TextLink } from '../components/ui/TextLink'
import { useTranslation } from 'react-i18next'
import { requestAdminDashboard } from '../lib/adminDashboardApi'
import { formatPrice } from '../lib/formatPrice'
import { parsePriceToMinor } from '../lib/money'
import { Surface } from '../components/ui/Surface'
import { FOCUS_RING } from '../components/ui/focusRing'
import type {
  AdminDashboardData,
  AdminDashboardFailure,
  DashboardRangeDays,
} from '../types/adminDashboard'

/**
 * DEC-101 — §4.7.4's dashboard/reports + §1.6's KPIs, and DEC-102's
 * low-stock panel (§4.7.2).
 *
 * 🔴 THE CLIENT DERIVES NO FIGURE OF RECORD. Totals, KPIs and the alert
 * list all arrive from GET /api/admin/dashboard (§3.4); the only local
 * arithmetic is PRESENTATION over server counts — proportional bar widths
 * and the funnel's stage-to-stage ratio, both derived from integers the
 * server sent and displayed beside those same integers.
 *
 * No chart dependency, deliberately: CSS bars carry the funnel and the
 * daily sales, the way the project's own icons are hand-written SVG.
 */

const RANGES: DashboardRangeDays[] = [7, 30, 90]

/** A failure that means THIS VIEWER may no longer read the dashboard —
 *  stale figures must not stay on screen behind it. Transient transport
 *  failures, by contrast, keep the cached view (analytics, not money). */
function failureRevokesAccess(failure: AdminDashboardFailure): boolean {
  return failure.kind === 'unauthenticated' || failure.kind === 'notAdmin'
}

/** The failure vocabulary — a lookup, not a branch chain, so a new
 *  AdminListFailure kind is a compile-visible hole here. */
const FAILURE_TEXT_KEY: Record<AdminDashboardFailure['kind'], string> = {
  unauthenticated: 'state.unauthenticated',
  notAdmin: 'state.notAdmin',
  rateLimited: 'state.rateLimited',
  offline: 'state.offline',
  unavailable: 'dashboard.unavailable',
}

/** A rate as a LTR-isolated percent; null means "no data", not 0%. */
function percentText(rate: number | null): string | null {
  if (rate === null) return null
  return `${(rate * 100).toFixed(1)}%`
}

/** Money-string → number for BAR WIDTHS only (never displayed). Fails
 *  closed: a malformed string draws no bar instead of a NaN% width. */
function turnoverMinor(value: string): number {
  return parsePriceToMinor(value) ?? 0
}

export function AdminDashboardPage() {
  const { t } = useTranslation('admin')
  const [days, setDays] = useState<DashboardRangeDays>(30)
  /**
   * The per-range cache (the analytics review's follow-up): toggling
   * 7 → 30 → 7 used to blank the screen and re-run the full 8-query
   * build each time. A cached range now renders INSTANTLY while the
   * fetch revalidates in the background and replaces it on arrival —
   * the range-independent arms (low stock, all-time repeat rate) stop
   * being recomputed just to redraw unchanged numbers.
   */
  const [cache, setCache] = useState<Partial<Record<DashboardRangeDays, AdminDashboardData>>>({})
  const [pending, setPending] = useState(true)
  const [failure, setFailure] = useState<AdminDashboardFailure | null>(null)

  const load = useCallback(async (range: DashboardRangeDays, isStale?: () => boolean) => {
    setPending(true)
    const result = await requestAdminDashboard(range)
    if (isStale?.()) return
    if (result.ok) {
      setCache((current) => ({ ...current, [range]: result.data }))
      setFailure(null)
    } else {
      setFailure(result.failure)
      // 🔴 An access-revoking failure CLEARS the cache: a signed-out or
      // demoted viewer must not keep reading figures behind the alert.
      if (failureRevokesAccess(result.failure)) setCache({})
    }
    setPending(false)
  }, [])

  useEffect(() => {
    let stale = false
    void load(days, () => stale)
    return () => {
      stale = true
    }
  }, [load, days])

  const data = cache[days]

  return (
    <main className="mx-auto flex max-w-[1100px] flex-col gap-6 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="heading-page">{t('dashboard.title')}</h1>
        {/* The range picker — server-validated values only (7/30/90). */}
        <div role="group" aria-label={t('dashboard.rangeLabel')} className="flex gap-1">
          {RANGES.map((range) => (
            <button
              key={range}
              type="button"
              aria-pressed={days === range}
              onClick={() => setDays(range)}
              className={`${FOCUS_RING} rounded-card border px-3 py-1.5 text-sm ${
                days === range
                  ? 'border-brand-teal bg-brand-teal text-white'
                  : 'border-border-control bg-well text-text-ink hover:bg-surface-sunken'
              }`}
            >
              {t('dashboard.rangeDays', { count: range })}
            </button>
          ))}
        </div>
      </div>

      {/* Nothing cached for this range yet: a real loading line. */}
      {!data && pending && (
        <p role="status" className="text-sm text-text-muted">
          {t('dashboard.loading')}
        </p>
      )}

      {/* The FULL failure block only when there is nothing to show —
          a transient failure over a cached view degrades to the quiet
          refresh notice below instead of blanking real figures. */}
      {!data && !pending && failure && (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="text-sm text-state-error">{t(FAILURE_TEXT_KEY[failure.kind])}</p>
          {failure.kind === 'unauthenticated' && (
            <TextLink to="/login">
              {t('state.signIn')}
            </TextLink>
          )}
          {/* Retry only where retrying can help — ListFailureNotice's rule:
              pressing again cannot make an account an administrator, and
              the fix for a rate limit is waiting, not hammering it. */}
          {(failure.kind === 'offline' || failure.kind === 'unavailable') && (
            <button
              type="button"
              onClick={() => void load(days)}
              className={`${FOCUS_RING} rounded-card border border-border-control px-3 py-1.5 text-sm`}
            >
              {t('state.retry')}
            </button>
          )}
        </div>
      )}

      {/* A failed REVALIDATION over cached data — say so quietly rather
          than silently showing stale figures (the quiet-lie family). */}
      {data && !pending && failure && (
        <p role="status" className="text-sm text-state-error">
          {t('dashboard.refreshFailed')}
        </p>
      )}

      {data && <DashboardBody data={data} />}
    </main>
  )
}

function DashboardBody({ data }: { data: AdminDashboardData }) {
  const { t, i18n } = useTranslation('admin')
  const language = i18n.language === 'he' ? 'he' : 'en'
  const productName = (row: { nameHe: string; nameEn: string }) =>
    language === 'he' ? row.nameHe : row.nameEn
  const money = (value: string) => formatPrice(value, language)

  const funnelStages = [
    { key: 'productView', count: data.funnel.productView },
    { key: 'addToCart', count: data.funnel.addToCart },
    { key: 'checkoutStarted', count: data.funnel.checkoutStarted },
    { key: 'purchaseCompleted', count: data.funnel.purchaseCompleted },
  ] as const
  const funnelMax = Math.max(1, ...funnelStages.map((stage) => stage.count))
  const dailyMax = Math.max(1, ...data.salesByDay.map((day) => turnoverMinor(day.turnover)))

  const kpiCards = [
    { key: 'conversionRate', value: percentText(data.kpis.conversionRate) },
    {
      key: 'averageOrderValue',
      value: data.kpis.averageOrderValue === null ? null : money(data.kpis.averageOrderValue),
    },
    { key: 'abandonmentRate', value: percentText(data.kpis.abandonmentRate) },
    { key: 'repeatPurchaseRate', value: percentText(data.kpis.repeatPurchaseRate) },
  ] as const

  return (
    <>
      {/* §1.6 — the four KPIs. A null rate renders as "no data", never 0%. */}
      <section aria-labelledby="dash-kpis" className="flex flex-col gap-2">
        <h2 id="dash-kpis" className="heading-section">
          {t('dashboard.kpis.title')}
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {kpiCards.map((card) => (
            <Surface key={card.key} variant="well" bordered className="flex flex-col gap-1 p-4">
              <span className="text-xs text-text-muted">{t(`dashboard.kpis.${card.key}`)}</span>
              {card.value === null ? (
                <span className="text-sm text-text-muted">{t('dashboard.noData')}</span>
              ) : (
                <span dir="ltr" className="text-xl font-semibold text-text-ink">
                  {card.value}
                </span>
              )}
            </Surface>
          ))}
        </div>
      </section>

      {/* §4.7.4 — turnover for the range. */}
      <section aria-labelledby="dash-sales" className="flex flex-col gap-2">
        <h2 id="dash-sales" className="heading-section">
          {t('dashboard.sales.title')}
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Surface variant="well" bordered className="flex flex-col gap-1 p-4">
            <span className="text-xs text-text-muted">{t('dashboard.sales.orders')}</span>
            <span dir="ltr" className="text-xl font-semibold text-text-ink">
              {data.sales.orderCount}
            </span>
          </Surface>
          <Surface variant="well" bordered className="flex flex-col gap-1 p-4">
            <span className="text-xs text-text-muted">{t('dashboard.sales.turnover')}</span>
            <span dir="ltr" className="text-xl font-semibold text-text-ink">
              {money(data.sales.turnover)}
            </span>
          </Surface>
        </div>

        {data.salesByDay.length > 0 && (
          <div className="relative min-w-0 max-w-full overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-sm">
              <caption className="sr-only">{t('dashboard.sales.byDayCaption')}</caption>
              <thead>
                <tr className="border-b border-border-card text-start text-xs text-text-muted">
                  <th scope="col" className="py-2 text-start">{t('dashboard.sales.day')}</th>
                  <th scope="col" className="py-2 text-start">{t('dashboard.sales.orders')}</th>
                  <th scope="col" className="py-2 text-start">{t('dashboard.sales.turnover')}</th>
                  <th scope="col" className="w-1/2 py-2">
                    <span className="sr-only">{t('dashboard.sales.barLabel')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.salesByDay.map((day) => (
                  <tr key={day.date} className="border-b border-border-card last:border-0">
                    <td dir="ltr" className="py-2 text-start">{day.date}</td>
                    <td dir="ltr" className="py-2 text-start">{day.orderCount}</td>
                    <td dir="ltr" className="py-2 text-start">{money(day.turnover)}</td>
                    <td className="py-2">
                      <div
                        aria-hidden="true"
                        className="h-3 rounded-round bg-brand-teal"
                        style={{
                          width: `${Math.max(2, (turnoverMinor(day.turnover) / dailyMax) * 100)}%`,
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* §4.7.5 — the conversion funnel, counts + proportional bars. */}
      <section aria-labelledby="dash-funnel" className="flex flex-col gap-2">
        <h2 id="dash-funnel" className="heading-section">
          {t('dashboard.funnel.title')}
        </h2>
        <ol className="flex flex-col gap-2">
          {funnelStages.map((stage, index) => {
            const previous = index === 0 ? null : funnelStages[index - 1]
            const stepRate =
              previous && previous.count > 0
                ? percentText(Math.min(1, stage.count / previous.count))
                : null
            return (
              <li key={stage.key} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="text-text-ink">{t(`dashboard.funnel.${stage.key}`)}</span>
                  <span className="text-text-muted">
                    <span dir="ltr">{stage.count}</span>
                    {stepRate !== null && (
                      <>
                        {' · '}
                        <span dir="ltr">{stepRate}</span> {t('dashboard.funnel.ofPrevious')}
                      </>
                    )}
                  </span>
                </div>
                <div
                  aria-hidden="true"
                  className="h-4 rounded-round bg-brand-teal/80"
                  style={{ width: `${Math.max(2, (stage.count / funnelMax) * 100)}%` }}
                />
              </li>
            )
          })}
        </ol>
      </section>

      {/* §4.7.4 — top products by units sold, frozen-price turnover. */}
      <section aria-labelledby="dash-top" className="flex flex-col gap-2">
        <h2 id="dash-top" className="heading-section">
          {t('dashboard.top.title')}
        </h2>
        {data.topProducts.length === 0 ? (
          <p className="text-sm text-text-muted">{t('dashboard.top.empty')}</p>
        ) : (
          <div className="relative min-w-0 max-w-full overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-sm">
              <caption className="sr-only">{t('dashboard.top.caption')}</caption>
              <thead>
                <tr className="border-b border-border-card text-xs text-text-muted">
                  <th scope="col" className="py-2 text-start">{t('dashboard.top.product')}</th>
                  <th scope="col" className="py-2 text-start">{t('dashboard.top.units')}</th>
                  <th scope="col" className="py-2 text-start">{t('dashboard.top.turnover')}</th>
                </tr>
              </thead>
              <tbody>
                {data.topProducts.map((product) => (
                  <tr key={product.productId} className="border-b border-border-card last:border-0">
                    <td className="py-2 text-start">
                      <TextLink to={`/product/${product.slug}`} inline>
                        {productName(product)}
                      </TextLink>
                    </td>
                    <td dir="ltr" className="py-2 text-start">{product.quantity}</td>
                    <td dir="ltr" className="py-2 text-start">{money(product.turnover)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* DEC-102 / §4.7.2 — the low-stock alert panel. The LIST is capped
          server-side; the headline count is the uncapped total. */}
      <section aria-labelledby="dash-low-stock" className="flex flex-col gap-2">
        <h2 id="dash-low-stock" className="heading-section">
          {t('dashboard.lowStock.title')}
        </h2>
        {data.lowStockTotal === 0 ? (
          <p className="text-sm text-text-muted">{t('dashboard.lowStock.empty')}</p>
        ) : (
          <Surface variant="well" className="flex flex-col gap-2 border border-state-warning p-4">
            <p className="text-sm text-text-ink">
              {t('dashboard.lowStock.count', { count: data.lowStockTotal })}
            </p>
            {data.lowStock.length < data.lowStockTotal && (
              <p className="text-xs text-text-muted">
                {t('dashboard.lowStock.truncated', { count: data.lowStock.length })}
              </p>
            )}
            <div className="relative min-w-0 max-w-full overflow-x-auto">
              <table className="w-full min-w-[420px] border-collapse text-sm">
                <caption className="sr-only">{t('dashboard.lowStock.caption')}</caption>
                <thead>
                  <tr className="border-b border-border-card text-xs text-text-muted">
                    <th scope="col" className="py-2 text-start">{t('dashboard.lowStock.product')}</th>
                    <th scope="col" className="py-2 text-start">{t('dashboard.lowStock.stock')}</th>
                    <th scope="col" className="py-2 text-start">{t('dashboard.lowStock.threshold')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lowStock.map((row) => (
                    <tr key={row.id} className="border-b border-border-card last:border-0">
                      <td className="py-2 text-start">{productName(row)}</td>
                      <td dir="ltr" className="py-2 text-start">{row.stockQuantity}</td>
                      <td dir="ltr" className="py-2 text-start">{row.lowStockThreshold}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Surface>
        )}
      </section>
    </>
  )
}
