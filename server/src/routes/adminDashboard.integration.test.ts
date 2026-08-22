import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import argon2 from 'argon2'
import express from 'express'
import type { Server } from 'node:http'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createAdminDashboardRouter } from './adminDashboard.js'
import { createAuthRouter } from './auth.js'
import { createAuthRateLimiters } from '../lib/rateLimit.js'
import { ARGON2_OPTIONS } from '../lib/registrationService.js'
import { prewarmDummyHash } from '../lib/loginService.js'
import { createSessionMiddleware } from '../lib/session.js'
import { NullEmailProvider } from '../lib/emailService.js'
import { TEST_FIXTURE_SLUG_PREFIX } from '../lib/testFixturePrefix.js'
import type { DashboardData } from '../lib/adminDashboard.js'

/**
 * DEC-101/DEC-102 — GET /api/admin/dashboard over the wire.
 *
 * 🔴 EVERY AGGREGATE ASSERTION IS A DELTA against a baseline read taken in
 * the same test, because the dashboard aggregates the WHOLE database and
 * this suite shares it with the seeded catalogue and any parallel suite's
 * leavings. A pinned absolute total would be green today and red the day
 * the seed grows — the drifting-count family.
 *
 * Fixtures under TEST_FIXTURE_SLUG_PREFIX / zz- emails only (DEC-063), and
 * every child row (funnel events, order items, history) is swept before
 * its parent.
 */

let prisma: PrismaClient
let server: Server
let baseUrl: string

const LOW_SLUG = `${TEST_FIXTURE_SLUG_PREFIX}dash-low`
const OK_SLUG = `${TEST_FIXTURE_SLUG_PREFIX}dash-ok`
const ADMIN = 'zz-dash-admin@example.test'
const SHOPPER = 'zz-dash-shopper@example.test'
const PASSWORD = 'Abcdef12xyz'
const SESSION_PREFIX = 'zz-dash-session-'

let lowProductId = ''
let okProductId = ''
let shopperId = ''

async function signIn(email: string): Promise<string> {
  const r = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  expect(r.status).toBe(200)
  const set = r.headers.get('set-cookie')
  if (!set) throw new Error('no session cookie')
  return set.split(';')[0] ?? ''
}

async function getDashboard(cookie: string, days?: number): Promise<DashboardData> {
  const r = await fetch(
    `${baseUrl}/api/admin/dashboard${days === undefined ? '' : `?days=${days}`}`,
    { headers: { cookie } },
  )
  expect(r.status).toBe(200)
  return (await r.json()) as DashboardData
}

async function cleanupOwnRows(): Promise<void> {
  await prisma.funnelEvent.deleteMany({ where: { sessionId: { startsWith: SESSION_PREFIX } } })
  const orders = await prisma.order.findMany({
    where: { userId: shopperId },
    select: { id: true },
  })
  if (orders.length > 0) {
    const ids = orders.map((o) => o.id)
    await prisma.funnelEvent.deleteMany({ where: { orderId: { in: ids } } })
    await prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } })
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: ids } } })
    await prisma.order.deleteMany({ where: { id: { in: ids } } })
  }
}

/** One synthetic order with one line, created directly — DEC-063 fixture. */
async function createOrder(options: {
  status: 'paid' | 'cancelled'
  totalAmount: string
  quantity?: number
  createdAt?: Date
}): Promise<void> {
  await prisma.order.create({
    data: {
      orderNumber: `zzdash-${randomUUID().slice(0, 18)}`,
      userId: shopperId,
      status: options.status,
      totalAmount: options.totalAmount,
      idempotencyKey: randomUUID(),
      deliveryMethod: 'self_pickup',
      shippingCost: '0.00',
      ...(options.createdAt ? { createdAt: options.createdAt } : {}),
      items: {
        create: {
          productId: lowProductId,
          quantity: options.quantity ?? 1,
          unitPriceAtPurchase: '0.20',
          productNameHeAtPurchase: 'מוצר לוח בקרה',
          productNameEnAtPurchase: 'Dashboard product',
        },
      },
    },
  })
}

