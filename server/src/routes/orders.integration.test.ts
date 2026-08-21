import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import argon2 from 'argon2'
import express from 'express'
import type { Server } from 'node:http'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createOrderRouter } from './orders.js'
import { createAuthRouter } from './auth.js'
import { createAuthRateLimiters } from '../lib/rateLimit.js'
import { ARGON2_OPTIONS } from '../lib/registrationService.js'
import { prewarmDummyHash } from '../lib/loginService.js'
import { createSessionMiddleware } from '../lib/session.js'
import { NullEmailProvider } from '../lib/emailService.js'
import { createOrder } from '../lib/orderService.js'
import { TEST_FIXTURE_SLUG_PREFIX } from '../lib/testFixturePrefix.js'

/**
 * MILESTONE-008 Checkpoint E3 — `POST /api/orders/:id/cancel`, over the wire.
 *
 * 🔴 THE TEST THAT MATTERS IS THE IDOR ONE. An order belonging to another
 * shopper must be indistinguishable from one that does not exist; a 403 would
 * confirm the id is real and turn this route into an enumeration oracle over
 * every order in the store. That is TEST-050b's shape, one milestone early.
 *
 * ⚠️ A FRESH APP PER TEST — the limiter is real and allows ten per fifteen
 * minutes, and this file makes more than ten cancel calls in total.
 */

let prisma: PrismaClient
let server: Server
let baseUrl: string

const SLUG = `${TEST_FIXTURE_SLUG_PREFIX}orders-route`
const EMAIL = 'zz-ordersroute@example.test'
const OTHER_EMAIL = 'zz-ordersroute-other@example.test'
const PASSWORD = 'Abcdef12xyz'
const ADDRESS = { line1: 'רחוב הבדיקה 1', city: 'תל אביב', zipCode: '6100000' }

let userId = ''
let otherUserId = ''

async function wipe(): Promise<void> {
  const orders = await prisma.order.findMany({
    where: { user: { email: { in: [EMAIL, OTHER_EMAIL] } } }, select: { id: true },
  })
  if (orders.length > 0) {
    const ids = orders.map((o) => o.id)
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: ids } } })
    await prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } })
    await prisma.order.deleteMany({ where: { id: { in: ids } } })
  }
  const carts = await prisma.cart.findMany({
    where: { user: { email: { in: [EMAIL, OTHER_EMAIL] } } }, select: { id: true },
  })
  if (carts.length > 0) {
    const ids = carts.map((c) => c.id)
    await prisma.cartItem.deleteMany({ where: { cartId: { in: ids } } })
    await prisma.cart.deleteMany({ where: { id: { in: ids } } })
  }
}

async function stockOf(): Promise<number> {
  const p = await prisma.product.findUniqueOrThrow({ where: { slug: SLUG }, select: { stockQuantity: true } })
  return p.stockQuantity
}

async function placeOrderFor(who: string, key: string, quantity: number): Promise<string> {
  const product = await prisma.product.findUniqueOrThrow({ where: { slug: SLUG }, select: { id: true } })
  const cart = await prisma.cart.upsert({
    where: { userId: who }, create: { userId: who }, update: {}, select: { id: true },
  })
  await prisma.cartItem.upsert({
    where: { cartId_productId: { cartId: cart.id, productId: product.id } },
    create: { cartId: cart.id, productId: product.id, quantity },
    update: { quantity },
    select: { id: true },
  })
  const result = await createOrder(prisma, {
    userId: who, idempotencyKey: key, deliveryMethod: 'courier', address: ADDRESS,
  })
  if (!result.ok) throw new Error(`fixture order failed: ${result.reason}`)
  return result.orderId
}

async function signIn(email: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  expect(response.status).toBe(200)
  const set = response.headers.get('set-cookie')
  if (!set) throw new Error('login returned no session cookie')
  return set.split(';')[0] ?? ''
}

