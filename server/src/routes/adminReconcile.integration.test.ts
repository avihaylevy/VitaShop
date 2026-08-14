import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import argon2 from 'argon2'
import express from 'express'
import type { Server } from 'node:http'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createAdminOrderRouter } from './adminOrders.js'
import { createAuthRouter } from './auth.js'
import { createAuthRateLimiters } from '../lib/rateLimit.js'
import { ARGON2_OPTIONS } from '../lib/registrationService.js'
import { prewarmDummyHash } from '../lib/loginService.js'
import { createSessionMiddleware } from '../lib/session.js'
import { NullEmailProvider } from '../lib/emailService.js'
import { createOrder } from '../lib/orderService.js'
import { STUCK_AFTER_MINUTES } from '../lib/orderReconciliation.js'
import { TEST_FIXTURE_SLUG_PREFIX } from '../lib/testFixturePrefix.js'

/**
 * MILESTONE-008 Checkpoint G3 — ISSUE-082's TRIGGER. DEC-069.
 *
 * 🔴 THE SWEEP HAS EXISTED SINCE CHECKPOINT E AND NOTHING HAS EVER CALLED IT.
 * `reconcileStuckOrders` is written, tested and mutation-proved; a swallowed
 * failure still returns 201, so no retry is sent and no code path invokes it.
 * An order can therefore sit at `pending_payment` with its stock gone and no
 * transition out — not even an admin's, because §8.9 allows only `paid` or
 * `cancelled` from there.
 *
 * 🔴 AN ADMIN ACTION, NOT A SCHEDULE — DEC-069. Nothing in this project runs
 * scheduled work, and a job runner is its own dependency decision.
 *
 * ⚠️ EVERY TEST HERE SCOPES THE SWEEP TO ITS OWN FIXTURE USER. Unscoped, the
 * repair MUTATES every stuck order in the development database — including any
 * left by another suite — which is the hazard `ReconcileOptions.userId` exists
 * for and which this file must not be the one to demonstrate.
 */

let prisma: PrismaClient
let server: Server
let baseUrl: string

const SLUG = `${TEST_FIXTURE_SLUG_PREFIX}reconcile-route`
const ADMIN = 'zz-reconcile-admin@example.test'
const SHOPPER = 'zz-reconcile-shopper@example.test'
const PASSWORD = 'Abcdef12xyz'
const ADDRESS = { line1: 'רחוב הבדיקה 9', city: 'תל אביב', zipCode: '6100000' }

let shopperId = ''

async function wipeOrders(): Promise<void> {
  const orders = await prisma.order.findMany({
    where: { user: { email: { in: [ADMIN, SHOPPER] } } },
    select: { id: true },
  })
  if (orders.length > 0) {
    const ids = orders.map((o) => o.id)
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: ids } } })
    await prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } })
    await prisma.order.deleteMany({ where: { id: { in: ids } } })
  }
  const carts = await prisma.cart.findMany({
    where: { user: { email: { in: [ADMIN, SHOPPER] } } },
    select: { id: true },
  })
  if (carts.length > 0) {
    const ids = carts.map((c) => c.id)
    await prisma.cartItem.deleteMany({ where: { cartId: { in: ids } } })
    await prisma.cart.deleteMany({ where: { id: { in: ids } } })
  }
}

/** An order left at `pending_payment` and back-dated past the stuck window. */
async function stuckOrder(key: string): Promise<string> {
  const product = await prisma.product.findUniqueOrThrow({ where: { slug: SLUG }, select: { id: true } })
  const cart = await prisma.cart.upsert({
    where: { userId: shopperId },
    create: { userId: shopperId },
    update: {},
    select: { id: true },
  })
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } })
  await prisma.cartItem.create({
    data: { cartId: cart.id, productId: product.id, quantity: 1 },
    select: { id: true },
  })
  const result = await createOrder(prisma, {
    userId: shopperId,
    idempotencyKey: key,
    deliveryMethod: 'courier',
    address: ADDRESS,
  })
  if (!result.ok) throw new Error(`fixture order failed: ${result.reason}`)

  // 🔴 BACK-DATED, because "stuck" is defined by age. A fresh order is
  // IN FLIGHT, and a sweep that repaired those would race live checkouts.
  await prisma.order.update({
    where: { id: result.orderId },
    data: { createdAt: new Date(Date.now() - (STUCK_AFTER_MINUTES + 5) * 60_000) },
  })
  return result.orderId
}

