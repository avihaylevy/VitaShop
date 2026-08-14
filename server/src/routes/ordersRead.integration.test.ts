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
 * MILESTONE-008 Checkpoint G1 — `GET /api/orders` and `GET /api/orders/:id`.
 * REQ-F-050 · TEST-050 · 🔴 TEST-050b.
 *
 * 🔴 ANOTHER SHOPPER'S ORDER ANSWERS 404, NOT 403 — DEC-070, decided before
 * this file was written. TEST-050b said 403 while the cancel route shipped at
 * Checkpoint E3 answers 404 and cites TEST-050b as its reason. Both hide the
 * order; what settled it is that TWO ROUTES ON ONE RESOURCE MUST NOT DISAGREE.
 * A 403 here beside a 404 there makes the PAIR an oracle: 403-then-404 means
 * "real, and someone else's". The test was amended, with the reasoning
 * recorded, rather than the code bent to a literal reading.
 *
 * ⚠️ EVERY REFUSAL TEST CARRIES ITS CONTROL. A route that 404s everything
 * satisfies the IDOR case perfectly and serves nobody — the same shape as the
 * over-eager screen recorded in `.claude/rules/browser-verification.md`, where
 * rejecting everything read as diligence.
 */

let prisma: PrismaClient
let server: Server
let baseUrl: string

const SLUG_A = `${TEST_FIXTURE_SLUG_PREFIX}orders-read-a`
const SLUG_B = `${TEST_FIXTURE_SLUG_PREFIX}orders-read-b`
const EMAIL = 'zz-ordersread@example.test'
const OTHER_EMAIL = 'zz-ordersread-other@example.test'
const PASSWORD = 'Abcdef12xyz'
const ADDRESS = { line1: 'רחוב הבדיקה 7', city: 'תל אביב', zipCode: '6100000' }

let userId = ''
let otherUserId = ''

async function wipeOrders(): Promise<void> {
  const orders = await prisma.order.findMany({
    where: { user: { email: { in: [EMAIL, OTHER_EMAIL] } } },
    select: { id: true },
  })
  if (orders.length > 0) {
    const ids = orders.map((o) => o.id)
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: ids } } })
    await prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } })
    await prisma.order.deleteMany({ where: { id: { in: ids } } })
  }
  const carts = await prisma.cart.findMany({
    where: { user: { email: { in: [EMAIL, OTHER_EMAIL] } } },
    select: { id: true },
  })
  if (carts.length > 0) {
    const ids = carts.map((c) => c.id)
    await prisma.cartItem.deleteMany({ where: { cartId: { in: ids } } })
    await prisma.cart.deleteMany({ where: { id: { in: ids } } })
  }
}

/** Places a real order through the service, so the frozen columns are real. */
async function placeOrder(who: string, key: string, lines: { slug: string; quantity: number }[]) {
  const cart = await prisma.cart.upsert({
    where: { userId: who },
    create: { userId: who },
    update: {},
    select: { id: true },
  })
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } })
  for (const line of lines) {
    const product = await prisma.product.findUniqueOrThrow({
      where: { slug: line.slug },
      select: { id: true },
    })
    await prisma.cartItem.create({
      data: { cartId: cart.id, productId: product.id, quantity: line.quantity },
      select: { id: true },
    })
  }
  const result = await createOrder(prisma, {
    userId: who,
    idempotencyKey: key,
    deliveryMethod: 'courier',
    address: ADDRESS,
  })
  if (!result.ok) throw new Error(`fixture order failed: ${result.reason}`)
  return result.orderId
}

/** The same, for SELF PICKUP — no address at all, which is the branch that matters. */
async function placePickupOrder(who: string, key: string, slug: string): Promise<string> {
  const cart = await prisma.cart.upsert({
    where: { userId: who },
    create: { userId: who },
    update: {},
    select: { id: true },
  })
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } })
  const product = await prisma.product.findUniqueOrThrow({ where: { slug }, select: { id: true } })
  await prisma.cartItem.create({
    data: { cartId: cart.id, productId: product.id, quantity: 1 },
    select: { id: true },
  })
  const result = await createOrder(prisma, {
    userId: who,
    idempotencyKey: key,
    deliveryMethod: 'self_pickup',
    // 🔴 EXPLICITLY null, not omitted — `CreateOrderInput.address` is
    // "required for courier and pickup point, FORBIDDEN for self pickup", and
    // the type says so by making the property required and nullable.
    address: null,
  })
  if (!result.ok) throw new Error(`pickup fixture failed: ${result.reason}`)
  return result.orderId
}