beforeAll(async () => {
  await prewarmDummyHash()
  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  })

  const seeded = await prisma.product.findFirstOrThrow({
    where: { isActive: true },
    select: { categoryId: true, brandId: true },
  })
  const baseProduct = {
    categoryId: seeded.categoryId,
    brandId: seeded.brandId,
    dosageForm: 'CAPSULE' as const,
    packageQuantity: 60,
    usageInstructions: 'בדיקה',
    price: '30.00',
    descriptionHe: 'בדיקה',
    descriptionEn: 'test',
    warningsAllergens: '',
    isActive: true,
  }
  // 🔴 The lte BOUNDARY is the fixture: stock EQUAL to the threshold must
  // alert (§4.7.2's "drops below the threshold" is read inclusively — at
  // the threshold the next sale takes it under, when the admin can still
  // act).
  const low = await prisma.product.upsert({
    where: { slug: LOW_SLUG },
    create: {
      ...baseProduct,
      slug: LOW_SLUG,
      nameHe: 'מוצר לוח בקרה',
      nameEn: 'Dashboard product',
      stockQuantity: 5,
      lowStockThreshold: 5,
    },
    update: { stockQuantity: 5, lowStockThreshold: 5, isActive: true },
    select: { id: true },
  })
  lowProductId = low.id
  // CONTROL — one unit above its threshold must NOT alert.
  const ok = await prisma.product.upsert({
    where: { slug: OK_SLUG },
    create: {
      ...baseProduct,
      slug: OK_SLUG,
      nameHe: 'מוצר תקין',
      nameEn: 'Healthy-stock product',
      stockQuantity: 6,
      lowStockThreshold: 5,
    },
    update: { stockQuantity: 6, lowStockThreshold: 5, isActive: true },
    select: { id: true },
  })
  okProductId = ok.id

  const hash = await argon2.hash(PASSWORD, ARGON2_OPTIONS)
  for (const [email, role] of [
    [ADMIN, 'admin'],
    [SHOPPER, 'customer'],
  ] as const) {
    await prisma.user.upsert({
      where: { email },
      create: {
        email,
        firstName: 'Dash',
        lastName: 'Board',
        passwordHash: hash,
        termsAcceptedAt: new Date(),
        status: 'active',
        role,
      },
      update: { status: 'active', role, passwordHash: hash },
      select: { id: true },
    })
  }
  shopperId = (
    await prisma.user.findUniqueOrThrow({ where: { email: SHOPPER }, select: { id: true } })
  ).id
  await cleanupOwnRows()
}, 60_000)

beforeEach(async () => {
  const app = express()
  app.use(express.json())
  app.use(createSessionMiddleware())
  app.use('/api/admin/dashboard', createAdminDashboardRouter({ prisma }))
  app.use(
    '/api',
    createAuthRouter({
      prisma,
      emailService: new NullEmailProvider(),
      appBaseUrl: 'http://127.0.0.1',
      rateLimiters: createAuthRateLimiters(),
    }),
  )
  await new Promise<void>((r) => {
    server = app.listen(0, () => r())
  })
  const a = server.address()
  if (!a || typeof a === 'string') throw new Error('no ephemeral port')
  baseUrl = `http://127.0.0.1:${a.port}`
})

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()))
  await cleanupOwnRows()
})

afterAll(async () => {
  try {
    await cleanupOwnRows()
    await prisma.product.deleteMany({ where: { slug: { in: [LOW_SLUG, OK_SLUG] } } })
    await prisma.user.deleteMany({ where: { email: { in: [ADMIN, SHOPPER] } } })
  } finally {
    await prisma.$disconnect()
  }
})

describe('🔴 the guard — the adminOrders precedent', () => {
  it('anonymous is 401', async () => {
    expect((await fetch(`${baseUrl}/api/admin/dashboard`)).status).toBe(401)
  })

  it('a signed-in shopper is 403', async () => {
    const cookie = await signIn(SHOPPER)
    expect((await fetch(`${baseUrl}/api/admin/dashboard`, { headers: { cookie } })).status).toBe(403)
  })

  it('an unknown range is a named 400, not a silent default', async () => {
    const cookie = await signIn(ADMIN)
    const r = await fetch(`${baseUrl}/api/admin/dashboard?days=14`, { headers: { cookie } })
    expect(r.status).toBe(400)
    const body = (await r.json()) as { error: { code: string } }
    expect(body.error.code).toBe('RANGE_INVALID')
  })
})

