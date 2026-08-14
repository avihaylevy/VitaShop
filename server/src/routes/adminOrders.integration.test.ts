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
import { TEST_FIXTURE_SLUG_PREFIX } from '../lib/testFixturePrefix.js'

/**
 * ISSUE-083 — the admin transitions, over the wire.
 *
 * 🔴 THE GUARD IS THE SUBJECT, not the transitions — those are already proved
 * exhaustively at the service. What is new and security-sensitive is WHO gets
 * through: anonymous, an ordinary shopper, a demoted admin, a suspended admin.
 *
 * ⚠️ A FRESH APP PER TEST, so one test cannot spend another's limiter budget.
 */

let prisma: PrismaClient
let server: Server
let baseUrl: string

const SLUG = `${TEST_FIXTURE_SLUG_PREFIX}admin-route`
const ADMIN = 'zz-adminroute-admin@example.test'
const SHOPPER = 'zz-adminroute-shopper@example.test'
const PASSWORD = 'Abcdef12xyz'
const ADDRESS = { line1: 'רחוב הבדיקה 1', city: 'תל אביב', zipCode: '6100000' }

let adminId = ''
let shopperId = ''

async function wipe(): Promise<void> {
  const orders = await prisma.order.findMany({
    where: { user: { email: { in: [ADMIN, SHOPPER] } } }, select: { id: true },
  })
  if (orders.length > 0) {
    const ids = orders.map((o) => o.id)
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: ids } } })
    await prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } })
    await prisma.order.deleteMany({ where: { id: { in: ids } } })
  }
  const carts = await prisma.cart.findMany({
    where: { user: { email: { in: [ADMIN, SHOPPER] } } }, select: { id: true },
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

async function placeOrder(key: string, quantity: number): Promise<string> {
  const product = await prisma.product.findUniqueOrThrow({ where: { slug: SLUG }, select: { id: true } })
  const cart = await prisma.cart.upsert({
    where: { userId: shopperId }, create: { userId: shopperId }, update: {}, select: { id: true },
  })
  await prisma.cartItem.upsert({
    where: { cartId_productId: { cartId: cart.id, productId: product.id } },
    create: { cartId: cart.id, productId: product.id, quantity },
    update: { quantity },
    select: { id: true },
  })
  const r = await createOrder(prisma, {
    userId: shopperId, idempotencyKey: key, deliveryMethod: 'courier', address: ADDRESS,
  })
  if (!r.ok) throw new Error(`fixture order failed: ${r.reason}`)
  return r.orderId
}

async function setStatus(orderId: string, status: 'paid' | 'processing' | 'shipped') {
  await prisma.order.update({ where: { id: orderId }, data: { status } })
}

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

function patchStatus(orderId: string, status: string, cookie?: string) {
  return fetch(`${baseUrl}/api/admin/orders/${orderId}/status`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ status }),
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
      slug: SLUG, nameHe: 'בדיקת מנהל', nameEn: 'Admin test',
      categoryId: seeded.categoryId, brandId: seeded.brandId,
      dosageForm: 'CAPSULE', packageQuantity: 60, usageInstructions: 'בדיקה',
      price: '30.00', stockQuantity: 200,
      descriptionHe: 'בדיקה', descriptionEn: 'test', warningsAllergens: '',
      isActive: true,
    },
    update: { stockQuantity: 200, isActive: true },
    select: { id: true },
  })

  const hash = await argon2.hash(PASSWORD, ARGON2_OPTIONS)
  for (const [email, role] of [[ADMIN, 'admin'], [SHOPPER, 'customer']] as const) {
    await prisma.user.upsert({
      where: { email },
      create: {
        email, firstName: 'Admin', lastName: 'Route',
        passwordHash: hash, termsAcceptedAt: new Date(), status: 'active', role,
      },
      update: { status: 'active', role, passwordHash: hash },
      select: { id: true },
    })
  }
  adminId = (await prisma.user.findUniqueOrThrow({ where: { email: ADMIN }, select: { id: true } })).id
  shopperId = (await prisma.user.findUniqueOrThrow({ where: { email: SHOPPER }, select: { id: true } })).id
  await wipe()
}, 60_000)