/**
 * 🔴 SIGNED IN ONCE PER ACCOUNT, THEN CACHED, and that is a correctness fix
 * rather than a speed one.
 *
 * `AUTH_RATE_LIMITS.login` allows TEN per fifteen minutes, keyed on IP, and
 * every request here comes from 127.0.0.1. This file logged in nine times; the
 * tenth login-using test tips it over, `signIn` gets a 429, and the failure
 * names whichever test happened to be tenth rather than the cause. A suite that
 * breaks on being EXTENDED is a trap for whoever extends it.
 */
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
  const set = response.headers.get('set-cookie')
  if (!set) throw new Error('login returned no session cookie')
  const cookie = set.split(';')[0] ?? ''
  cookies.set(email, cookie)
  return cookie
}

function get(path: string, cookie?: string) {
  return fetch(`${baseUrl}${path}`, {
    headers: cookie ? { cookie } : {},
  })
}

beforeAll(async () => {
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  await prewarmDummyHash()

  // Category and brand are taken from a seeded row rather than invented — the
  // sibling cancel-route test does the same, and a fixture that guesses a
  // required relation breaks whenever the seed changes.
  const seeded = await prisma.product.findFirstOrThrow({
    where: { isActive: true },
    select: { categoryId: true, brandId: true },
  })
  for (const [slug, nameHe, nameEn] of [
    [SLUG_A, 'מוצר היסטוריה א', 'History Product A'],
    [SLUG_B, 'מוצר היסטוריה ב', 'History Product B'],
  ] as const) {
    await prisma.product.upsert({
      where: { slug },
      create: {
        slug,
        nameHe,
        nameEn,
        categoryId: seeded.categoryId,
        brandId: seeded.brandId,
        dosageForm: 'CAPSULE',
        packageQuantity: 60,
        usageInstructions: 'בדיקה',
        descriptionHe: 'בדיקה',
        descriptionEn: 'test',
        warningsAllergens: '',
        price: '50.00',
        stockQuantity: 500,
        isActive: true,
      },
      update: { stockQuantity: 500, isActive: true, price: '50.00' },
      select: { id: true },
    })
  }

  const hash = await argon2.hash(PASSWORD, ARGON2_OPTIONS)
  for (const email of [EMAIL, OTHER_EMAIL]) {
    await prisma.user.upsert({
      where: { email },
      create: {
        email,
        firstName: 'Orders',
        lastName: 'Read',
        passwordHash: hash,
        termsAcceptedAt: new Date(),
        status: 'active',
      },
      update: { passwordHash: hash, status: 'active' },
      select: { id: true },
    })
  }
  userId = (await prisma.user.findUniqueOrThrow({ where: { email: EMAIL }, select: { id: true } })).id
  otherUserId = (
    await prisma.user.findUniqueOrThrow({ where: { email: OTHER_EMAIL }, select: { id: true } })
  ).id

  const app = express()
  app.use(express.json())
  app.use(createSessionMiddleware())
  // Mounted at `/api`, matching the sibling cancel-route test: the auth router
  // declares its own `/auth/...` paths, so mounting it at `/api/auth` would
  // make login `/api/auth/auth/login` and every sign-in a 404.
  app.use(
    '/api',
    createAuthRouter({
      prisma,
      emailService: new NullEmailProvider(),
      appBaseUrl: 'http://127.0.0.1',
      rateLimiters: createAuthRateLimiters(),
    }),
  )
  app.use('/api/orders', createOrderRouter({ prisma }))
  server = app.listen(0)
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await wipeOrders()
  await prisma.orderItem.deleteMany({ where: { product: { slug: { in: [SLUG_A, SLUG_B] } } } })
  await prisma.cartItem.deleteMany({ where: { product: { slug: { in: [SLUG_A, SLUG_B] } } } })
  await prisma.product.deleteMany({ where: { slug: { in: [SLUG_A, SLUG_B] } } })
  server.close()
  await prisma.$disconnect()
})

beforeEach(wipeOrders)
afterEach(wipeOrders)

