import { Prisma, type PrismaClient } from '@prisma/client'

/**
 * DEC-101 — §4.7.4's admin dashboard/reports and §1.6's four KPIs, computed
 * SERVER-SIDE only (§3.4: the client renders figures, it never derives them).
 *
 * Money figures travel as two-decimal STRINGS (the DTO convention every
 * admin surface already uses); rates travel as fractions in [0,1] or null
 * when their denominator is zero — a 0% that means "no data" is a lie the
 * client cannot detect, so absence is explicit.
 *
 * The KPI formulas are DEC-101's recorded package, as amended by the
 * hundred-eleventh-pass review:
 *   KPI-01 conversion  = purchase_completed events / distinct funnel sessions
 *   KPI-02 AOV         = turnover (incl. shipping, non-cancelled) / orders
 *   KPI-03 abandonment = 1 − sessions-with-purchase / sessions-with-start
 *                        (BOTH legs per distinct session — the event counts
 *                        are asymmetric by design: starts are deduped,
 *                        purchases are one per order, so an event-count
 *                        ratio pinned itself to 0% whenever one session
 *                        bought twice)
 *   KPI-04 repeat rate = users with ≥2 orders / users with ≥1 order, all-time
 *
 * 🔴 EVERY DAY BOUNDARY IS UTC, EXPLICITLY. `created_at` is timestamptz, so
 * a bare date_trunc runs in the DB SESSION timezone — nothing pins that
 * setting, and a non-UTC default shifted every salesByDay label one day
 * against the toISOString read-back. The range window and the day labels
 * now both derive from UTC calendar days, so they cannot disagree.
 */

export const DASHBOARD_RANGES = [7, 30, 90] as const
export type DashboardRangeDays = (typeof DASHBOARD_RANGES)[number]

/** How many low-stock rows travel; `lowStockTotal` carries the real count. */
export const LOW_STOCK_PAGE_CAP = 50

/**
 * Strict: exactly '7' | '30' | '90' (absent defaults to 30). parseInt was
 * the first draft and it COERCED before validating — '7abc' passed, and a
 * repeated ?days= query (an array) stringified to "90,7" and parsed as 90,
 * answering 200 for a shape the route promises a named RANGE_INVALID 400.
 */
export function parseDashboardRange(raw: unknown): DashboardRangeDays | null {
  if (raw === undefined) return 30
  const match = DASHBOARD_RANGES.find((days) => String(days) === raw)
  return match ?? null
}

/**
 * The revenue-recognition predicate, defined ONCE in each query language —
 * the aggregate, the daily buckets and the top products must never disagree
 * about which orders count (a `refunded` status added to one and not the
 * others would show three different turnovers on one screen).
 */
const COUNTS_AS_REVENUE = { status: { not: 'cancelled' as const } }
const COUNTS_AS_REVENUE_SQL = Prisma.sql`o.status <> 'cancelled'`

export type DashboardData = {
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
  /** The uncapped count — the panel's headline number stays honest when
   *  more than LOW_STOCK_PAGE_CAP rows qualify. */
  lowStockTotal: number
}

/** Clamp a float ratio into [0,1] — rounding noise must not print 100.1%. */
function asRate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null
  return Math.min(1, Math.max(0, numerator / denominator))
}

export type FunnelCounts = {
  productView: number
  addToCart: number
  checkoutStarted: number
  purchaseCompleted: number
}

/**
 * DEC-101's KPI package, pure so the formulas are unit-pinnable with exact
 * numbers. A zero denominator answers null, never 0 — "no data" and "0%"
 * are different findings on a dashboard.
 *
 * ⚠️ KPI-01's denominator (distinct sessions with any event) is a recorded
 * approximation: anonymous sessions are never persisted, so guest views
 * fragment into one-request sessions, and login regenerates the id
 * (DEC-053) so one visitor's journey splits in two. ISSUE-189 carries the
 * durable-visitor-id hardening; until then conversion reads LOW, never
 * high — the safe direction for a business figure.
 */
