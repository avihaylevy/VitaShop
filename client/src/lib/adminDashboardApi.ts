import { getApiBaseUrl } from './apiBaseUrl.js'
import type {
  AdminDashboardData,
  AdminDashboardResult,
  DashboardRangeDays,
} from '../types/adminDashboard.js'

/**
 * DEC-101 — the dashboard transport. VALIDATED, NOT CAST (the adminOrdersApi
 * precedent): these figures go straight onto an admin's screen, and a
 * malformed row must fail as `unavailable`, never render as NaN.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMoney(value: unknown): value is string {
  return typeof value === 'string' && /^-?\d+\.\d{2}$/.test(value)
}

function isRateOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && value >= 0 && value <= 1)
}

function isDayRow(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    typeof value.date === 'string' &&
    typeof value.orderCount === 'number' &&
    isMoney(value.turnover)
  )
}

function isTopProduct(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    typeof value.productId === 'string' &&
    typeof value.slug === 'string' &&
    typeof value.nameHe === 'string' &&
    typeof value.nameEn === 'string' &&
    typeof value.quantity === 'number' &&
    isMoney(value.turnover)
  )
}

function isLowStockRow(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    typeof value.id === 'string' &&
    typeof value.slug === 'string' &&
    typeof value.nameHe === 'string' &&
    typeof value.nameEn === 'string' &&
    typeof value.stockQuantity === 'number' &&
    typeof value.lowStockThreshold === 'number'
  )
}

function isDashboard(value: unknown): value is AdminDashboardData {
  if (!isPlainObject(value)) return false
  const { sales, salesByDay, topProducts, funnel, kpis, lowStock } = value
  return (
    (value.rangeDays === 7 || value.rangeDays === 30 || value.rangeDays === 90) &&
    isPlainObject(sales) &&
    typeof sales.orderCount === 'number' &&
    isMoney(sales.turnover) &&
    Array.isArray(salesByDay) &&
    salesByDay.every(isDayRow) &&
    Array.isArray(topProducts) &&
    topProducts.every(isTopProduct) &&
    isPlainObject(funnel) &&
    typeof funnel.productView === 'number' &&
    typeof funnel.addToCart === 'number' &&
    typeof funnel.checkoutStarted === 'number' &&
    typeof funnel.purchaseCompleted === 'number' &&
    isPlainObject(kpis) &&
    isRateOrNull(kpis.conversionRate) &&
    (kpis.averageOrderValue === null || isMoney(kpis.averageOrderValue)) &&
    isRateOrNull(kpis.abandonmentRate) &&
    isRateOrNull(kpis.repeatPurchaseRate) &&
    Array.isArray(lowStock) &&
    lowStock.every(isLowStockRow) &&
    typeof value.lowStockTotal === 'number'
  )
}

export async function requestAdminDashboard(
  days: DashboardRangeDays,
): Promise<AdminDashboardResult> {
  const base = getApiBaseUrl()
  if (!base.ok) return { ok: false, failure: { kind: 'offline' } }

  let response: Response
  try {
    response = await fetch(`${base.value}/api/admin/dashboard?days=${days}`, {
      credentials: 'include',
    })
  } catch {
    return { ok: false, failure: { kind: 'offline' } }
  }

  if (response.status === 401) return { ok: false, failure: { kind: 'unauthenticated' } }
  if (response.status === 403) return { ok: false, failure: { kind: 'notAdmin' } }
  if (response.status === 429) return { ok: false, failure: { kind: 'rateLimited' } }
  if (response.status !== 200) return { ok: false, failure: { kind: 'unavailable' } }

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    return { ok: false, failure: { kind: 'unavailable' } }
  }
  if (!isDashboard(body)) return { ok: false, failure: { kind: 'unavailable' } }
  return { ok: true, data: body }
}