describe('GET /api/orders — TEST-050, the history itself', () => {
  it('returns the caller\'s orders with status and the ITEM BREAKDOWN', async () => {
    await placeOrder(userId, 'read-key-1', [
      { slug: SLUG_A, quantity: 2 },
      { slug: SLUG_B, quantity: 1 },
    ])
    const cookie = await signIn(EMAIL)

    const response = await get('/api/orders', cookie)
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      orders: {
        id: string
        orderNumber: string
        status: string
        totalAmount: string
        items: { nameHe: string; nameEn: string; quantity: number; unitPrice: string }[]
      }[]
    }

    expect(body.orders).toHaveLength(1)
    const order = body.orders[0]!
    expect(order.status).toBe('pending_payment')
    expect(order.orderNumber).toMatch(/\S/)

    // 🔴 REQ-F-050 SAYS "item breakdown", so the breakdown is the assertion.
    expect(order.items).toHaveLength(2)
    const names = order.items.map((line) => line.nameEn).sort()
    expect(names).toEqual(['History Product A', 'History Product B'])
    const productA = order.items.find((line) => line.nameEn === 'History Product A')!
    expect(productA.quantity).toBe(2)
    // INV-02 — the FROZEN price, as a fixed string, never a float.
    expect(productA.unitPrice).toBe('50.00')
    // 🔴 BILINGUAL, because the freeze is bilingual. A single name would pick a
    // language at purchase time and show it forever, which is the defect
    // Checkpoint B's migration split the column to prevent.
    expect(productA.nameHe).toBe('מוצר היסטוריה א')
  })

  it('🔴 lists ONLY the caller\'s orders — with the control that proves it lists anything', async () => {
    const mine = await placeOrder(userId, 'read-key-mine', [{ slug: SLUG_A, quantity: 1 }])
    const theirs = await placeOrder(otherUserId, 'read-key-theirs', [{ slug: SLUG_A, quantity: 1 }])

    const cookie = await signIn(EMAIL)
    const body = (await (await get('/api/orders', cookie)).json()) as { orders: { id: string }[] }
    const ids = body.orders.map((order) => order.id)

    expect(ids).toContain(mine) // the control
    expect(ids).not.toContain(theirs) // the point
  })

  it('🔴 orders NEWEST FIRST', async () => {
    /*
     * ⚠️ THIS ASSERTION USED `arrayContaining` AND A LENGTH, both of which are
     * ORDER-AGNOSTIC — flipping the handler to `createdAt: 'asc'` left all ten
     * tests green, so the ordering the route promises was verified nowhere.
     * Found by review, mutation-confirmed.
     *
     * The earlier comment claimed the two fixtures might share a `createdAt`.
     * They cannot: each `placeOrder` is its OWN transaction, and Prisma's
     * now() is transaction-start time — identical stamps need one transaction.
     * So an exact sequence is available and is what gets asserted.
     */
    const first = await placeOrder(userId, 'read-key-first', [{ slug: SLUG_A, quantity: 1 }])
    const second = await placeOrder(userId, 'read-key-second', [{ slug: SLUG_B, quantity: 1 }])

    const cookie = await signIn(EMAIL)
    const body = (await (await get('/api/orders', cookie)).json()) as { orders: { id: string }[] }

    expect(body.orders.map((o) => o.id)).toEqual([second, first])
  })

  it('answers 401 to an anonymous caller, and does not leak a count', async () => {
    await placeOrder(userId, 'read-key-anon', [{ slug: SLUG_A, quantity: 1 }])
    const response = await get('/api/orders')
    expect(response.status).toBe(401)
    expect(await response.text()).not.toContain('orderNumber')
  })

  it('🔴 says hasMore when the history is TRUNCATED, and false when it is not', async () => {
    /*
     * ISSUE-100 — `take: 50` dropped the rest with no signal at all, so a
     * shopper with 51 orders saw 50 and the screen could not even say so
     * honestly. One extra row is fetched and discarded to detect it. Found in
     * review.
     *
     * ⚠️ Both directions asserted in one test: a `hasMore` that is always true
     * would pass the first half and fail the second.
     */
    const cookie = await signIn(EMAIL)

    await placeOrder(userId, 'read-key-nomore', [{ slug: SLUG_A, quantity: 1 }])
    const small = (await (await get('/api/orders', cookie)).json()) as {
      orders: unknown[]
      hasMore: boolean
    }
    expect(small.hasMore).toBe(false)
    expect(small.orders).toHaveLength(1)

    // 51 orders: one page of 50, and a flag saying there is more.
    for (let index = 0; index < 50; index += 1) {
      await placeOrder(userId, `read-key-bulk-${index}`, [{ slug: SLUG_A, quantity: 1 }])
    }
    const full = (await (await get('/api/orders', cookie)).json()) as {
      orders: unknown[]
      hasMore: boolean
    }
    expect(full.orders).toHaveLength(50)
    expect(full.hasMore).toBe(true)
  }, 60_000)

  it('🔴 items tie-break on a UNIQUE column when two frozen names are identical', async () => {
    /*
     * 🔴 THIS TEST DOES NOT PROVE THE TIEBREAKER, AND SAYING SO IS THE POINT.
     *
     * Removing `productId` from the item `orderBy` leaves it GREEN — measured,
     * twice. Postgres is FREE to return tied rows in any order, and on this
     * database it happens to return them by id anyway, so the mutation changes
     * nothing observable. The lines are even inserted in reverse id order to
     * try to force the issue, and it still passes without the fix.
     *
     * ⚠️ So this is a CONTRACT TEST, not a guard: it pins what the route
     * promises (equal names tie-break on a unique column) and would catch a
     * gross regression such as reversed or randomised ordering. It would NOT
     * catch the tiebreaker being deleted. The fix itself is correct by
     * construction — `productNameEnAtPurchase` has no uniqueness constraint —
     * and rests on that argument rather than on this assertion.
     *
     * 🔴 Recorded here rather than left for someone to discover the hard way,
     * because a test that has never been seen to fail has not been shown to
     * test anything.
     */
    const [first, second] = await Promise.all([
      prisma.product.findUniqueOrThrow({ where: { slug: SLUG_A }, select: { id: true } }),
      prisma.product.findUniqueOrThrow({ where: { slug: SLUG_B }, select: { id: true } }),
    ])
    const ascending = [first.id, second.id].sort()
    const slugById = new Map([
      [first.id, SLUG_A],
      [second.id, SLUG_B],
    ])

    // Both products wear the SAME English name for this test.
    await prisma.product.updateMany({
      where: { slug: { in: [SLUG_A, SLUG_B] } },
      data: { nameEn: 'Identical Name' },
    })
    try {
      await placeOrder(userId, 'read-key-tie', [
        // The higher id goes in FIRST.
        { slug: slugById.get(ascending[1]!)!, quantity: 1 },
        { slug: slugById.get(ascending[0]!)!, quantity: 1 },
      ])
      const cookie = await signIn(EMAIL)
      const body = (await (await get('/api/orders', cookie)).json()) as {
        orders: { items: { productId: string; nameEn: string }[] }[]
      }

      const items = body.orders[0]!.items
      expect(items.map((item) => item.nameEn)).toEqual(['Identical Name', 'Identical Name'])
      expect(items.map((item) => item.productId)).toEqual(ascending)
    } finally {
      await prisma.product.update({ where: { slug: SLUG_A }, data: { nameEn: 'History Product A' } })
      await prisma.product.update({ where: { slug: SLUG_B }, data: { nameEn: 'History Product B' } })
    }
  })

  it('an empty history is an EMPTY LIST, not an error', async () => {
    const cookie = await signIn(OTHER_EMAIL)
    const response = await get('/api/orders', cookie)
    expect(response.status).toBe(200)
    expect(((await response.json()) as { orders: unknown[] }).orders).toEqual([])
  })
})