export function computeKpis(input: {
  funnel: FunnelCounts
  distinctSessions: number
  /** Distinct sessions that produced a checkout_started in the range. */
  startSessions: number
  /** Distinct sessions that produced a purchase_completed in the range. */
  purchaseSessions: number
  usersWithOrders: number
  usersWithRepeat: number
  averageOrderValue: string | null
}): DashboardData['kpis'] {
  return {
    conversionRate: asRate(input.funnel.purchaseCompleted, input.distinctSessions),
    averageOrderValue: input.averageOrderValue,
    // Both legs per SESSION, through the one shared clamp: a session that
    // started and bought abandoned nothing, however many orders it placed.
    abandonmentRate: asRate(
      input.startSessions - input.purchaseSessions,
      input.startSessions,
    ),
    repeatPurchaseRate: asRate(input.usersWithRepeat, input.usersWithOrders),
  }
}

/** UTC midnight, `rangeDays - 1` days back — the window is exactly
 *  `rangeDays` UTC calendar days INCLUDING today, so the day buckets can
 *  never number rangeDays+1 with a misleading partial first bar. */
export function rangeStartUtc(rangeDays: DashboardRangeDays, now = new Date()): Date {
  const start = new Date(now)
  start.setUTCHours(0, 0, 0, 0)
  start.setUTCDate(start.getUTCDate() - (rangeDays - 1))
  return start
}