const cookies = new Map<string, string>()

async function signIn(email: string): Promise<string> {
  const cached = cookies.get(email)
  if (cached !== undefined) return cached
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  expect(response.status).toBe(200)
  const cookie = (response.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
  cookies.set(email, cookie)
  return cookie
}

function post(path: string, cookie?: string, body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body ?? {}),
  })
}

function get(path: string, cookie?: string) {
  return fetch(`${baseUrl}${path}`, { headers: cookie ? { cookie } : {} })
}

async function statusOf(orderId: string): Promise<string> {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } })
  return order.status
}

beforeAll(async () => {
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  await prewarmDummyHash()

  const seeded = await prisma.product.findFirstOrThrow({
    where: { isActive: true },
    select: { categoryId: true, brandId: true },
  })
  await prisma.product.upsert({
    where: { slug: SLUG },
    create: {
      slug: SLUG,
      nameHe: 'בדיקת התאמה',
      nameEn: 'Reconcile test',
      categoryId: seeded.categoryId,
      brandId: seeded.brandId,
      dosageForm: 'CAPSULE',
      packageQuantity: 60,
      usageInstructions: 'בדיקה',
      descriptionHe: 'בדיקה',
      descriptionEn: 'test',
      warningsAllergens: '',
      price: '40.00',
      stockQuantity: 500,
      isActive: true,
    },
    update: { stockQuantity: 500, isActive: true },
    select: { id: true },
  })

  const hash = await argon2.hash(PASSWORD, ARGON2_OPTIONS)
  for (const email of [ADMIN, SHOPPER]) {
    await prisma.user.upsert({
      where: { email },
      create: {
        email,
        firstName: 'Reconcile',
        lastName: 'Fixture',
        passwordHash: hash,
        termsAcceptedAt: new Date(),
        status: 'active',
      },
      update: { passwordHash: hash, status: 'active' },
      select: { id: true },
    })
  }
  await prisma.user.update({ where: { email: ADMIN }, data: { role: 'admin' } })
  await prisma.user.update({ where: { email: SHOPPER }, data: { role: 'customer' } })
  shopperId = (await prisma.user.findUniqueOrThrow({ where: { email: SHOPPER }, select: { id: true } })).id

  const app = express()
  app.use(express.json())
  app.use(createSessionMiddleware())
  app.use(
    '/api',
    createAuthRouter({
      prisma,
      emailService: new NullEmailProvider(),
      appBaseUrl: 'http://127.0.0.1',
      rateLimiters: createAuthRateLimiters(),
    }),
  )
  app.use('/api/admin/orders', createAdminOrderRouter({ prisma }))
  server = app.listen(0)
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await wipeOrders()
  await prisma.orderItem.deleteMany({ where: { product: { slug: SLUG } } })
  await prisma.cartItem.deleteMany({ where: { product: { slug: SLUG } } })
  await prisma.product.deleteMany({ where: { slug: SLUG } })
  server.close()
  await prisma.$disconnect()
})

beforeEach(wipeOrders)
afterEach(wipeOrders)

describe('GET /api/admin/orders/stuck — the read half', () => {
  it('counts stuck orders without changing any of them', async () => {
    const orderId = await stuckOrder('rec-read-1')
    const cookie = await signIn(ADMIN)

    const response = await get(`/api/admin/orders/stuck?userId=${shopperId}`, cookie)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { count: number; orders: { orderNumber: string }[] }
    expect(body.count).toBe(1)
    expect(body.orders).toHaveLength(1)

    // 🔴 THE READ IS SAFE, and this is the assertion that says so.
    expect(await statusOf(orderId)).toBe('pending_payment')
  })

  it('a FRESH pending order is not stuck — it is in flight', async () => {
    // The control that keeps "stuck" meaning something. Without it, a sweep
    // that repaired everything pending would pass every other test here and
    // race live checkouts in production.
    const product = await prisma.product.findUniqueOrThrow({ where: { slug: SLUG }, select: { id: true } })
    const cart = await prisma.cart.upsert({
      where: { userId: shopperId },
      create: { userId: shopperId },
      update: {},
      select: { id: true },
    })
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } })
    await prisma.cartItem.create({
      data: { cartId: cart.id, productId: product.id, quantity: 1 },
      select: { id: true },
    })
    const fresh = await createOrder(prisma, {
      userId: shopperId,
      idempotencyKey: 'rec-fresh',
      deliveryMethod: 'courier',
      address: ADDRESS,
    })
    if (!fresh.ok) throw new Error('fixture failed')

    const cookie = await signIn(ADMIN)
    const body = (await (await get(`/api/admin/orders/stuck?userId=${shopperId}`, cookie)).json()) as {
      count: number
    }
    expect(body.count).toBe(0)
    expect(await statusOf(fresh.orderId)).toBe('pending_payment')
  })

  it('🔴 refuses a non-admin, and refuses anonymous — differently', async () => {
    await stuckOrder('rec-read-guard')

    expect((await get(`/api/admin/orders/stuck?userId=${shopperId}`)).status).toBe(401)

    const shopper = await signIn(SHOPPER)
    expect((await get(`/api/admin/orders/stuck?userId=${shopperId}`, shopper)).status).toBe(403)
  })
})

