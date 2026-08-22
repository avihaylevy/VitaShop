import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import argon2 from 'argon2'
import express from 'express'
import type { Server } from 'node:http'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { catalogRouter } from './catalog.js'
import { cartRouter } from './cart.js'
import { createCheckoutRouter } from './checkout.js'
import { createAuthRouter } from './auth.js'
import { createAuthRateLimiters } from '../lib/rateLimit.js'
import { ARGON2_OPTIONS } from '../lib/registrationService.js'
import { prewarmDummyHash } from '../lib/loginService.js'
import { createSessionMiddleware } from '../lib/session.js'
import { NullEmailProvider } from '../lib/emailService.js'
import { TEST_FIXTURE_SLUG_PREFIX } from '../lib/testFixturePrefix.js'

/**
 * DEC-101 — §4.7.5's four funnel events, proven OVER THE WIRE at the exact
 * seams that record them: the detail read, the cart add, /validate (with
 * its dedupe) and /pay (with its replay guard). Every assertion is a ROW
 * COUNT DELTA scoped to this suite's own fixtures, so a parallel suite's
 * events cannot leak in — and every recording test carries a control
 * request that must record NOTHING.
 */

let prisma: PrismaClient
let server: Server
let baseUrl: string

const SLUG = `${TEST_FIXTURE_SLUG_PREFIX}funnel-product`
const SHOPPER = 'zz-funnel-shopper@example.test'
const PASSWORD = 'Abcdef12xyz'

let productId = ''
let shopperId = ''

async function signIn(): Promise<string> {
  const r = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: SHOPPER, password: PASSWORD }),
  })
  expect(r.status).toBe(200)
  const set = r.headers.get('set-cookie')
  if (!set) throw new Error('no session cookie')
  return set.split(';')[0] ?? ''
}

function api(path: string, init: { method?: string; cookie?: string; body?: unknown } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(init.cookie ? { cookie: init.cookie } : {}),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  })
}

/** Rows attributable to THIS suite's fixtures only. */
function ownEventsWhere(eventType: string) {
  return {
    eventType: eventType as never,
    OR: [{ productId }, { userId: shopperId }, { order: { userId: shopperId } }],
  }
}

async function countOwn(eventType: string): Promise<number> {
  return prisma.funnelEvent.count({ where: ownEventsWhere(eventType) })
}

async function cleanupOwnRows(): Promise<void> {
  await prisma.funnelEvent.deleteMany({
    where: { OR: [{ productId }, { userId: shopperId }, { order: { userId: shopperId } }] },
  })
  const orders = await prisma.order.findMany({
    where: { userId: shopperId },
    select: { id: true },
  })
  if (orders.length > 0) {
    const ids = orders.map((o) => o.id)
    await prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } })
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: ids } } })
    await prisma.order.deleteMany({ where: { id: { in: ids } } })
  }
  const carts = await prisma.cart.findMany({ where: { userId: shopperId }, select: { id: true } })
  if (carts.length > 0) {
    const ids = carts.map((c) => c.id)
    await prisma.cartItem.deleteMany({ where: { cartId: { in: ids } } })
    await prisma.cart.deleteMany({ where: { id: { in: ids } } })
  }
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
  const product = await prisma.product.upsert({
    where: { slug: SLUG },
    create: {
      slug: SLUG,
      nameHe: 'מוצר בדיקת משפך',
      nameEn: 'Funnel test product',
      categoryId: seeded.categoryId,
      brandId: seeded.brandId,
      dosageForm: 'CAPSULE',
      packageQuantity: 60,
      usageInstructions: 'בדיקה',
      price: '40.00',
      stockQuantity: 50,
      descriptionHe: 'בדיקה',
      descriptionEn: 'test',
      warningsAllergens: '',
      isActive: true,
    },
    update: { stockQuantity: 50, isActive: true },
    select: { id: true },
  })
  productId = product.id

  const hash = await argon2.hash(PASSWORD, ARGON2_OPTIONS)
  const shopper = await prisma.user.upsert({
    where: { email: SHOPPER },
    create: {
      email: SHOPPER,
      firstName: 'Funnel',
      lastName: 'Shopper',
      passwordHash: hash,
      termsAcceptedAt: new Date(),
      status: 'active',
      role: 'customer',
    },
    update: { status: 'active', role: 'customer', passwordHash: hash },
    select: { id: true },
  })
  shopperId = shopper.id
  await cleanupOwnRows()
}, 60_000)