beforeEach(async () => {
  const app = express()
  app.use(express.json())
  app.use(createSessionMiddleware())
  app.use('/api/admin/orders', createAdminOrderRouter({ prisma }))
  app.use('/api', createAuthRouter({
    prisma, emailService: new NullEmailProvider(),
    appBaseUrl: 'http://127.0.0.1', rateLimiters: createAuthRateLimiters(),
  }))
  await new Promise<void>((r) => { server = app.listen(0, () => r()) })
  const a = server.address()
  if (!a || typeof a === 'string') throw new Error('no ephemeral port')
  baseUrl = `http://127.0.0.1:${a.port}`
  await prisma.product.update({ where: { slug: SLUG }, data: { stockQuantity: 200 } })
  // Both accounts back to their intended shape after any test that changed them.
  await prisma.user.update({ where: { email: ADMIN }, data: { role: 'admin', status: 'active' } })
})

afterEach(async () => {
  await new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res())))
  await wipe()
})

afterAll(async () => {
  try {
    await wipe()
    await prisma.product.deleteMany({ where: { slug: SLUG } })
    await prisma.user.deleteMany({ where: { email: { in: [ADMIN, SHOPPER] } } })
  } finally {
    await prisma.$disconnect()
  }
})

describe('🔴 THE GUARD — who gets through, and what each refusal reveals', () => {
  it('anonymous is 401, not 403', async () => {
    const orderId = await placeOrder('adm-anon', 1)
    await setStatus(orderId, 'paid')
    const r = await patchStatus(orderId, 'processing')
    expect(r.status).toBe(401)
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe('AUTHENTICATION_REQUIRED')
  })

  it('🔴 an ordinary SHOPPER is 403 — signed in, but not theirs to do', async () => {
    const orderId = await placeOrder('adm-shopper', 1)
    await setStatus(orderId, 'paid')
    const cookie = await signIn(SHOPPER)

    const r = await patchStatus(orderId, 'processing', cookie)

    expect(r.status).toBe(403)
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe('ADMIN_REQUIRED')
    // 🔴 Nothing moved.
    const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } })
    expect(o.status).toBe('paid')
  })

  it('an ADMIN gets through — the control on both refusals above', async () => {
    // ⚠️ Without this, "everyone is refused" would satisfy the two tests above.
    const orderId = await placeOrder('adm-ok', 2)
    await setStatus(orderId, 'paid')
    const cookie = await signIn(ADMIN)

    const r = await patchStatus(orderId, 'processing', cookie)

    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({
      orderId, status: 'processing', changed: true, restoredStock: false,
    })
  })

  it('🔴 DEMOTING AN ADMIN TAKES EFFECT ON THE NEXT REQUEST — the whole reason the role is read per request', async () => {
    // DEC-065. A role cached in the session at login would keep this admin's
    // rights until the session expired, and this project's sessions are
    // long-lived. This is the test that fails if anyone "optimises" the lookup
    // into the session.
    const orderId = await placeOrder('adm-demote', 1)
    await setStatus(orderId, 'paid')
    const cookie = await signIn(ADMIN)

    // Works while they are an admin.
    expect((await patchStatus(orderId, 'processing', cookie)).status).toBe(200)

    // Demoted mid-session — the cookie is unchanged and still valid.
    await prisma.user.update({ where: { email: ADMIN }, data: { role: 'customer' } })

    const after = await patchStatus(orderId, 'shipped', cookie)
    expect(after.status).toBe(403)
    const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } })
    expect(o.status).toBe('processing')
  })

  it('🔴 a DISABLED admin is refused, whatever the session says', async () => {
    // The session outlives the account row it names. An admin whose account is
    // no longer `active` is not an admin.
    // ⚠️ `disabled` is the enum's word — there is no `suspended`. Caught by the
    // compiler on the first run of this test.
    const orderId = await placeOrder('adm-suspended', 1)
    await setStatus(orderId, 'paid')
    const cookie = await signIn(ADMIN)
    await prisma.user.update({ where: { email: ADMIN }, data: { status: 'disabled' } })

    const r = await patchStatus(orderId, 'processing', cookie)

    expect(r.status).toBe(403)
  })
})