export async function buildDashboard(
  prisma: PrismaClient,
  rangeDays: DashboardRangeDays,
): Promise<DashboardData> {
  const since = rangeStartUtc(rangeDays)

  const [
    salesAggregate,
    salesByDayRaw,
    topProductsRaw,
    funnelCounts,
    sessionCountsRaw,
    repeatRaw,
    lowStock,
    lowStockTotal,
  ] = await Promise.all([
    // §4.7.4 "sales turnover" — cancelled orders excluded (DEC-101; a
    // cancelled order restocked its items, counting it reports money
    // that was returned).
    prisma.order.aggregate({
      where: { createdAt: { gte: since }, ...COUNTS_AS_REVENUE },
      _count: { _all: true },
      _sum: { totalAmount: true },
    }),
    // §4.7.4 "when" — one row per UTC calendar day, the day emitted as
    // TEXT so no Date object ever re-interprets it in another timezone.
    prisma.$queryRaw<{ day: string; orders: number; turnover: Prisma.Decimal | null }[]>(
      Prisma.sql`
        SELECT to_char(o.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
               COUNT(*)::int AS orders,
               SUM(o.total_amount) AS turnover
        FROM orders o
        WHERE o.created_at >= ${since} AND ${COUNTS_AS_REVENUE_SQL}
        GROUP BY 1
        ORDER BY 1
      `,
    ),
    // §4.7.4 "top products" — by units sold; turnover from the FROZEN
    // per-line price (INV-02). The product's own names join HERE, in the
    // same statement — a second findMany round trip (and its unreachable
    // '—' fallback) was the first draft, removed by review.
    prisma.$queryRaw<
      {
        product_id: string
        slug: string
        name_he: string
        name_en: string
        quantity: number
        turnover: Prisma.Decimal | null
      }[]
    >(
      Prisma.sql`
        SELECT oi.product_id,
               p.slug,
               p.name_he,
               p.name_en,
               SUM(oi.quantity)::int AS quantity,
               SUM(oi.quantity * oi.unit_price_at_purchase) AS turnover
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN products p ON p.id = oi.product_id
        WHERE o.created_at >= ${since} AND ${COUNTS_AS_REVENUE_SQL}
        GROUP BY oi.product_id, p.slug, p.name_he, p.name_en
        ORDER BY quantity DESC, turnover DESC
        LIMIT 10
      `,
    ),
    prisma.funnelEvent.groupBy({
      by: ['eventType'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
    // KPI-01's denominator + KPI-03's two per-session legs, one statement:
    // per-event distinct sessions, with the all-events total as the
    // NULL-event_type grouping-sets row.
    prisma.$queryRaw<{ event_type: string | null; sessions: number }[]>(
      Prisma.sql`
        SELECT event_type::text AS event_type,
               COUNT(DISTINCT session_id)::int AS sessions
        FROM funnel_events
        WHERE created_at >= ${since}
        GROUP BY GROUPING SETS ((event_type), ())
      `,
    ),
    // KPI-04 — all-time by DEC-101. Two integers computed IN the database;
    // the first draft materialized one row per ordering user through
    // Prisma to run .length twice (review finding).
    prisma.$queryRaw<{ with_orders: number; with_repeat: number }[]>(
      Prisma.sql`
        SELECT COUNT(*)::int AS with_orders,
               COUNT(*) FILTER (WHERE n >= 2)::int AS with_repeat
        FROM (
          SELECT o.user_id, COUNT(*) AS n
          FROM orders o
          WHERE ${COUNTS_AS_REVENUE_SQL}
          GROUP BY o.user_id
        ) per_user
      `,
    ),
    // DEC-102 — §4.7.2's alert list: active products at or under their OWN
    // threshold. A column-to-column compare, which Prisma expresses with a
    // field reference — no raw SQL and no second copy of the rule.
    // Capped: a bulk stock-out must not ship the whole catalogue
    // (lowStockTotal below keeps the headline count honest).
    prisma.product.findMany({
      where: {
        isActive: true,
        stockQuantity: { lte: prisma.product.fields.lowStockThreshold },
      },
      select: {
        id: true,
        slug: true,
        nameHe: true,
        nameEn: true,
        stockQuantity: true,
        lowStockThreshold: true,
      },
      orderBy: [{ stockQuantity: 'asc' }, { slug: 'asc' }],
      take: LOW_STOCK_PAGE_CAP,
    }),
    prisma.product.count({
      where: {
        isActive: true,
        stockQuantity: { lte: prisma.product.fields.lowStockThreshold },
      },
    }),
  ])

  const countOf = (eventType: string): number =>
    funnelCounts.find((row) => row.eventType === eventType)?._count._all ?? 0
  const sessionsOf = (eventType: string | null): number =>
    sessionCountsRaw.find((row) => row.event_type === eventType)?.sessions ?? 0

  const funnel = {
    productView: countOf('product_view'),
    addToCart: countOf('add_to_cart'),
    checkoutStarted: countOf('checkout_started'),
    purchaseCompleted: countOf('purchase_completed'),
  }

  const orderCount = salesAggregate._count._all
  const turnover = salesAggregate._sum.totalAmount ?? new Prisma.Decimal(0)
  const averageOrderValue = orderCount > 0 ? turnover.div(orderCount).toFixed(2) : null
  const repeat = repeatRaw[0] ?? { with_orders: 0, with_repeat: 0 }

  return {
    rangeDays,
    sales: { orderCount, turnover: turnover.toFixed(2) },
    salesByDay: salesByDayRaw.map((row) => ({
      date: row.day,
      orderCount: row.orders,
      turnover: (row.turnover ?? new Prisma.Decimal(0)).toFixed(2),
    })),
    topProducts: topProductsRaw.map((row) => ({
      productId: row.product_id,
      slug: row.slug,
      nameHe: row.name_he,
      nameEn: row.name_en,
      quantity: row.quantity,
      turnover: (row.turnover ?? new Prisma.Decimal(0)).toFixed(2),
    })),
    funnel,
    kpis: computeKpis({
      funnel,
      distinctSessions: sessionsOf(null),
      startSessions: sessionsOf('checkout_started'),
      purchaseSessions: sessionsOf('purchase_completed'),
      usersWithOrders: repeat.with_orders,
      usersWithRepeat: repeat.with_repeat,
      averageOrderValue,
    }),
    lowStock,
    lowStockTotal,
  }
}