describe('GET /api/orders/:id — TEST-050b, the IDOR case', () => {
  it('returns the owner\'s own order, with its items and frozen shipping', async () => {
    const orderId = await placeOrder(userId, 'read-key-detail', [{ slug: SLUG_A, quantity: 3 }])
    const cookie = await signIn(EMAIL)

    const response = await get(`/api/orders/${orderId}`, cookie)
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      id: string
      status: string
      deliveryMethod: string
      shippingAddress: { line1: string; city: string; zipCode: string } | null
      items: { quantity: number }[]
    }
    expect(body.id).toBe(orderId)
    expect(body.items).toHaveLength(1)
    expect(body.items[0]!.quantity).toBe(3)
    expect(body.deliveryMethod).toBe('courier')
    // INV-02's other half — the address is COPIED onto the order, so history
    // shows where it actually shipped even after the account address changes.
    expect(body.shippingAddress?.city).toBe('תל אביב')
  })

  it('🔴 a SELF-PICKUP order has NO address — null, not an object of nulls', async () => {
    /*
     * 🔴 THE BRANCH NOTHING EXERCISED. Every other fixture here is `courier`,
     * so deleting the null check entirely would have kept this suite green
     * while a pickup order started returning
     * `{ line1: null, city: null, zipCode: null }` — which renders as a BLANK
     * ADDRESS rather than as no address, and is exactly what the handler's
     * comment says must not happen. Found by review.
     */
    const orderId = await placePickupOrder(userId, 'read-key-pickup', SLUG_A)
    const cookie = await signIn(EMAIL)

    const body = (await (await get(`/api/orders/${orderId}`, cookie)).json()) as {
      deliveryMethod: string
      shippingAddress: unknown
      shippingCost: string
    }
    expect(body.deliveryMethod).toBe('self_pickup')
    expect(body.shippingAddress).toBeNull()
    // The control that keeps the assertion honest: a courier order in the same
    // shape DOES carry one, so `null` here is the pickup case and not a route
    // that never returns an address at all.
    const courierId = await placeOrder(userId, 'read-key-pickup-control', [
      { slug: SLUG_B, quantity: 1 },
    ])
    const courier = (await (await get(`/api/orders/${courierId}`, cookie)).json()) as {
      shippingAddress: { city: string } | null
    }
    expect(courier.shippingAddress?.city).toBe('תל אביב')
  })

  it('🔴 TEST-050b — another shopper\'s order is 404 AND the order is never returned', async () => {
    const theirs = await placeOrder(otherUserId, 'read-key-idor', [{ slug: SLUG_A, quantity: 1 }])
    const theirOrder = await prisma.order.findUniqueOrThrow({
      where: { id: theirs },
      select: { orderNumber: true },
    })

    const cookie = await signIn(EMAIL)
    const response = await get(`/api/orders/${theirs}`, cookie)

    // DEC-070 — 404, matching the cancel route, so the two cannot be diffed.
    expect(response.status).toBe(404)
    const text = await response.text()
    // 🔴 THE BREACH THE TEST NAMES: the order itself must not come back, in
    // any field. Asserted against the real order number rather than a shape.
    expect(text).not.toContain(theirOrder.orderNumber)
    expect(text).not.toContain('History Product A')
  })

  it('🔴 THE CONTROL — the owner gets 200 for the SAME id the stranger was refused', async () => {
    /*
     * Without this, a route that answered 404 to everyone would satisfy the
     * IDOR test perfectly while serving nobody. Same id, two callers, two
     * answers — that is what makes the refusal mean something.
     */
    const theirs = await placeOrder(otherUserId, 'read-key-control', [{ slug: SLUG_A, quantity: 1 }])

    const stranger = await signIn(EMAIL)
    expect((await get(`/api/orders/${theirs}`, stranger)).status).toBe(404)

    const owner = await signIn(OTHER_EMAIL)
    expect((await get(`/api/orders/${theirs}`, owner)).status).toBe(200)
  })

  it('an id that does not exist is INDISTINGUISHABLE from one that is not yours', async () => {
    const theirs = await placeOrder(otherUserId, 'read-key-same', [{ slug: SLUG_A, quantity: 1 }])
    const cookie = await signIn(EMAIL)

    const missing = await get('/api/orders/11111111-2222-3333-4444-555555555555', cookie)
    const notMine = await get(`/api/orders/${theirs}`, cookie)

    expect(missing.status).toBe(notMine.status)
    expect(await missing.json()).toEqual(await notMine.json())
  })

  it('answers 401 to an anonymous caller', async () => {
    const orderId = await placeOrder(userId, 'read-key-detail-anon', [{ slug: SLUG_A, quantity: 1 }])
    const response = await get(`/api/orders/${orderId}`)
    expect(response.status).toBe(401)
  })
})