describe('the transitions an admin may ask for', () => {
  it('paid → processing → shipped → delivered, each recorded with the admin as actor', async () => {
    const orderId = await placeOrder('adm-happy', 1)
    await setStatus(orderId, 'paid')
    const cookie = await signIn(ADMIN)

    for (const next of ['processing', 'shipped', 'delivered'] as const) {
      const r = await patchStatus(orderId, next, cookie)
      expect(r.status, next).toBe(200)
    }

    const history = await prisma.orderStatusHistory.findMany({
      where: { orderId }, select: { status: true, changedByUserId: true },
      orderBy: { createdAt: 'asc' },
    })
    expect(history.map((h) => h.status)).toEqual([
      'pending_payment', 'processing', 'shipped', 'delivered',
    ])
    // 🔴 Every admin move names the admin. Null is reserved for SYSTEM.
    for (const row of history.slice(1)) expect(row.changedByUserId).toBe(adminId)
  })

  it('🔴 an admin cancellation RESTORES STOCK', async () => {
    const orderId = await placeOrder('adm-cancel', 5)
    expect(await stockOf()).toBe(195)
    await setStatus(orderId, 'processing')
    const cookie = await signIn(ADMIN)

    const r = await patchStatus(orderId, 'cancelled', cookie)

    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ changed: true, restoredStock: true })
    expect(await stockOf()).toBe(200)
  })

  it('🔴 an admin may NOT mark an order paid — that is the SYSTEM\'s move', async () => {
    // §8.9 gives `pending_payment -> paid` to the system alone. Allowing it here
    // would be an administrator marking an order paid, which is not a
    // fulfilment action and has no requirement behind it.
    const orderId = await placeOrder('adm-paid', 1)
    const cookie = await signIn(ADMIN)

    const r = await patchStatus(orderId, 'paid', cookie)

    expect(r.status).toBe(403)
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe('NOT_AN_ADMIN_TRANSITION')
    const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } })
    expect(o.status).toBe('pending_payment')
  })

  it('an illegal move from the current status is 409, not 403', async () => {
    // ⚠️ The control on the 403s: the code must distinguish "not yours" from
    // "not possible". `paid -> shipped` skips fulfilment and is in nobody's row.
    const orderId = await placeOrder('adm-illegal', 1)
    await setStatus(orderId, 'paid')
    const cookie = await signIn(ADMIN)

    const r = await patchStatus(orderId, 'shipped', cookie)

    expect(r.status).toBe(409)
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe('NOT_A_TRANSITION')
  })

  it('an unknown status string is 400', async () => {
    const orderId = await placeOrder('adm-garbage', 1)
    const cookie = await signIn(ADMIN)
    const r = await patchStatus(orderId, 'IN_TRANSIT', cookie)
    expect(r.status).toBe(400)
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe('INVALID_STATUS')
  })

  it('an unknown order is 404', async () => {
    const cookie = await signIn(ADMIN)
    const r = await patchStatus('00000000-0000-0000-0000-000000000000', 'processing', cookie)
    expect(r.status).toBe(404)
  })
})

/**
 * MILESTONE-008 Checkpoint F3 — `GET /api/admin/orders`, the list the screen
 * renders.
 *
 * 🔴 UNTIL THIS ROUTE EXISTED THE SCREEN COULD NOT. `PATCH /:id/status` has
 * shipped since ISSUE-083's guard half, so an admin could change an order they
 * already knew the id of — and there was no way to learn an id.
 */