describe('the aggregates — delta-asserted', () => {
  it('🔴 counts a paid order, EXCLUDES a cancelled one, and sums turnover', async () => {
    const cookie = await signIn(ADMIN)
    const before = await getDashboard(cookie, 90)

    await createOrder({ status: 'paid', totalAmount: '100.00', quantity: 500 })
    await createOrder({ status: 'cancelled', totalAmount: '999.00' })

    const after = await getDashboard(cookie, 90)
    expect(after.sales.orderCount).toBe(before.sales.orderCount + 1)
    expect(Number(after.sales.turnover) - Number(before.sales.turnover)).toBeCloseTo(100, 2)

    // Top products — 500 units makes the fixture the range's top row, and
    // its turnover is the FROZEN line price (500 × 0.20), not the live one.
    const top = after.topProducts[0]
    expect(top?.productId).toBe(lowProductId)
    expect(top?.quantity).toBeGreaterThanOrEqual(500)
    expect(Number(top?.turnover)).toBeCloseTo(100, 2)

    // Today's salesByDay row moved by the paid order's amount.
    const today = new Date().toISOString().slice(0, 10)
    const beforeToday = Number(before.salesByDay.find((d) => d.date === today)?.turnover ?? '0')
    const afterToday = Number(after.salesByDay.find((d) => d.date === today)?.turnover ?? '0')
    expect(afterToday - beforeToday).toBeCloseTo(100, 2)
  })

  it('🔴 the range filter: a 10-day-old order is in days=30 and not in days=7', async () => {
    const cookie = await signIn(ADMIN)
    const before7 = await getDashboard(cookie, 7)
    const before30 = await getDashboard(cookie, 30)

    await createOrder({
      status: 'paid',
      totalAmount: '55.00',
      createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    })

    const after7 = await getDashboard(cookie, 7)
    const after30 = await getDashboard(cookie, 30)
    expect(after7.sales.orderCount).toBe(before7.sales.orderCount)
    expect(after30.sales.orderCount).toBe(before30.sales.orderCount + 1)
  })

  it('funnel counts move by exactly the inserted events', async () => {
    const cookie = await signIn(ADMIN)
    const before = await getDashboard(cookie, 30)

    const rows = [
      ...['a', 'b', 'c'].map((s) => ({
        eventType: 'product_view' as const,
        sessionId: `${SESSION_PREFIX}${s}`,
        productId: lowProductId,
      })),
      ...['a', 'b'].map((s) => ({
        eventType: 'add_to_cart' as const,
        sessionId: `${SESSION_PREFIX}${s}`,
        productId: lowProductId,
      })),
      { eventType: 'checkout_started' as const, sessionId: `${SESSION_PREFIX}a` },
      { eventType: 'purchase_completed' as const, sessionId: `${SESSION_PREFIX}a` },
    ]
    for (const row of rows) await prisma.funnelEvent.create({ data: row })

    const after = await getDashboard(cookie, 30)
    expect(after.funnel.productView).toBe(before.funnel.productView + 3)
    expect(after.funnel.addToCart).toBe(before.funnel.addToCart + 2)
    expect(after.funnel.checkoutStarted).toBe(before.funnel.checkoutStarted + 1)
    expect(after.funnel.purchaseCompleted).toBe(before.funnel.purchaseCompleted + 1)

    // The KPI fields exist and are honest fractions or null (formulas are
    // pinned exactly in adminDashboard.test.ts — global data forbids
    // pinning absolute rates here).
    for (const rate of [
      after.kpis.conversionRate,
      after.kpis.abandonmentRate,
      after.kpis.repeatPurchaseRate,
    ]) {
      if (rate !== null) {
        expect(rate).toBeGreaterThanOrEqual(0)
        expect(rate).toBeLessThanOrEqual(1)
      }
    }
  })

  it('🔴 DEC-102 low stock: AT the threshold alerts, one unit above does not', async () => {
    const cookie = await signIn(ADMIN)
    const dashboard = await getDashboard(cookie)
    const ids = dashboard.lowStock.map((row) => row.id)
    expect(ids).toContain(lowProductId)
    expect(ids).not.toContain(okProductId)

    const row = dashboard.lowStock.find((r) => r.id === lowProductId)
    expect(row?.stockQuantity).toBe(5)
    expect(row?.lowStockThreshold).toBe(5)
    // The uncapped total can never be smaller than the capped list.
    expect(dashboard.lowStockTotal).toBeGreaterThanOrEqual(dashboard.lowStock.length)
  })

  it('🔴 an INACTIVE product leaves the alert list — the panel sells nothing', async () => {
    const cookie = await signIn(ADMIN)
    await prisma.product.update({ where: { slug: LOW_SLUG }, data: { isActive: false } })
    try {
      const dashboard = await getDashboard(cookie)
      expect(dashboard.lowStock.map((r) => r.id)).not.toContain(lowProductId)
    } finally {
      await prisma.product.update({ where: { slug: LOW_SLUG }, data: { isActive: true } })
    }
  })
})