describe('how long these responses are allowed to live', () => {
  /*
   * 🔴 THIS ROUTER WAS POST-ONLY UNTIL G1, and browsers do not cache POSTs, so
   * it carried no cache header at all. The two new GETs carry order numbers, an
   * item breakdown, a home address and a tracking number — the same category of
   * data `routes/account.ts` sets `no-store` for, naming this exact hazard: a
   * back-navigation on a shared machine re-rendering it AFTER SIGN-OUT.
   * Found by review.
   */
  it('🔴 the history says no-store', async () => {
    await placeOrder(userId, 'read-key-cache', [{ slug: SLUG_A, quantity: 1 }])
    const cookie = await signIn(EMAIL)
    const response = await get('/api/orders', cookie)
    expect(response.status).toBe(200) // the control — a 401 also carries the header
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('🔴 the detail says no-store', async () => {
    const orderId = await placeOrder(userId, 'read-key-cache-detail', [
      { slug: SLUG_A, quantity: 1 },
    ])
    const cookie = await signIn(EMAIL)
    const response = await get(`/api/orders/${orderId}`, cookie)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('says it on the REFUSALS too — a cached 401 or 404 is its own bug', async () => {
    // The answer changes the moment somebody else signs in on this machine.
    expect((await get('/api/orders')).headers.get('cache-control')).toBe('no-store')
    const cookie = await signIn(EMAIL)
    const missing = await get('/api/orders/11111111-2222-3333-4444-555555555555', cookie)
    expect(missing.status).toBe(404)
    expect(missing.headers.get('cache-control')).toBe('no-store')
  })
})

/**
 * DEC-074 — a DISABLED shopper may READ their own orders; writes stay blocked.
 * ISSUE-101, answered by the user 2026-08-14: suspension stops ACTING, not
 * seeing one's own purchase records.
 */
describe('DEC-074 — a disabled shopper and their own orders', () => {
  it('🔴 reads their HISTORY and a DETAIL while disabled, and is still refused the WRITE', async () => {
    const orderId = await placeOrder(userId, 'read-key-disabled', [{ slug: SLUG_A, quantity: 1 }])
    const cookie = await signIn(EMAIL)
    try {
      await prisma.user.update({ where: { email: EMAIL }, data: { status: 'disabled' } })

      // The two READS survive the suspension.
      const list = await get('/api/orders', cookie)
      expect(list.status).toBe(200)
      const detail = await get(`/api/orders/${orderId}`, cookie)
      expect(detail.status).toBe(200)

      // 🔴 THE CONTROL, and the boundary: the WRITE is refused — and per
      // requireActiveShopper's contract the refusal DESTROYS the session, so
      // the same cookie is now signed out everywhere. DEC-074 loosened
      // exactly two reads, nothing else.
      const cancel = await fetch(`${baseUrl}/api/orders/${orderId}/cancel`, {
        method: 'POST', headers: { cookie },
      })
      expect(cancel.status).toBe(401)
      expect((await get('/api/orders', cookie)).status).toBe(401)
    } finally {
      await prisma.user.update({ where: { email: EMAIL }, data: { status: 'active' } })
      // The write refusal destroyed this session — drop the cached cookie so
      // any later test signs in fresh instead of inheriting a dead one.
      cookies.delete(EMAIL)
    }
  })

  it('🔴 a DELETED account cookie is 401 and torn down — DEC-074 loosened disabled, never existence', async () => {
    // Review finding: the first cut used the bare session guard, so a phantom
    // session answered `200 []` forever instead of sending its holder to sign
    // in. This fixture user exists only for this test (INV-03 protects
    // Product/Order, not User; the row is this test's own).
    const GHOST = 'zz-ordersread-ghost@example.test'
    const hash = await argon2.hash(PASSWORD, ARGON2_OPTIONS)
    await prisma.user.create({
      data: {
        email: GHOST, firstName: 'Ghost', lastName: 'Fixture',
        passwordHash: hash, termsAcceptedAt: new Date(), status: 'active',
      },
      select: { id: true },
    })
    const cookie = await signIn(GHOST)
    try {
      await prisma.user.delete({ where: { email: GHOST } })

      const list = await get('/api/orders', cookie)
      expect(list.status).toBe(401)
      // And the session is DESTROYED, not merely refused: the same cookie
      // must stay signed out even if the guard were later removed again.
      expect((await get('/api/orders', cookie)).status).toBe(401)
    } finally {
      cookies.delete(GHOST)
      await prisma.user.deleteMany({ where: { email: GHOST } })
    }
  })
})