describe('GET /api/admin/orders', () => {
  function list(query: string, cookie?: string) {
    return fetch(`${baseUrl}/api/admin/orders${query}`, {
      headers: { ...(cookie ? { cookie } : {}) },
    })
  }

  it('refuses anonymous with 401 and a shopper with 403', async () => {
    expect((await list('')).status).toBe(401)
    expect((await list('', await signIn(SHOPPER))).status).toBe(403)
  })

  it('lists orders NEWEST FIRST', async () => {
    const first = await placeOrder('adm-list-1', 1)
    const second = await placeOrder('adm-list-2', 1)
    const body = (await list('', await signIn(ADMIN)).then((r) => r.json())) as {
      orders: { id: string }[]
    }
    const ids = body.orders.map((o) => o.id)
    // Compared as positions, not as a whole array: the database holds other
    // fixtures' orders too, and asserting the exact list would couple this
    // test to every other test's leftovers.
    expect(ids.indexOf(second)).toBeLessThan(ids.indexOf(first))
  })

  it('🔴 tells the screen which moves are legal, per row', async () => {
    const orderId = await placeOrder('adm-list-allowed', 1)
    await setStatus(orderId, 'paid')
    const body = (await list('', await signIn(ADMIN)).then((r) => r.json())) as {
      orders: { id: string; status: string; allowedTransitions: string[] }[]
    }
    const row = body.orders.find((o) => o.id === orderId)
    expect(row?.status).toBe('paid')
    // §8.9's table, derived — not a second copy of it in the browser.
    expect([...(row?.allowedTransitions ?? [])].sort()).toEqual(['cancelled', 'processing'])
  })

  it('🔴 a SHIPPED order offers only `delivered` — no cancel after dispatch', async () => {
    const orderId = await placeOrder('adm-list-shipped', 1)
    await setStatus(orderId, 'shipped')
    const body = (await list('', await signIn(ADMIN)).then((r) => r.json())) as {
      orders: { id: string; allowedTransitions: string[] }[]
    }
    expect(body.orders.find((o) => o.id === orderId)?.allowedTransitions).toEqual(['delivered'])
  })

  it('filters by status, and an UNKNOWN status filters nothing rather than 400', async () => {
    const orderId = await placeOrder('adm-list-filter', 1)
    await setStatus(orderId, 'processing')
    const cookie = await signIn(ADMIN)

    const filtered = (await list('?status=processing', cookie).then((r) => r.json())) as {
      orders: { status: string }[]
    }
    expect(filtered.orders.length).toBeGreaterThan(0)
    expect(filtered.orders.every((o) => o.status === 'processing')).toBe(true)

    // A bookmarked URL must not start 400-ing if a status is ever renamed.
    const unknown = await list('?status=IN_TRANSIT', cookie)
    expect(unknown.status).toBe(200)
  })

  it('carries the row fields the screen needs, and nothing about the shopper beyond the email', async () => {
    const orderId = await placeOrder('adm-list-shape', 2)
    const raw = await list('', await signIn(ADMIN)).then((r) => r.text())
    const body = JSON.parse(raw) as {
      orders: { id: string; orderNumber: string; totalAmount: string; customerEmail: string; itemCount: number }[]
    }
    const row = body.orders.find((o) => o.id === orderId)!
    expect(row.orderNumber).toMatch(/^VS-/)
    expect(row.totalAmount).toMatch(/^\d+\.\d{2}$/)
    expect(row.customerEmail).toBe(SHOPPER)
    expect(row.itemCount).toBe(1)
    // 🔴 A LIST, NOT A DETAIL VIEW. No lines, and no password hash ever.
    expect(raw).not.toContain('$argon2')
    expect(raw).not.toContain('unitPrice')
  })

  it('paginates, and zero items is ZERO pages — the catalogue convention', async () => {
    const cookie = await signIn(ADMIN)
    // `cancelled` exists as a status but no fixture here reaches it, so this
    // is a real empty result rather than a page past the end.
    const empty = (await list('?status=cancelled', cookie).then((r) => r.json())) as {
      totalItems: number
      totalPages: number
      orders: unknown[]
    }
    expect(empty.totalItems).toBe(0)
    // 🔴 Zero pages, not one empty page — §4a, frozen for the catalogue.
    expect(empty.totalPages).toBe(0)
    expect(empty.orders).toHaveLength(0)
  })

  it('a page past the end is an empty page, not an error', async () => {
    await placeOrder('adm-list-page', 1)
    const body = await list('?page=9999', await signIn(ADMIN))
    expect(body.status).toBe(200)
    expect(((await body.json()) as { orders: unknown[] }).orders).toHaveLength(0)
  })
})