describe('POST /api/admin/orders/reconcile — the repair', () => {
  it('🔴 REPAIRS a stuck order, and reports what it did', async () => {
    const orderId = await stuckOrder('rec-repair-1')
    const cookie = await signIn(ADMIN)

    const response = await post('/api/admin/orders/reconcile', cookie, { userId: shopperId })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { examined: number; repaired: number; failed: unknown[] }
    expect(body.examined).toBe(1)
    expect(body.repaired).toBe(1)
    expect(body.failed).toEqual([])

    // 🔴 THE ORDER ACTUALLY MOVED. A report of "repaired: 1" over an unchanged
    // row is the failure shape this project keeps recording.
    expect(await statusOf(orderId)).toBe('paid')
  })

  it('🔴 leaves a FRESH pending order alone — it is in flight, not stuck', async () => {
    const product = await prisma.product.findUniqueOrThrow({ where: { slug: SLUG }, select: { id: true } })
    const cart = await prisma.cart.upsert({
      where: { userId: shopperId },
      create: { userId: shopperId },
      update: {},
      select: { id: true },
    })
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } })
    await prisma.cartItem.create({
      data: { cartId: cart.id, productId: product.id, quantity: 1 },
      select: { id: true },
    })
    const fresh = await createOrder(prisma, {
      userId: shopperId,
      idempotencyKey: 'rec-repair-fresh',
      deliveryMethod: 'courier',
      address: ADDRESS,
    })
    if (!fresh.ok) throw new Error('fixture failed')

    const cookie = await signIn(ADMIN)
    const body = (await (await post('/api/admin/orders/reconcile', cookie, { userId: shopperId })).json()) as {
      examined: number
      repaired: number
    }
    expect(body.examined).toBe(0)
    expect(body.repaired).toBe(0)
    expect(await statusOf(fresh.orderId)).toBe('pending_payment')
  })

  it('nothing to repair is a SUCCESS with zeroes, not an error', async () => {
    const cookie = await signIn(ADMIN)
    const response = await post('/api/admin/orders/reconcile', cookie, { userId: shopperId })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ examined: 0, repaired: 0, failed: [] })
  })

  it('🔴 A SHOPPER CANNOT RUN IT — 403, and the order is untouched', async () => {
    /*
     * The sweep marks orders PAID. A shopper reaching it could settle their own
     * unpaid order, which is the most valuable thing in this milestone to get
     * wrong — so the refusal is asserted against the DATABASE, not just the
     * status code.
     */
    const orderId = await stuckOrder('rec-guard-shopper')
    const shopper = await signIn(SHOPPER)

    const response = await post('/api/admin/orders/reconcile', shopper, { userId: shopperId })
    expect(response.status).toBe(403)
    expect(await statusOf(orderId)).toBe('pending_payment')
  })

  it('🔴 AN ANONYMOUS CALLER CANNOT RUN IT — 401, and the order is untouched', async () => {
    const orderId = await stuckOrder('rec-guard-anon')

    const response = await post('/api/admin/orders/reconcile')
    expect(response.status).toBe(401)
    expect(await statusOf(orderId)).toBe('pending_payment')
  })

  it('🔴 THE CONTROL — the admin CAN, on the same fixture the other two were refused', async () => {
    // Without this, every guard test above would pass against a route that
    // refused everyone, and "nobody can settle orders" would look like security
    // rather than a broken endpoint.
    const orderId = await stuckOrder('rec-guard-control')
    const admin = await signIn(ADMIN)

    expect((await post('/api/admin/orders/reconcile', admin, { userId: shopperId })).status).toBe(200)
    expect(await statusOf(orderId)).toBe('paid')
  })
})