function cancel(orderId: string, cookie?: string) {
  return fetch(`${baseUrl}/api/orders/${orderId}/cancel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
  })
}

beforeAll(async () => {
  await prewarmDummyHash()
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

  const seeded = await prisma.product.findFirstOrThrow({
    where: { isActive: true }, select: { categoryId: true, brandId: true },
  })
  await prisma.product.upsert({
    where: { slug: SLUG },
    create: {
      slug: SLUG, nameHe: 'בדיקת ביטול', nameEn: 'Cancel test',
      categoryId: seeded.categoryId, brandId: seeded.brandId,
      dosageForm: 'CAPSULE', packageQuantity: 60, usageInstructions: 'בדיקה',
      price: '20.00', stockQuantity: 200,
      descriptionHe: 'בדיקה', descriptionEn: 'test', warningsAllergens: '',
      isActive: true,
    },
    update: { stockQuantity: 200, isActive: true },
    select: { id: true },
  })

  for (const email of [EMAIL, OTHER_EMAIL]) {
    await prisma.user.upsert({
      where: { email },
      create: {
        email, firstName: 'Orders', lastName: 'Route',
        passwordHash: await argon2.hash(PASSWORD, ARGON2_OPTIONS),
        termsAcceptedAt: new Date(), status: 'active',
      },
      update: { status: 'active' },
      select: { id: true },
    })
  }
  userId = (await prisma.user.findUniqueOrThrow({ where: { email: EMAIL }, select: { id: true } })).id
  otherUserId = (await prisma.user.findUniqueOrThrow({ where: { email: OTHER_EMAIL }, select: { id: true } })).id
  await wipe()
}, 60_000)

beforeEach(async () => {
  const app = express()
  app.use(express.json())
  app.use(createSessionMiddleware())
  app.use('/api/orders', createOrderRouter({ prisma }))
  app.use('/api', createAuthRouter({
    prisma, emailService: new NullEmailProvider(),
    appBaseUrl: 'http://127.0.0.1', rateLimiters: createAuthRateLimiters(),
  }))
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('no ephemeral port')
  baseUrl = `http://127.0.0.1:${address.port}`
  await prisma.product.update({ where: { slug: SLUG }, data: { stockQuantity: 200 } })
})

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()))
  })
  await wipe()
})

afterAll(async () => {
  try {
    await wipe()
    await prisma.product.deleteMany({ where: { slug: SLUG } })
    await prisma.user.deleteMany({ where: { email: { in: [EMAIL, OTHER_EMAIL] } } })
  } finally {
    await prisma.$disconnect()
  }
})

describe('🔴 THE IDOR SHAPE — another shopper’s order is INDISTINGUISHABLE from none', () => {
  it('cancelling someone else’s order answers 404, never 403', async () => {
    const theirs = await placeOrderFor(otherUserId, 'idor-theirs', 3)
    const cookie = await signIn(EMAIL)

    const response = await cancel(theirs, cookie)

    // 🔴 404, NOT 403. A 403 confirms the id is real — an enumeration oracle
    // over every order in the store.
    expect(response.status).toBe(404)
    expect(((await response.json()) as { error: { code: string } }).error.code)
      .toBe('ORDER_NOT_FOUND')

    // 🔴 AND NOTHING HAPPENED TO IT.
    const untouched = await prisma.order.findUniqueOrThrow({
      where: { id: theirs }, select: { status: true },
    })
    expect(untouched.status).toBe('pending_payment')
    expect(await stockOf()).toBe(197)
  })

  it('⚠️ a NONEXISTENT order answers the SAME 404 — the control on the oracle', async () => {
    // Without this, "another shopper's order 404s" is satisfied by a route that
    // 404s everything, and the two cases must be indistinguishable to the
    // caller. Same status, same code.
    const cookie = await signIn(EMAIL)
    const response = await cancel('00000000-0000-0000-0000-000000000000', cookie)
    expect(response.status).toBe(404)
    expect(((await response.json()) as { error: { code: string } }).error.code)
      .toBe('ORDER_NOT_FOUND')
  })

  it('an anonymous caller is refused before any lookup', async () => {
    const mine = await placeOrderFor(userId, 'idor-anon', 1)
    const response = await cancel(mine)
    expect(response.status).toBe(401)
  })
})