beforeEach(async () => {
  const app = express()
  app.use(express.json())
  app.use(createSessionMiddleware())
  app.use('/api', catalogRouter)
  app.use('/api/cart', cartRouter)
  app.use('/api/checkout', createCheckoutRouter({ prisma, emailService: new NullEmailProvider() }))
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
    await prisma.product.deleteMany({ where: { slug: SLUG } })
    await prisma.user.deleteMany({ where: { email: SHOPPER } })
  } finally {
    await prisma.$disconnect()
  }
})

/**
 * The `void`-ed recording races the response by design, so a count can be
 * read before the insert lands. Bounded wait, never a sleep-and-hope.
 */
async function waitForOwnCount(eventType: string, expected: number): Promise<number> {
  const deadline = Date.now() + 5_000
  let count = await countOwn(eventType)
  while (count < expected && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50))
    count = await countOwn(eventType)
  }
  return count
}

describe('product_view — GET /api/products/:slug', () => {
  it('records one event carrying the product id; a 404 slug records none', async () => {
    const before = await countOwn('product_view')

    const ok = await api(`/api/products/${SLUG}`)
    expect(ok.status).toBe(200)
    expect(await waitForOwnCount('product_view', before + 1)).toBe(before + 1)

    const event = await prisma.funnelEvent.findFirst({
      where: ownEventsWhere('product_view'),
      orderBy: { createdAt: 'desc' },
    })
    expect(event?.productId).toBe(productId)
    expect(event?.sessionId).not.toBe('')

    // CONTROL — the failure path must record nothing.
    const missing = await api(`/api/products/${SLUG}-no-such`)
    expect(missing.status).toBe(404)
    await new Promise((r) => setTimeout(r, 200))
    expect(await countOwn('product_view')).toBe(before + 1)
  })
})

describe('add_to_cart — POST /api/cart/items', () => {
  it('records one event with the product id; a refused add records none', async () => {
    const before = await countOwn('add_to_cart')
    const cookie = await signIn()

    const ok = await api('/api/cart/items', {
      method: 'POST',
      cookie,
      body: { slug: SLUG, quantity: 1 },
    })
    expect(ok.status).toBe(200)
    expect(await waitForOwnCount('add_to_cart', before + 1)).toBe(before + 1)
    const event = await prisma.funnelEvent.findFirst({
      where: ownEventsWhere('add_to_cart'),
      orderBy: { createdAt: 'desc' },
    })
    expect(event?.productId).toBe(productId)
    expect(event?.userId).toBe(shopperId)

    // CONTROL — an unknown slug is refused and records nothing.
    const missing = await api('/api/cart/items', {
      method: 'POST',
      cookie,
      body: { slug: `${SLUG}-no-such`, quantity: 1 },
    })
    expect(missing.status).toBe(404)
    await new Promise((r) => setTimeout(r, 200))
    expect(await countOwn('add_to_cart')).toBe(before + 1)
  })

  it('🔴 a no-op add at the cap records NOTHING — five taps are not five conversions', async () => {
    const before = await countOwn('add_to_cart')
    const cookie = await signIn()

    // Fill the line to the whole stock (50) — recorded, one event.
    const fill = await api('/api/cart/items', {
      method: 'POST',
      cookie,
      body: { slug: SLUG, quantity: 50 },
    })
    expect(fill.status).toBe(200)
    expect(await waitForOwnCount('add_to_cart', before + 1)).toBe(before + 1)

    // The tap that changes nothing: alreadyAtMaximum, no event.
    const capped = await api('/api/cart/items', {
      method: 'POST',
      cookie,
      body: { slug: SLUG, quantity: 1 },
    })
    expect(capped.status).toBe(200)
    const body = (await capped.json()) as { alreadyAtMaximum: boolean }
    expect(body.alreadyAtMaximum).toBe(true)
    await new Promise((r) => setTimeout(r, 300))
    expect(await countOwn('add_to_cart')).toBe(before + 1)
  })
})

