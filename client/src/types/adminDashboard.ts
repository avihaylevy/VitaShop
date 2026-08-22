import type { AdminListFailure } from './adminOrders'

/**
 * DEC-101 — the admin dashboard DTO, mirroring the server's
 * `lib/adminDashboard.ts` shape. Money is a two-decimal STRING; rates are
 * fractions in [0,1] or null when the denominator was zero ("no data" and
 * "0%" are different findings — the client renders the difference).
 * `salesByDay.date` is a UTC calendar-day string (YYYY-MM-DD), emitted as
 * text by the server so no timezone re-interpretation can shift a bar.
 */

export type DashboardRangeDays = 7 | 30 | 90

export type AdminDashboardData = {
  rangeDays: DashboardRangeDays
  sales: { orderCount: number; turnover: string }
  salesByDay: { date: string; orderCount: number; turnover: string }[]
  topProducts: {
    productId: string
    slug: string
    nameHe: string
    nameEn: string
    quantity: number
    turnover: string
  }[]
  funnel: {
    productView: number
    addToCart: number
    checkoutStarted: number
    purchaseCompleted: number
  }
  kpis: {
    conversionRate: number | null
    averageOrderValue: string | null
    abandonmentRate: number | null
    repeatPurchaseRate: number | null
  }
  lowStock: {
    id: string
    slug: string
    nameHe: string
    nameEn: string
    stockQuantity: number
    lowStockThreshold: number
  }[]
  /** Uncapped count — the list itself is capped server-side (50). */
  lowStockTotal: number
}

/** The shared admin failure vocabulary — the adminProducts alias pattern,
 *  so a new refusal kind reaches every admin surface at once. */
export type AdminDashboardFailure = AdminListFailure

export type AdminDashboardResult =
  | { ok: true; data: AdminDashboardData }
  | { ok: false; failure: AdminDashboardFailure }