describe('the shopper cancelling their own order', () => {
  it('🔴 cancels, restores the stock, and says so', async () => {
    const mine = await placeOrderFor(userId, 'cancel-mine', 4)
    expect(await stockOf()).toBe(196)
    const cookie = await signIn(EMAIL)

    const response = await cancel(mine, cookie)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      orderId: mine, status: 'cancelled', alreadyCancelled: false, restoredStock: true,
    })
    expect(await stockOf()).toBe(200)
  })

  it('🔴 cancelling TWICE is 200 and restores nothing the second time', async () => {
    const mine = await placeOrderFor(userId, 'cancel-twice', 5)
    const cookie = await signIn(EMAIL)

    expect((await cancel(mine, cookie)).status).toBe(200)
    expect(await stockOf()).toBe(200)

    const second = await cancel(mine, cookie)
    expect(second.status).toBe(200)
    expect(await second.json()).toMatchObject({ alreadyCancelled: true, restoredStock: false })
    // 🔴 200, not 205. A retry does not invent inventory.
    expect(await stockOf()).toBe(200)
  })

  it('🔴 once fulfilment has begun the shopper is told 403, not 409', async () => {
    // The move exists and an admin may still make it — "not yours to do" leaves
    // the shopper somewhere to go, where "impossible" would end it.
    const mine = await placeOrderFor(userId, 'cancel-processing', 2)
    await prisma.order.update({ where: { id: mine }, data: { status: 'processing' } })
    const cookie = await signIn(EMAIL)

    const response = await cancel(mine, cookie)

    expect(response.status).toBe(403)
    expect(((await response.json()) as { error: { code: string } }).error.code)
      .toBe('FORBIDDEN_FOR_ACTOR')
    expect(await stockOf()).toBe(198)
  })

  it("🔴 the user's twelfth list — a PAID order past the 10-day window is refused 409", async () => {
    const mine = await placeOrderFor(userId, 'cancel-window', 2)
    // Paid, and placed eleven days ago — one past the window.
    await prisma.order.update({
      where: { id: mine },
      data: { status: 'paid', createdAt: new Date(Date.now() - 11 * 24 * 60 * 60 * 1000) },
    })
    const cookie = await signIn(EMAIL)

    const response = await cancel(mine, cookie)

    expect(response.status).toBe(409)
    expect(((await response.json()) as { error: { code: string } }).error.code)
      .toBe('CANCEL_WINDOW_PASSED')
    // 🔴 AND NOTHING MOVED — no restore for a refused cancellation.
    const untouched = await prisma.order.findUniqueOrThrow({
      where: { id: mine }, select: { status: true },
    })
    expect(untouched.status).toBe('paid')
    expect(await stockOf()).toBe(198)
  })

  it('⚠️ THE CONTROL — a paid order nine days old still cancels', async () => {
    // Without this, the window test is satisfied by a route that refuses
    // every cancellation. Inside the window, the cancel still works.
    const mine = await placeOrderFor(userId, 'cancel-window-open', 2)
    await prisma.order.update({
      where: { id: mine },
      data: { status: 'paid', createdAt: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000) },
    })
    const cookie = await signIn(EMAIL)

    expect((await cancel(mine, cookie)).status).toBe(200)
    expect(await stockOf()).toBe(200)
  })

  it('🔴 a PENDING_PAYMENT order is cancellable at ANY age — nothing ever shipped', async () => {
    // The window claims "goods presumed received"; an abandoned checkout has
    // no goods. Refusing it would lock its reserved stock forever (review).
    const mine = await placeOrderFor(userId, 'cancel-window-pending', 2)
    await prisma.order.update({
      where: { id: mine },
      data: { createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    })
    const cookie = await signIn(EMAIL)

    expect((await cancel(mine, cookie)).status).toBe(200)
    expect(await stockOf()).toBe(200)
  })

  it("the list's server-computed `cancellable` flag matches the rule", async () => {
    const fresh = await placeOrderFor(userId, 'flag-fresh', 1)
    const stale = await placeOrderFor(userId, 'flag-stale', 1)
    await prisma.order.update({
      where: { id: stale },
      data: { status: 'paid', createdAt: new Date(Date.now() - 11 * 24 * 60 * 60 * 1000) },
    })
    const cookie = await signIn(EMAIL)

    const response = await fetch(`${baseUrl}/api/orders`, { headers: { cookie } })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { orders: { id: string; cancellable: boolean }[] }
    const byId = new Map(body.orders.map((o) => [o.id, o.cancellable]))
    // Fresh pending_payment: offered. Paid past the window: not offered.
    expect(byId.get(fresh)).toBe(true)
    expect(byId.get(stale)).toBe(false)
  })

  it("🔴 the user's twelfth list — a cancelled order LEAVES the history list", async () => {
    const keep = await placeOrderFor(userId, 'history-keep', 1)
    const gone = await placeOrderFor(userId, 'history-gone', 1)
    const cookie = await signIn(EMAIL)
    expect((await cancel(gone, cookie)).status).toBe(200)

    const response = await fetch(`${baseUrl}/api/orders`, { headers: { cookie } })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { orders: { id: string }[] }
    const ids = body.orders.map((o) => o.id)
    // The live order is listed; the cancelled one is NOT — its cancellation
    // was confirmed by the dialog at the moment it happened.
    expect(ids).toContain(keep)
    expect(ids).not.toContain(gone)
    // ⚠️ The row still EXISTS (INV-03) — it is only unlisted.
    const row = await prisma.order.findUniqueOrThrow({
      where: { id: gone }, select: { status: true },
    })
    expect(row.status).toBe('cancelled')
  })

  it('a TERMINAL order answers 409, not 403', async () => {
    // ⚠️ THE CONTROL on the test above: 403 must mean "wrong actor", not "any
    // refusal". A delivered order is nobody's to cancel.
    const mine = await placeOrderFor(userId, 'cancel-delivered', 1)
    await prisma.order.update({ where: { id: mine }, data: { status: 'delivered' } })
    const cookie = await signIn(EMAIL)

    const response = await cancel(mine, cookie)

    expect(response.status).toBe(409)
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('TERMINAL')
  })
})