describe('checkout_started — POST /api/checkout/validate', () => {
  it('🔴 two validates in one session record ONE start; a 400 records none', async () => {
    const before = await countOwn('checkout_started')
    const cookie = await signIn()
    await api('/api/cart/items', { method: 'POST', cookie, body: { slug: SLUG, quantity: 1 } })

    // CONTROL first — a malformed method never started a checkout.
    const bad = await api('/api/checkout/validate', {
      method: 'POST',
      cookie,
      body: { deliveryMethod: 'WRONG' },
    })
    expect(bad.status).toBe(400)
    await new Promise((r) => setTimeout(r, 200))
    expect(await countOwn('checkout_started')).toBe(before)

    const first = await api('/api/checkout/validate', {
      method: 'POST',
      cookie,
      body: { deliveryMethod: 'self_pickup' },
    })
    expect(first.status).toBe(200)
    expect(await waitForOwnCount('checkout_started', before + 1)).toBe(before + 1)

    // The dedupe — a re-quote is the same checkout, not a second one.
    const second = await api('/api/checkout/validate', {
      method: 'POST',
      cookie,
      body: { deliveryMethod: 'courier' },
    })
    expect(second.status).toBe(200)
    await new Promise((r) => setTimeout(r, 300))
    expect(await countOwn('checkout_started')).toBe(before + 1)
  })
})

describe('purchase_completed — POST /api/checkout/pay', () => {
  it('🔴 records ONE event per order, and a replayed /pay adds none', async () => {
    const before = await countOwn('purchase_completed')
    const cookie = await signIn()
    await api('/api/cart/items', { method: 'POST', cookie, body: { slug: SLUG, quantity: 1 } })

    const validated = await api('/api/checkout/validate', {
      method: 'POST',
      cookie,
      body: { deliveryMethod: 'self_pickup' },
    })
    expect(validated.status).toBe(200)
    const quote = (await validated.json()) as { fingerprint: string }

    const idempotencyKey = randomUUID()
    const paid = await api('/api/checkout/pay', {
      method: 'POST',
      cookie,
      body: { deliveryMethod: 'self_pickup', fingerprint: quote.fingerprint, idempotencyKey },
    })
    expect(paid.status).toBe(201)
    const order = (await paid.json()) as { orderId: string }

    expect(await waitForOwnCount('purchase_completed', before + 1)).toBe(before + 1)
    const event = await prisma.funnelEvent.findFirst({
      where: ownEventsWhere('purchase_completed'),
      orderBy: { createdAt: 'desc' },
    })
    expect(event?.orderId).toBe(order.orderId)
    expect(event?.userId).toBe(shopperId)

    // CONTROL — the retry answers 200 replayed and must not double-count
    // the conversion (the respondWithOrder 200-vs-201 reasoning).
    const retry = await api('/api/checkout/pay', {
      method: 'POST',
      cookie,
      body: { deliveryMethod: 'self_pickup', fingerprint: quote.fingerprint, idempotencyKey },
    })
    expect(retry.status).toBe(200)
    await new Promise((r) => setTimeout(r, 300))
    expect(await countOwn('purchase_completed')).toBe(before + 1)
  })

  it('🔴 two CONCURRENT /pay calls with one key record ONE conversion', async () => {
    // The sequential retry above is answered at step 0 and never reaches the
    // recording, so it cannot pin the `!order.replayed` guard — this race
    // can: both calls pass step 0 before either commits, the loser is
    // answered by createOrder's replay lookup, and only the winner may
    // count. Removing the guard was RUN and stayed green against the
    // sequential test; this one is the assertion that bites.
    const before = await countOwn('purchase_completed')
    const cookie = await signIn()
    await api('/api/cart/items', { method: 'POST', cookie, body: { slug: SLUG, quantity: 1 } })

    const validated = await api('/api/checkout/validate', {
      method: 'POST',
      cookie,
      body: { deliveryMethod: 'self_pickup' },
    })
    const quote = (await validated.json()) as { fingerprint: string }
    const idempotencyKey = randomUUID()
    const payBody = {
      deliveryMethod: 'self_pickup',
      fingerprint: quote.fingerprint,
      idempotencyKey,
    }

    const [first, second] = await Promise.all([
      api('/api/checkout/pay', { method: 'POST', cookie, body: payBody }),
      api('/api/checkout/pay', { method: 'POST', cookie, body: payBody }),
    ])
    // One creation; the loser is a replay (200) or a halt (409, when the
    // loser's re-quote saw the emptied cart before step 0 found the order).
    const statuses = [first.status, second.status].sort()
    expect(statuses).toContain(201)

    expect(await waitForOwnCount('purchase_completed', before + 1)).toBe(before + 1)
    // Settle, then assert the count did not keep climbing.
    await new Promise((r) => setTimeout(r, 400))
    expect(await countOwn('purchase_completed')).toBe(before + 1)
  })
})
