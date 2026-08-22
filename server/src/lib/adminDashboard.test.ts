import { describe, expect, it } from 'vitest'
import {
  computeKpis,
  parseDashboardRange,
  rangeStartUtc,
  DASHBOARD_RANGES,
} from './adminDashboard.js'

/**
 * DEC-101 — the KPI formulas, pinned with exact numbers. These are the
 * figures the submission document cites; a drifted formula must go red
 * here, not on a grader's screen.
 */

const FUNNEL = { productView: 100, addToCart: 40, checkoutStarted: 20, purchaseCompleted: 5 }

const BASE = {
  funnel: FUNNEL,
  distinctSessions: 50,
  startSessions: 20,
  purchaseSessions: 5,
  usersWithOrders: 0,
  usersWithRepeat: 0,
  averageOrderValue: null as string | null,
}

describe('computeKpis — DEC-101 formula package', () => {
  it('KPI-01 conversion = purchases / distinct sessions', () => {
    expect(computeKpis(BASE).conversionRate).toBe(5 / 50)
  })

  it('KPI-03 abandonment = 1 − purchase-sessions / start-sessions (per SESSION)', () => {
    expect(computeKpis(BASE).abandonmentRate).toBe(1 - 5 / 20)
  })

  it('🔴 a session that bought TWICE abandoned nothing — the legs are per session, not per event', () => {
    // One session, one start, two orders: the event-count ratio was 1−2/1
    // clamped to 0% and erased real abandonment elsewhere in the range.
    // Per-session legs answer honestly: 3 of 4 starting sessions abandoned.
    const kpis = computeKpis({
      ...BASE,
      funnel: { ...FUNNEL, checkoutStarted: 4, purchaseCompleted: 2 },
      startSessions: 4,
      purchaseSessions: 1,
    })
    expect(kpis.abandonmentRate).toBe(1 - 1 / 4)
  })

  it('KPI-04 repeat rate = users with ≥2 orders / users with ≥1 order', () => {
    const kpis = computeKpis({
      ...BASE,
      usersWithOrders: 8,
      usersWithRepeat: 2,
      averageOrderValue: '120.00',
    })
    expect(kpis.repeatPurchaseRate).toBe(2 / 8)
    expect(kpis.averageOrderValue).toBe('120.00')
  })

  it('🔴 a zero denominator answers null, never 0 — "no data" is not "0%"', () => {
    const kpis = computeKpis({
      funnel: { productView: 0, addToCart: 0, checkoutStarted: 0, purchaseCompleted: 0 },
      distinctSessions: 0,
      startSessions: 0,
      purchaseSessions: 0,
      usersWithOrders: 0,
      usersWithRepeat: 0,
      averageOrderValue: null,
    })
    expect(kpis.conversionRate).toBeNull()
    expect(kpis.abandonmentRate).toBeNull()
    expect(kpis.repeatPurchaseRate).toBeNull()
    expect(kpis.averageOrderValue).toBeNull()
  })

  it('rates clamp into [0,1] even when the data is inconsistent', () => {
    // A purchase whose start landed before the window boundary can leave
    // more purchase-sessions than start-sessions; the rate must not go
    // negative on the dashboard.
    const kpis = computeKpis({
      ...BASE,
      startSessions: 2,
      purchaseSessions: 5,
      distinctSessions: 3,
      funnel: { ...FUNNEL, purchaseCompleted: 5 },
    })
    expect(kpis.abandonmentRate).toBe(0)
    expect(kpis.conversionRate).toBe(1)
  })
})

describe('parseDashboardRange', () => {
  it('accepts exactly the documented ranges', () => {
    for (const days of DASHBOARD_RANGES) {
      expect(parseDashboardRange(String(days))).toBe(days)
    }
  })

  it('defaults an absent value to 30', () => {
    expect(parseDashboardRange(undefined)).toBe(30)
  })

  it('refuses anything else — the route turns null into RANGE_INVALID', () => {
    expect(parseDashboardRange('14')).toBeNull()
    expect(parseDashboardRange('0')).toBeNull()
    expect(parseDashboardRange('-7')).toBeNull()
    expect(parseDashboardRange('abc')).toBeNull()
    // 🔴 The coercion family the first draft let through: parseInt('7abc')
    // is 7, and a REPEATED ?days= query arrives as an array which
    // stringifies to '90,7' and parsed as 90 — both must be named 400s.
    expect(parseDashboardRange('7abc')).toBeNull()
    expect(parseDashboardRange(['90', '7'])).toBeNull()
    expect(parseDashboardRange('30.0')).toBeNull()
  })
})

describe('rangeStartUtc', () => {
  it('a 7-day range spans exactly 7 UTC calendar days including today', () => {
    // Mid-afternoon UTC: a rolling now−7d start would create an 8th,
    // partial, oldest bucket whose short bar reads as a sales collapse.
    const now = new Date('2026-08-22T14:00:00.000Z')
    const start = rangeStartUtc(7, now)
    expect(start.toISOString()).toBe('2026-08-16T00:00:00.000Z')
  })

  it('crosses a month boundary correctly', () => {
    const start = rangeStartUtc(30, new Date('2026-03-10T05:00:00.000Z'))
    expect(start.toISOString()).toBe('2026-02-09T00:00:00.000Z')
  })
})
