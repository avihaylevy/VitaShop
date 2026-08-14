import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import argon2 from 'argon2'
import express from 'express'
import type { Server } from 'node:http'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCheckoutRouter } from './checkout.js'
import { createAuthRouter } from './auth.js'
import { createAuthRateLimiters } from '../lib/rateLimit.js'
import { ARGON2_OPTIONS } from '../lib/registrationService.js'
import { prewarmDummyHash } from '../lib/loginService.js'
import { createSessionMiddleware } from '../lib/session.js'
import { NullEmailProvider, type EmailMessage, type EmailService } from '../lib/emailService.js'
import { TEST_FIXTURE_SLUG_PREFIX } from '../lib/testFixturePrefix.js'

/**
 * MILESTONE-008 Checkpoint D2 — the checkout ROUTES, over the wire.
 *
 * 🔴 THIS FILE CROSSES THE WIRE ON PURPOSE, and ISSUE-070 is why. Checkpoints E
 * and F of MILESTONE-007 both closed green and both did nothing in production,
 * because every test that existed called a seam directly or used a fake session
 * object. A route test that never issues an HTTP request proves the handler
 * compiles, not that it is reachable, authenticated, or limited.
 *
 * ⚠️ A FRESH APP PER TEST. The limiters are real (DEC-061), `/pay` allows ten
 * per fifteen minutes, and this file makes more than ten `/pay` calls in total.
 * Sharing one app would let an early test spend a later test's budget and
 * surface as an unexplained 429 — a failure that looks like a checkout bug and
 * is not.
 *
 * ⚠️ DEC-057 — `.integration.test.ts`, so it runs single-threaded.
 */

let prisma: PrismaClient
let server: Server
let baseUrl: string

/**
 * 🔴 CAPTURES SENDS AND CAN BE MADE TO FAIL — TEST-044c's whole mechanism.
 * INV-04 says a mail failure leaves the order intact, and the only honest way
 * to test that is to make a real send throw at the real call site.
 */
class TestMailbox implements EmailService {
  readonly sent: EmailMessage[] = []
  failNext = false
  /**
   * 🔴 EVERY call, before the outcome is decided — successes, simulated
   * outages, gated holds. Second review round: an absence assertion
   * ("no email") read `sent` at a moment the send could not have landed yet,
   * so it passed whether the guarantee held or not. `attempts` is what lets
   * a test prove "the send was TRIED and did not land" instead of "nothing
   * has happened yet".
   */
  attempts = 0
  /**
   * 🔴 A HOLD, so a test can prove the RESPONSE does not wait on the send. The
   * send blocks until the test releases it; the 201 must already have arrived.
   */
  gate: Promise<void> | undefined
  async send(message: EmailMessage): Promise<void> {
    this.attempts += 1
    if (this.failNext) {
      this.failNext = false
      throw new Error('simulated mail outage')
    }
    if (this.gate) await this.gate
    this.sent.push(message)
  }
}
/**
 * 🔴 ISSUE-094 — ONE MAILBOX PER TEST, reassigned in beforeEach BEFORE the
 * app is built. The route deliberately writes the response FIRST and sends the
 * confirmation AFTER it (INV-04 / the phantom-failure fix), so the send — a DB
 * read plus the transport call — is still in flight when `fetch` resolves. With
 * one module-level mailbox, a late tail from the PREVIOUS test could land after
 * `beforeEach` reset it; with a fresh instance, a late tail writes to an object
 * no assertion will ever read again.
 */
let mailbox = new TestMailbox()

const SLUG_A = `${TEST_FIXTURE_SLUG_PREFIX}route-checkout-a`
/** 🔴 A SECOND LINE EXISTS ONLY SO THE EMAIL'S LINE ORDER CAN BE PROVED. With
 *  one line every ordering is identical and the `orderBy` guard is untestable. */
const SLUG_B = `${TEST_FIXTURE_SLUG_PREFIX}route-checkout-b`
const EMAIL = 'zz-checkoutroute@example.test'
const PASSWORD = 'Abcdef12xyz'
const ADDRESS = { line1: 'רחוב הבדיקה 1', city: 'תל אביב', zipCode: '6100000' }

async function wipe(): Promise<void> {
  const orders = await prisma.order.findMany({
    where: { user: { email: EMAIL } },
    select: { id: true },
  })
  if (orders.length > 0) {
    const ids = orders.map((o) => o.id)
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: ids } } })
    await prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } })
    await prisma.order.deleteMany({ where: { id: { in: ids } } })
  }
  const carts = await prisma.cart.findMany({
    where: { user: { email: EMAIL } },
    select: { id: true },
  })
  if (carts.length > 0) {
    const ids = carts.map((c) => c.id)
    await prisma.cartItem.deleteMany({ where: { cartId: { in: ids } } })
    await prisma.cart.deleteMany({ where: { id: { in: ids } } })
  }
}

async function setStock(stockQuantity: number): Promise<void> {
  await prisma.product.update({ where: { slug: SLUG_A }, data: { stockQuantity } })
}

async function setPrice(price: string): Promise<void> {
  await prisma.product.update({ where: { slug: SLUG_A }, data: { price } })
}

async function stockOf(): Promise<number> {
  const p = await prisma.product.findUniqueOrThrow({
    where: { slug: SLUG_A }, select: { stockQuantity: true },
  })
  return p.stockQuantity
}

/** Puts `quantity` of the fixture in the shopper's own cart. */
async function cartWith(quantity: number): Promise<void> {
  const userId = (await prisma.user.findUniqueOrThrow({ where: { email: EMAIL }, select: { id: true } })).id
  const product = await prisma.product.findUniqueOrThrow({ where: { slug: SLUG_A }, select: { id: true } })
  const cart = await prisma.cart.upsert({
    where: { userId }, create: { userId }, update: {}, select: { id: true },
  })
  await prisma.cartItem.upsert({
    where: { cartId_productId: { cartId: cart.id, productId: product.id } },
    create: { cartId: cart.id, productId: product.id, quantity },
    update: { quantity },
    select: { id: true },
  })
}

/** Adds `quantity` of the SECOND fixture, so an order has two frozen lines. */
async function alsoCartWith(quantity: number): Promise<void> {
  const userId = (await prisma.user.findUniqueOrThrow({ where: { email: EMAIL }, select: { id: true } })).id
  const product = await prisma.product.findUniqueOrThrow({ where: { slug: SLUG_B }, select: { id: true } })
  const cart = await prisma.cart.upsert({
    where: { userId }, create: { userId }, update: {}, select: { id: true },
  })
  await prisma.cartItem.upsert({
    where: { cartId_productId: { cartId: cart.id, productId: product.id } },
    create: { cartId: cart.id, productId: product.id, quantity },
    update: { quantity },
    select: { id: true },
  })
}

/** Signs in over HTTP and returns the session cookie header. */
async function signIn(): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  expect(response.status).toBe(200)
  const set = response.headers.get('set-cookie')
  if (!set) throw new Error('login returned no session cookie')
  return set.split(';')[0] ?? ''
}

function post(path: string, body: unknown, cookie?: string) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  })
}

type Quote = { fingerprint: string; totalAmount: string; shipping: { cost: string } }

/** `/validate` for a courier order, asserted ok, returning the quote. */
async function validate(cookie: string, deliveryMethod = 'courier'): Promise<Quote> {
  const response = await post('/api/checkout/validate', { deliveryMethod }, cookie)
  expect(response.status).toBe(200)
  return (await response.json()) as Quote
}

beforeAll(async () => {
  await prewarmDummyHash()
  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  })

  const seeded = await prisma.product.findFirstOrThrow({
    where: { isActive: true }, select: { categoryId: true, brandId: true },
  })
  await prisma.product.upsert({
    where: { slug: SLUG_A },
    create: {
      slug: SLUG_A, nameHe: 'בדיקת מסלול', nameEn: 'Route test',
      categoryId: seeded.categoryId, brandId: seeded.brandId,
      dosageForm: 'CAPSULE', packageQuantity: 60, usageInstructions: 'בדיקה',
      price: '100.00', stockQuantity: 100,
      descriptionHe: 'בדיקה', descriptionEn: 'test', warningsAllergens: '',
      isActive: true,
    },
    update: { price: '100.00', stockQuantity: 100, isActive: true },
    select: { id: true },
  })

  await prisma.product.upsert({
    where: { slug: SLUG_B },
    create: {
      slug: SLUG_B, nameHe: 'בדיקה שנייה', nameEn: 'Route test B',
      categoryId: seeded.categoryId, brandId: seeded.brandId,
      dosageForm: 'CAPSULE', packageQuantity: 30, usageInstructions: 'בדיקה',
      price: '20.00', stockQuantity: 100,
      descriptionHe: 'בדיקה', descriptionEn: 'test', warningsAllergens: '',
      isActive: true,
    },
    update: { price: '20.00', stockQuantity: 100, isActive: true },
    select: { id: true },
  })

  await prisma.user.upsert({
    where: { email: EMAIL },
    create: {
      email: EMAIL, firstName: 'Route', lastName: 'Checkout',
      passwordHash: await argon2.hash(PASSWORD, ARGON2_OPTIONS),
      termsAcceptedAt: new Date(), status: 'active',
    },
    update: { status: 'active' },
    select: { id: true },
  })

  await wipe()
}, 60_000)

/**
 * 🔴 THE QUIESCENCE SIGNAL — counts completed `/pay` HANDLERS, via the
 * route's own afterPayHandled seam. `/pay` answers before its send, so a test
 * asserting an ABSENCE must first wait for the handler to be genuinely done;
 * waiting on this counter is that wait. Reset per test with the mailbox.
 */
let payHandled = 0

beforeEach(async () => {
  // ISSUE-094: a FRESH mailbox per test — see the note at TestMailbox's
  // instantiation. Must precede the app, which closes over it.
  mailbox = new TestMailbox()
  payHandled = 0
  // 🔴 THE REAL STACK, in index.ts's order — session middleware first, because
  // both routes read `req.session` and their limiters key on it.
  const app = express()
  app.use(express.json())
  app.use(createSessionMiddleware())
  app.use('/api/checkout', createCheckoutRouter({
    prisma, emailService: mailbox,
    hooks: { afterPayHandled: () => { payHandled += 1 } },
  }))
  app.use('/api', createAuthRouter({
    prisma,
    emailService: new NullEmailProvider(),
    appBaseUrl: 'http://127.0.0.1',
    rateLimiters: createAuthRateLimiters(),
  }))

  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('no ephemeral port')
  baseUrl = `http://127.0.0.1:${address.port}`

  await setStock(100)
  await setPrice('100.00')
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
    await prisma.product.deleteMany({ where: { slug: { in: [SLUG_A, SLUG_B] } } })
    await prisma.user.deleteMany({ where: { email: EMAIL } })
  } finally {
    await prisma.$disconnect()
  }
})

describe('🔴 §8.2 — checkout is AUTHENTICATED-ONLY', () => {
  it('both routes refuse an anonymous caller with 401', async () => {
    const validateResponse = await post('/api/checkout/validate', { deliveryMethod: 'courier' })
    const payResponse = await post('/api/checkout/pay', { fingerprint: 'x', deliveryMethod: 'courier' })

    expect(validateResponse.status).toBe(401)
    expect(payResponse.status).toBe(401)
    // ⚠️ The refusal says nothing about carts or orders — an anonymous caller
    // must not learn whether either exists.
    const body = (await validateResponse.json()) as { error: { code: string } }
    expect(body.error.code).toBe('AUTHENTICATION_REQUIRED')
  })
})

describe('POST /api/checkout/validate', () => {
  it('quotes the order and returns a fingerprint', async () => {
    const cookie = await signIn()
    await cartWith(1)
    const quote = await validate(cookie)

    expect(quote.totalAmount).toBe('130.00')
    expect(quote.shipping.cost).toBe('30.00')
    expect(quote.fingerprint).toMatch(/^[0-9a-f]{64}$/)
  })

  it('🔴 an empty cart is 409, not 400 — the request was fine, the cart is not', async () => {
    const cookie = await signIn()
    const response = await post('/api/checkout/validate', { deliveryMethod: 'courier' }, cookie)
    expect(response.status).toBe(409)
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('EMPTY_CART')
  })

  it('an unknown delivery method IS the client’s fault — 400', async () => {
    const cookie = await signIn()
    await cartWith(1)
    const response = await post('/api/checkout/validate', { deliveryMethod: 'COURIER ' }, cookie)
    expect(response.status).toBe(400)
  })
})

describe('🔴 TEST-042 — the final check HALTS on any change', () => {
  it('A — a PRICE change between validate and pay halts, and returns the NEW quote', async () => {
    const cookie = await signIn()
    await cartWith(1)
    const quote = await validate(cookie)

    await setPrice('111.00')

    const response = await post('/api/checkout/pay', {
      fingerprint: quote.fingerprint, deliveryMethod: 'courier', address: ADDRESS,
      idempotencyKey: 'route-price-change',
    }, cookie)

    expect(response.status).toBe(409)
    const body = (await response.json()) as { error: { code: string }; quote: Quote }
    expect(body.error.code).toBe('CHECKOUT_CHANGED')
    // 🔴 REQ-F-042 requires the UPDATED VALUES to be shown. A bare 409 leaves
    // the client to guess what moved, or to re-request and race again.
    expect(body.quote.totalAmount).toBe('141.00')
    expect(body.quote.fingerprint).not.toBe(quote.fingerprint)
    // Nothing was placed and nothing was taken.
    expect(await prisma.order.count({ where: { user: { email: EMAIL } } })).toBe(0)
    expect(await stockOf()).toBe(100)
  })

  it('B — a line that went SHORT of stock halts before payment', async () => {
    const cookie = await signIn()
    await cartWith(5)
    const quote = await validate(cookie)

    await setStock(2)

    const response = await post('/api/checkout/pay', {
      fingerprint: quote.fingerprint, deliveryMethod: 'courier', address: ADDRESS,
      idempotencyKey: 'route-short-stock',
    }, cookie)

    expect(response.status).toBe(409)
    const body = (await response.json()) as {
      error: { code: string; lines?: { why: string; available: number }[] }
    }
    // 🔴 It halts as UNPURCHASABLE_LINE, not CHECKOUT_CHANGED: the re-quote
    // refuses before a fingerprint is even computed, and the shopper needs the
    // cause and the number, not "something changed".
    expect(body.error.code).toBe('UNPURCHASABLE_LINE')
    expect(body.error.lines).toEqual([expect.objectContaining({ why: 'SHORT_STOCK', available: 2 })])
    expect(await prisma.order.count({ where: { user: { email: EMAIL } } })).toBe(0)
    expect(await stockOf()).toBe(2)
  })

  it('🔴 C — /pay WITHOUT ever calling /validate cannot bypass the check', async () => {
    // THE SCENARIO §8.4 NAMES. The guarantee is not "you must call /validate";
    // it is that /pay re-verifies independently, so skipping it buys nothing.
    const cookie = await signIn()
    await cartWith(1)

    const invented = 'f'.repeat(64)
    const response = await post('/api/checkout/pay', {
      fingerprint: invented, deliveryMethod: 'courier', address: ADDRESS,
      idempotencyKey: 'route-bypass',
    }, cookie)

    expect(response.status).toBe(409)
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('CHECKOUT_CHANGED')
    expect(await prisma.order.count({ where: { user: { email: EMAIL } } })).toBe(0)
    expect(await stockOf()).toBe(100)
  })

  it('C2 — /pay with NO fingerprint at all is refused', async () => {
    const cookie = await signIn()
    await cartWith(1)
    const response = await post('/api/checkout/pay', {
      deliveryMethod: 'courier', address: ADDRESS, idempotencyKey: 'route-nofp',
    }, cookie)
    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: { code: string } }).error.code)
      .toBe('FINGERPRINT_REQUIRED')
    expect(await prisma.order.count({ where: { user: { email: EMAIL } } })).toBe(0)
  })
})

describe('🔴 TEST-043 / TEST-045 — the SIMULATED payment, both outcomes', () => {
  it('success places the order, decrements stock and empties the cart', async () => {
    const cookie = await signIn()
    await cartWith(2)
    const quote = await validate(cookie)

    const response = await post('/api/checkout/pay', {
      fingerprint: quote.fingerprint, deliveryMethod: 'courier', address: ADDRESS,
      idempotencyKey: 'route-success', simulatedOutcome: 'success',
    }, cookie)

    expect(response.status).toBe(201)
    const body = (await response.json()) as { orderNumber: string; totalAmount: string; replayed: boolean }
    expect(body.orderNumber).toMatch(/^VS-\d{8}-[A-Z0-9]{6}$/)
    expect(body.totalAmount).toBe('230.00')
    expect(body.replayed).toBe(false)
    expect(await stockOf()).toBe(98)

    const order = await prisma.order.findFirstOrThrow({
      where: { user: { email: EMAIL } },
      select: { status: true, shippingLine1: true, items: { select: { quantity: true } } },
    })
    // ✅ `paid` — Checkpoint D3 closed this. It was pinned as `pending_payment`
    // on purpose so the missing transition could not be skipped quietly, and
    // this line changing IS D3 landing.
    expect(order.status).toBe('paid')
    expect(order.shippingLine1).toBe(ADDRESS.line1)
    expect(order.items).toEqual([{ quantity: 2 }])
  })

  it('🔴 TEST-045 — a DECLINED payment leaves no order, stock untouched, cart preserved', async () => {
    const cookie = await signIn()
    await cartWith(2)
    const quote = await validate(cookie)

    const response = await post('/api/checkout/pay', {
      fingerprint: quote.fingerprint, deliveryMethod: 'courier', address: ADDRESS,
      idempotencyKey: 'route-declined', simulatedOutcome: 'failure',
    }, cookie)

    expect(response.status).toBe(402)
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('PAYMENT_DECLINED')

    // REQ-F-045, all three clauses, from the shopper's side.
    expect(await prisma.order.count({ where: { user: { email: EMAIL } } })).toBe(0)
    expect(await stockOf()).toBe(100)
    const lines = await prisma.cartItem.findMany({
      where: { cart: { user: { email: EMAIL } } }, select: { quantity: true },
    })
    expect(lines).toEqual([{ quantity: 2 }])
  })

  it('🔴 BOTH outcomes are reachable from the same cart — the requirement is "triggerable"', async () => {
    // ⚠️ THE CONTROL. The two tests above each prove one branch; neither shows
    // the outcome is what SELECTED it. If the route ignored the field and
    // always declined, the success test would fail — but if it always
    // succeeded, "failure" would silently place an order, which is the
    // direction that costs money.
    const cookie = await signIn()
    await cartWith(1)

    const declined = await post('/api/checkout/pay', {
      fingerprint: (await validate(cookie)).fingerprint, deliveryMethod: 'courier',
      address: ADDRESS, idempotencyKey: 'route-both-1', simulatedOutcome: 'failure',
    }, cookie)
    expect(declined.status).toBe(402)
    expect(await prisma.order.count({ where: { user: { email: EMAIL } } })).toBe(0)

    // Same cart, same figures, opposite outcome.
    const accepted = await post('/api/checkout/pay', {
      fingerprint: (await validate(cookie)).fingerprint, deliveryMethod: 'courier',
      address: ADDRESS, idempotencyKey: 'route-both-2', simulatedOutcome: 'success',
    }, cookie)
    expect(accepted.status).toBe(201)
    expect(await prisma.order.count({ where: { user: { email: EMAIL } } })).toBe(1)
  })

  it('🔴 A RETRY WITH THE SAME KEY RETURNS THE SAME ORDER — INV-05, over the wire', async () => {
    // 🔴 THE DEFECT THIS PINS WAS A HIGH, AND IT WAS INVISIBLE FROM THE SERVICE.
    // `orderService` has thirty tests for the replay and every one of them calls
    // it directly. Over the wire the route re-quoted FIRST, and a successful
    // order empties the cart — so the retry hit EMPTY_CART and the shopper was
    // told "this order cannot be placed" while their order existed, with no
    // order number anywhere in the reply.
    const cookie = await signIn()
    await cartWith(2)
    const quote = await validate(cookie)

    const first = await post('/api/checkout/pay', {
      fingerprint: quote.fingerprint, deliveryMethod: 'courier', address: ADDRESS,
      idempotencyKey: 'route-retry', simulatedOutcome: 'success',
    }, cookie)
    expect(first.status).toBe(201)
    const firstBody = (await first.json()) as { orderNumber: string; totalAmount: string }

    // The same key again — a dropped response, a double submit, a flaky network.
    const retry = await post('/api/checkout/pay', {
      fingerprint: quote.fingerprint, deliveryMethod: 'courier', address: ADDRESS,
      idempotencyKey: 'route-retry', simulatedOutcome: 'success',
    }, cookie)

    expect(retry.status).toBe(200)
    const retryBody = (await retry.json()) as {
      orderNumber: string; totalAmount: string; replayed: boolean
    }
    expect(retryBody.orderNumber).toBe(firstBody.orderNumber)
    expect(retryBody.totalAmount).toBe(firstBody.totalAmount)
    expect(retryBody.replayed).toBe(true)

    // 🔴 ONE order, ONE decrement. The damage a broken retry does is a second
    // charge and a second decrement, so both are asserted rather than the
    // status code alone.
    expect(await prisma.order.count({ where: { user: { email: EMAIL } } })).toBe(1)
    expect(await stockOf()).toBe(98)
  })

  it('🔴 the retry is answered even though the cart is now EMPTY', async () => {
    // ⚠️ The precise mechanism of the bug, isolated. The cart is empty after a
    // successful order, so anything that consults the cart before the key
    // answers EMPTY_CART. The replay must not consult it.
    const cookie = await signIn()
    await cartWith(1)
    const quote = await validate(cookie)
    await post('/api/checkout/pay', {
      fingerprint: quote.fingerprint, deliveryMethod: 'courier', address: ADDRESS,
      idempotencyKey: 'route-retry-empty', simulatedOutcome: 'success',
    }, cookie)

    const lines = await prisma.cartItem.findMany({ where: { cart: { user: { email: EMAIL } } } })
    expect(lines).toEqual([]) // the precondition the bug depended on

    const retry = await post('/api/checkout/pay', {
      fingerprint: quote.fingerprint, deliveryMethod: 'courier', address: ADDRESS,
      idempotencyKey: 'route-retry-empty', simulatedOutcome: 'success',
    }, cookie)
    expect(retry.status).toBe(200)
    expect(((await retry.json()) as { replayed: boolean }).replayed).toBe(true)
  })

  it('🔴 a MISSING address is 400 and is refused BEFORE the payment is accepted', async () => {
    // Two defects in one: the status said "the world moved, re-quote" for a
    // malformed payload — sending a compliant client into a loop — and the rule
    // lived only inside `createOrder`, so it fired AFTER the simulated payment
    // had been accepted.
    const cookie = await signIn()
    await cartWith(1)
    const quote = await validate(cookie)

    const response = await post('/api/checkout/pay', {
      fingerprint: quote.fingerprint, deliveryMethod: 'courier',
      address: { line1: '   ', city: '   ' },
      idempotencyKey: 'route-no-address', simulatedOutcome: 'success',
    }, cookie)

    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: { code: string } }).error.code)
      .toBe('ADDRESS_REQUIRED')
    expect(await prisma.order.count({ where: { user: { email: EMAIL } } })).toBe(0)
    expect(await stockOf()).toBe(100)
  })

  it('🔴 the address is refused BEFORE the payment branch — proved by a DECLINED payment', async () => {
    // ⚠️ THIS TEST EXISTS BECAUSE MUTATION SHOWED THE OTHERS COULD NOT SEE IT.
    // Removing the route's address check left every address assertion GREEN:
    // `createOrder` refuses with the same reason and the same 400, so
    // "refused before payment" and "refused after payment" look identical.
    //
    // 🔴 A DECLINED payment separates them. The payment branch returns 402 and
    // never reaches `createOrder`, so:
    //     check BEFORE the payment  ->  400 ADDRESS_REQUIRED
    //     check only in createOrder ->  402 PAYMENT_DECLINED
    // The status names which one ran, and nothing else does.
    const cookie = await signIn()
    await cartWith(1)
    const quote = await validate(cookie)

    const response = await post('/api/checkout/pay', {
      fingerprint: quote.fingerprint, deliveryMethod: 'courier',
      address: { line1: '   ', city: '   ' },
      idempotencyKey: 'route-address-before-payment', simulatedOutcome: 'failure',
    }, cookie)

    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: { code: string } }).error.code)
      .toBe('ADDRESS_REQUIRED')
  })

  it('🔴 SELF PICKUP carrying an address is 400, not 409', async () => {
    const cookie = await signIn()
    await cartWith(1)
    const quote = await validate(cookie, 'self_pickup')

    const response = await post('/api/checkout/pay', {
      fingerprint: quote.fingerprint, deliveryMethod: 'self_pickup', address: ADDRESS,
      idempotencyKey: 'route-pickup-address', simulatedOutcome: 'success',
    }, cookie)

    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: { code: string } }).error.code)
      .toBe('ADDRESS_NOT_ALLOWED')
    expect(await prisma.order.count({ where: { user: { email: EMAIL } } })).toBe(0)
  })

  it('🔴 an UNRECOGNISED simulatedOutcome is refused — it must not fail open', async () => {
    // The first version declined only on the exact string 'failure', so
    // 'Failure', 'fail' or 'declined' placed a REAL order and decremented stock
    // while the shopper was asking for a decline. A rejected request costs a
    // round trip; an unwanted order costs stock.
    const cookie = await signIn()
    await cartWith(1)

    for (const outcome of ['Failure', 'fail', 'declined', 'DECLINE']) {
      const quote = await validate(cookie)
      const response = await post('/api/checkout/pay', {
        fingerprint: quote.fingerprint, deliveryMethod: 'courier', address: ADDRESS,
        idempotencyKey: `route-outcome-${outcome}`, simulatedOutcome: outcome,
      }, cookie)
      expect(response.status, outcome).toBe(400)
      expect(((await response.json()) as { error: { code: string } }).error.code)
        .toBe('INVALID_PAYMENT_OUTCOME')
    }

    expect(await prisma.order.count({ where: { user: { email: EMAIL } } })).toBe(0)
    expect(await stockOf()).toBe(100)
  })

  it('🔴 CONCURRENT double-submit: ONE order, and the replay is never reported as 201', async () => {
    // 🔴 THE STATUS IS THE SUBJECT, not the order count. Two `/pay` calls with
    // one key race: both pass step 0 (neither has committed), both re-quote,
    // both call `createOrder`. The loser blocks on the cart lock, then replays
    // at `orderService`'s own layer-one lookup and returns `replayed: true` —
    // and the route used to fall through to 201, telling a client (or a
    // conversion counter) that a SECOND order had been created.
    const cookie = await signIn()
    await cartWith(2)
    const quote = await validate(cookie)
    const payload = {
      fingerprint: quote.fingerprint, deliveryMethod: 'courier', address: ADDRESS,
      idempotencyKey: 'route-concurrent', simulatedOutcome: 'success',
    }

    const [a, b] = await Promise.all([
      post('/api/checkout/pay', payload, cookie),
      post('/api/checkout/pay', payload, cookie),
    ])
    const bodies = (await Promise.all([a.json(), b.json()])) as { replayed: boolean }[]

    // 🔴 EXACTLY ONE CREATION, however the two interleave.
    expect([a.status, b.status].filter((s) => s === 201)).toHaveLength(1)
    expect(bodies.filter((x) => x.replayed === false)).toHaveLength(1)

    // 🔴 AND THE INVARIANT THE STATUS DESCRIBES: `replayed` and the status code
    // must agree, whichever layer answered.
    //
    // ⚠️ MEASURED AND REPORTED HONESTLY: this assertion does NOT currently
    // redden the `res.status(201)` mutation. Over three runs the loser was
    // always answered at step 0 — it found the committed order before it
    // reached `createOrder` — so the route's `order.replayed` branch is never
    // taken here. The branch is defensive rather than demonstrated: it is right,
    // it costs nothing, and this assertion will catch it the day the
    // interleaving does land there. 🔴 Do not read the green tick as proof of
    // that branch.
    for (const [response, body] of [[a, bodies[0]!] as const, [b, bodies[1]!] as const]) {
      expect(response.status, JSON.stringify(body)).toBe(body.replayed ? 200 : 201)
    }

    expect(await prisma.order.count({ where: { user: { email: EMAIL } } })).toBe(1)
    expect(await stockOf()).toBe(98)
  })

  it('🔴 a retry AFTER THE ORDER WAS CANCELLED does not render a confirmation', async () => {
    // 🔴 A STATE CHECKPOINT E3 MADE REACHABLE. Before a shopper could cancel,
    // an order found by its key was always live. Now: pay with key K, cancel,
    // then the client retries /pay with K — a double submit, an offline retry, a
    // back button. The order is found, and the ordinary replay payload would
    // present an order that is CANCELLED, whose stock has already gone back, as
    // an order confirmation. The response carried no status, so nothing in it
    // let the client tell.
    const cookie = await signIn()
    await cartWith(2)
    const quote = await validate(cookie)
    const payload = {
      fingerprint: quote.fingerprint, deliveryMethod: 'courier', address: ADDRESS,
      idempotencyKey: 'route-cancelled-replay', simulatedOutcome: 'success',
    }
    const placed = await post('/api/checkout/pay', payload, cookie)
    expect(placed.status).toBe(201)
    const order = await prisma.order.findFirstOrThrow({
      where: { user: { email: EMAIL } }, select: { id: true },
    })

    // The shopper cancels it — the stock goes back.
    await prisma.order.update({ where: { id: order.id }, data: { status: 'cancelled' } })

    const retry = await post('/api/checkout/pay', payload, cookie)

    expect(retry.status).toBe(409)
    const body = (await retry.json()) as { error: { code: string } }
    expect(body.error.code).toBe('ORDER_CANCELLED')
  })

  it('a LIVE replay reports its status, so a client can tell the two apart', async () => {
    // ⚠️ THE CONTROL on the test above: refusing every replay would satisfy it
    // and break the ordinary retry, which is the case the replay exists for.
    const cookie = await signIn()
    await cartWith(1)
    const quote = await validate(cookie)
    const payload = {
      fingerprint: quote.fingerprint, deliveryMethod: 'courier', address: ADDRESS,
      idempotencyKey: 'route-live-replay', simulatedOutcome: 'success',
    }
    await post('/api/checkout/pay', payload, cookie)

    const retry = await post('/api/checkout/pay', payload, cookie)

    expect(retry.status).toBe(200)
    expect(await retry.json()).toMatchObject({ replayed: true, status: 'paid' })
  })

  it('🔴 the replay carries the delivery ESTIMATE, from the order’s frozen method', async () => {
    // It was omitted, so a shopper whose first response was dropped retried,
    // got 200, and the confirmation screen rendered the delivery promise from
    // `undefined`. The replay never re-quotes — the cart is empty by then — so
    // the estimate has to come from what the ORDER recorded.
    const cookie = await signIn()
    await cartWith(1)
    const quote = await validate(cookie, 'self_pickup')
    await post('/api/checkout/pay', {
      fingerprint: quote.fingerprint, deliveryMethod: 'self_pickup', address: null,
      idempotencyKey: 'route-replay-estimate', simulatedOutcome: 'success',
    }, cookie)

    const retry = await post('/api/checkout/pay', {
      fingerprint: quote.fingerprint, deliveryMethod: 'self_pickup', address: null,
      idempotencyKey: 'route-replay-estimate', simulatedOutcome: 'success',
    }, cookie)

    expect(retry.status).toBe(200)
    const body = (await retry.json()) as { estimate: unknown; replayed: boolean }
    expect(body.replayed).toBe(true)
    // 🔴 SELF PICKUP's estimate, not the courier default — proving it came from
    // the order's frozen method rather than from a guess.
    expect(body.estimate).toEqual({ kind: 'ready_within', businessDays: 2 })
  })

  it('🔴 a BLANK idempotency key is refused BEFORE the payment', async () => {
    // Same defect as the address, same handler: it was checked only inside
    // `createOrder`, below the payment branch, so a browser with no
    // `crypto.randomUUID` was told the payment succeeded and then that the
    // order could not be placed.
    //
    // 🔴 Proved the same way — a DECLINED payment. The 402 branch returns before
    // `createOrder`, so only a check that runs BEFORE it can produce a 400.
    const cookie = await signIn()
    await cartWith(1)
    const quote = await validate(cookie)

    const response = await post('/api/checkout/pay', {
      fingerprint: quote.fingerprint, deliveryMethod: 'courier', address: ADDRESS,
      idempotencyKey: '   ', simulatedOutcome: 'failure',
    }, cookie)

    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: { code: string } }).error.code)
      .toBe('INVALID_IDEMPOTENCY_KEY')
    expect(await prisma.order.count({ where: { user: { email: EMAIL } } })).toBe(0)
  })

  it('a halt at the RE-QUOTE names the offending row', async () => {
    // ⚠️ RENAMED AFTER MUTATION CAUGHT IT. This was written as "a halt from
    // INSIDE the transaction still carries a QUOTE and LINE IDS" — and it never
    // reached that path. `setStock` runs BEFORE the request, so the route's
    // step-1 re-quote already sees the shortfall and halts there; `createOrder`
    // is never called. Passing the transaction's halt straight through (the
    // defect the rename exposed) left this test green.
    //
    // 🔴 THE TRANSACTION'S OWN HALT IS NOT REACHABLE OVER HTTP — it needs a
    // change landing between the route's lock-free re-quote and the
    // transaction's locks, and the route exposes no seam to stand in. It is
    // covered directly instead: see `haltWithCurrentState` in
    // `checkoutHalt.test.ts`, which is the code that shapes that response.
    //
    // What this test still proves, and it is worth keeping: the step-1 halt
    // names the row, so a client can point at it (ISSUE-080).
    const cookie = await signIn()
    await cartWith(5)
    const quote = await validate(cookie)
    await setStock(1)

    const response = await post('/api/checkout/pay', {
      fingerprint: quote.fingerprint, deliveryMethod: 'courier', address: ADDRESS,
      idempotencyKey: 'route-halt-shape', simulatedOutcome: 'success',
    }, cookie)

    expect(response.status).toBe(409)
    const body = (await response.json()) as {
      error: { code: string; lines?: { lineId: string; why: string }[] }
    }
    expect(body.error.code).toBe('UNPURCHASABLE_LINE')
    expect(body.error.lines?.length).toBeGreaterThan(0)
    for (const line of body.error.lines ?? []) {
      expect(typeof line.lineId).toBe('string')
      expect(line.lineId.length).toBeGreaterThan(0)
    }
    expect(await prisma.order.count({ where: { user: { email: EMAIL } } })).toBe(0)
  })

  it('🔴 §8.9 — the paid transition is recorded with a NULL actor, once', async () => {
    // Null is not "unknown" here: the schema note and §8.9's table both say a
    // SYSTEM transition has no human actor, and the simulated payment is one.
    // Writing the shopper's id would claim they performed an action they did not.
    const cookie = await signIn()
    await cartWith(1)
    const quote = await validate(cookie)
    await post('/api/checkout/pay', {
      fingerprint: quote.fingerprint, deliveryMethod: 'courier', address: ADDRESS,
      idempotencyKey: 'route-paid-history', simulatedOutcome: 'success',
    }, cookie)

    const order = await prisma.order.findFirstOrThrow({
      where: { user: { email: EMAIL } },
      select: { id: true, status: true },
    })
    expect(order.status).toBe('paid')

    const history = await prisma.orderStatusHistory.findMany({
      where: { orderId: order.id },
      select: { status: true, changedByUserId: true },
      orderBy: { createdAt: 'asc' },
    })
    // 🔴 APPEND-ONLY (DEC-050): the creation row AND the payment row, in order.
    expect(history.map((h) => h.status)).toEqual(['pending_payment', 'paid'])
    // The shopper placed it; the SYSTEM paid it.
    expect(history[0]?.changedByUserId).not.toBeNull()
    expect(history[1]?.changedByUserId).toBeNull()
  })

  it('a RETRY leaves exactly one paid row', async () => {
    // ⚠️ RENAMED AFTER MUTATION. This was called "the log is an audit trail" and
    // credited `markOrderPaid`'s status guard — and it does NOT exercise that
    // guard: the retry is answered at step 0 and never reaches the transition at
    // all. Dropping the guard from the WHERE left this test green.
    //
    // The guard is proved directly in `orderTransitionService.integration.test.ts`
    // ("markOrderPaid is IDEMPOTENT" moved there with the code when Checkpoint E2
    // replaced `lib/orderPaid.ts` with `applyTransition`). What THIS test proves is
    // worth keeping: a retried checkout does not produce a second paid row by
    // any route.
    const cookie = await signIn()
    await cartWith(1)
    const quote = await validate(cookie)
    const payload = {
      fingerprint: quote.fingerprint, deliveryMethod: 'courier', address: ADDRESS,
      idempotencyKey: 'route-paid-once', simulatedOutcome: 'success',
    }
    await post('/api/checkout/pay', payload, cookie)
    await post('/api/checkout/pay', payload, cookie)

    const order = await prisma.order.findFirstOrThrow({
      where: { user: { email: EMAIL } }, select: { id: true },
    })
    const paidRows = await prisma.orderStatusHistory.count({
      where: { orderId: order.id, status: 'paid' },
    })
    expect(paidRows).toBe(1)
  })

  it('🔴 INV-04 — the confirmation email is sent AFTER the commit, in Hebrew', async () => {
    const cookie = await signIn()
    await cartWith(2)
    const quote = await validate(cookie)
    const response = await post('/api/checkout/pay', {
      fingerprint: quote.fingerprint, deliveryMethod: 'courier', address: ADDRESS,
      idempotencyKey: 'route-email', simulatedOutcome: 'success',
    }, cookie)
    const body = (await response.json()) as { orderNumber: string }

    // 🔴 ISSUE-094 — WAITED FOR, not read immediately. The response
    // deliberately arrives BEFORE the send (INV-04), so at this point the
    // confirmation is normally still in flight; an immediate read is the race
    // that made this file flaky. A condition wait is not a sleep: it settles
    // the moment the send lands and fails loudly if it never does.
    await vi.waitFor(() => expect(mailbox.sent).toHaveLength(1), { timeout: 5_000 })
    const mail = mailbox.sent[0]!
    expect(mail.to).toBe(EMAIL)
    // 🔴 HEBREW ONLY — DEC-054 / A11-SERVER. There is no i18next on the server.
    expect(mail.subject).toContain('הזמנה')
    expect(mail.subject).toContain(body.orderNumber)
    expect(mail.body).toContain(body.orderNumber)
    // The delivery promise comes from `deliveryEstimate`'s VALUE, rendered here.
    expect(mail.body).toContain('3–5 ימי עסקים')

    // 🔴 A SUMMARY, NOT JUST A TOTAL. The first version listed the order number
    // and the total alone, which gives the shopper a number and nothing to
    // check it against. The line is INV-02's FROZEN name and unit price.
    expect(mail.body).toContain('בדיקת מסלול — 2 × 100.00 ₪')
    expect(mail.body).toContain('דמי משלוח: 30.00 ₪')
    expect(mail.body).toContain('סכום לתשלום: 230.00 ₪')
  })

  it('🔴 the email survives the PAID TRANSITION throwing — still 201, order intact', async () => {
    // ⚠️ `markOrderPaid` returning `{ok:false}` was handled; THROWING was not.
    // It can throw — a connection reset, a P2028 timeout, a deadlock — and by
    // then the order is committed, the stock decremented and the cart emptied,
    // so an exception produced a 500 for an order that exists. That is the same
    // lie the unreachable replay told, reached a third way.
    const cookie = await signIn()
    await cartWith(1)
    const quote = await validate(cookie)

    // A fresh app whose transition always throws.
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()))
    })
    const app = express()
    app.use(express.json())
    app.use(createSessionMiddleware())
    app.use('/api/checkout', createCheckoutRouter({
      prisma,
      emailService: mailbox,
      markPaid: async () => { throw new Error('simulated database blip') },
    }))
    app.use('/api', createAuthRouter({
      prisma, emailService: new NullEmailProvider(),
      appBaseUrl: 'http://127.0.0.1', rateLimiters: createAuthRateLimiters(),
    }))
    await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()) })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('no ephemeral port')
    baseUrl = `http://127.0.0.1:${address.port}`
    const cookie2 = await signIn()

    const response = await post('/api/checkout/pay', {
      fingerprint: quote.fingerprint, deliveryMethod: 'courier', address: ADDRESS,
      idempotencyKey: 'route-paid-throws', simulatedOutcome: 'success',
    }, cookie2)

    // 🔴 The shopper is told the truth: the order was placed.
    expect(response.status).toBe(201)
    expect(await prisma.order.count({ where: { user: { email: EMAIL } } })).toBe(1)
    expect(await stockOf()).toBe(99)
    // The status lags — a support problem, not a lost order. And the email
    // still went, because the order is real.
    const order = await prisma.order.findFirstOrThrow({
      where: { user: { email: EMAIL } }, select: { status: true },
    })
    expect(order.status).toBe('pending_payment')
    // ISSUE-094: the send trails the response — wait for it, never read it raw.
    await vi.waitFor(() => expect(mailbox.sent).toHaveLength(1), { timeout: 5_000 })
  })

  it('🔴 a RETRY REPAIRS an order left at pending_payment', async () => {
    // The order and the transition are two transactions, so a connection drop
    // between them leaves an order committed and unpayable-forward: §8.9 allows
    // only `paid` or `cancelled` from `pending_payment`, so not even an admin
    // could push it to `processing`. The retry used to return before the
    // transition and leave it stuck.
    const cookie = await signIn()
    await cartWith(1)
    const quote = await validate(cookie)
    await post('/api/checkout/pay', {
      fingerprint: quote.fingerprint, deliveryMethod: 'courier', address: ADDRESS,
      idempotencyKey: 'route-repair', simulatedOutcome: 'success',
    }, cookie)

    // Simulate the drop: the order exists, the transition never ran.
    const placed = await prisma.order.findFirstOrThrow({
      where: { user: { email: EMAIL } }, select: { id: true },
    })
    await prisma.order.update({ where: { id: placed.id }, data: { status: 'pending_payment' } })
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: placed.id, status: 'paid' } })

    const retry = await post('/api/checkout/pay', {
      fingerprint: quote.fingerprint, deliveryMethod: 'courier', address: ADDRESS,
      idempotencyKey: 'route-repair', simulatedOutcome: 'success',
    }, cookie)

    expect(retry.status).toBe(200)
    const repaired = await prisma.order.findUniqueOrThrow({
      where: { id: placed.id }, select: { status: true },
    })
    expect(repaired.status).toBe('paid')
    expect(
      await prisma.orderStatusHistory.count({ where: { orderId: placed.id, status: 'paid' } }),
    ).toBe(1)
  })

  it('a RETRY sends NO second confirmation email', async () => {
    // ⚠️ WHAT THIS DOES AND DOES NOT PROVE. It proves the end-to-end promise:
    // one order, one confirmation. It does NOT exercise the `order.replayed`
    // guard added for the duplicate-email finding — the sequential retry is
    // answered at step 0, which never sends, so removing that guard leaves this
    // test green. Measured, not assumed.
    //
    // 🔴 That guard is on the SAME unreachable branch as `res.status(order
    // .replayed ? 200 : 201)`: both need `createOrder` itself to answer a
    // replay, which requires the concurrent loser to pass step 0 before the
    // winner commits — and it never does here. Both are defensive rather than
    // demonstrated. Do not read this green tick as proof of either.
    const cookie = await signIn()
    await cartWith(1)
    const quote = await validate(cookie)
    const payload = {
      fingerprint: quote.fingerprint, deliveryMethod: 'courier', address: ADDRESS,
      idempotencyKey: 'route-no-second-mail', simulatedOutcome: 'success',
    }
    await post('/api/checkout/pay', payload, cookie)
    // ISSUE-094: wait for the FIRST confirmation to land before the retry, or
    // this test races the send it is counting.
    await vi.waitFor(() => expect(mailbox.sent).toHaveLength(1), { timeout: 5_000 })

    await post('/api/checkout/pay', payload, cookie)
    // 🔴 SECOND REVIEW ROUND: the immediate read here assumed the very
    // property under test (a regressed replay path that DID send would push
    // after the response and still read 1). Waiting for the retry's handler
    // to be fully done makes a duplicate attempt visible: a replay that
    // sends is awaited by the handler, so it lands before payHandled hits 2.
    await vi.waitFor(() => expect(payHandled).toBe(2), { timeout: 5_000 })
    expect(mailbox.attempts).toBe(1)
    expect(mailbox.sent).toHaveLength(1)
  })

  it('🔴 SELF PICKUP gets the collection sentence, not the delivery one', async () => {
    // The two promises are different sentences, which is why the estimate has
    // two shapes. A single range would have printed "0–2 ימי עסקים".
    const cookie = await signIn()
    await cartWith(1)
    const quote = await validate(cookie, 'self_pickup')
    await post('/api/checkout/pay', {
      fingerprint: quote.fingerprint, deliveryMethod: 'self_pickup', address: null,
      idempotencyKey: 'route-email-pickup', simulatedOutcome: 'success',
    }, cookie)

    // ISSUE-094: the send trails the response — wait for it to land first.
    await vi.waitFor(() => expect(mailbox.sent).toHaveLength(1), { timeout: 5_000 })
    expect(mailbox.sent[0]!.body).toContain('מוכנה לאיסוף עצמי תוך 2 ימי עסקים')
  })

  it('🔴 TEST-044c — the email FAILS and the order SURVIVES', async () => {
    // INV-04's whole point. The send is outside every transaction and after the
    // commit, so a mail outage cannot undo an order, a stock decrement or a
    // status. Rethrowing here would turn a mail outage into a failed checkout
    // for an order that is already placed and paid.
    const cookie = await signIn()
    await cartWith(2)
    const quote = await validate(cookie)
    mailbox.failNext = true

    const response = await post('/api/checkout/pay', {
      fingerprint: quote.fingerprint, deliveryMethod: 'courier', address: ADDRESS,
      idempotencyKey: 'route-mail-fails', simulatedOutcome: 'success',
    }, cookie)

    // 🔴 The shopper is told the truth: the order was placed.
    expect(response.status).toBe(201)
    // 🔴 SECOND REVIEW ROUND: `sent 0` read immediately was VACUOUS — the
    // successful push would land after it anyway, so deleting the failNext
    // throw left this green. Now: wait for the handler (send included) to be
    // DONE, then prove the send was ATTEMPTED and did not land. Deleting the
    // throw turns `sent` into 1 here and goes red.
    await vi.waitFor(() => expect(payHandled).toBe(1), { timeout: 5_000 })
    expect(mailbox.attempts).toBe(1)
    expect(mailbox.sent).toHaveLength(0)

    const order = await prisma.order.findFirstOrThrow({
      where: { user: { email: EMAIL } }, select: { status: true },
    })
    expect(order.status).toBe('paid')
    expect(await stockOf()).toBe(98)
    // And the cart is still empty — the order transaction is untouched by this.
    const lines = await prisma.cartItem.findMany({ where: { cart: { user: { email: EMAIL } } } })
    expect(lines).toEqual([])
  })

  it('🔴 the RESPONSE does not wait on the email — a hung transport cannot fail a checkout', async () => {
    // 🔴 THE LAST PATH THAT COULD STILL PRODUCE A PHANTOM FAILURE. The send used
    // to sit BETWEEN the committed order and the response, so with a real SMTP
    // transport a hung socket stalled POST /pay past the browser's timeout — and
    // the shopper saw a failed checkout for an order that was committed, paid
    // and had already emptied their cart.
    //
    // The gate holds the send open. If the response waited on it, this `await`
    // would never resolve and the test would time out rather than fail.
    const cookie = await signIn()
    await cartWith(1)
    const quote = await validate(cookie)

    let release!: () => void
    mailbox.gate = new Promise<void>((resolve) => { release = resolve })

    const response = await post('/api/checkout/pay', {
      fingerprint: quote.fingerprint, deliveryMethod: 'courier', address: ADDRESS,
      idempotencyKey: 'route-mail-slow', simulatedOutcome: 'success',
    }, cookie)

    // 🔴 The 201 arrived while the send is STILL BLOCKED — and "still
    // blocked" is PROVEN, not assumed. SECOND REVIEW ROUND: the bare `sent 0`
    // was vacuous (an ungated push would land after the response and read 0
    // just the same). Waiting for the ATTEMPT first pins the order of events:
    // the send has started, the response is already here, and nothing has
    // landed. Without the gate, the push is synchronous with the attempt, so
    // observing attempts=1 with sent=0 is impossible and this goes red.
    expect(response.status).toBe(201)
    await vi.waitFor(() => expect(mailbox.attempts).toBe(1), { timeout: 5_000 })
    expect(mailbox.sent).toHaveLength(0)

    release()
    // Drain: the released send lands and the handler closes, so nothing from
    // this test is still in flight when the next one starts.
    await vi.waitFor(() => expect(mailbox.sent).toHaveLength(1), { timeout: 5_000 })
    await vi.waitFor(() => expect(payHandled).toBe(1), { timeout: 5_000 })
  })

  it('🔴 the email lists its lines in a STABLE order', async () => {
    // Postgres returns rows in whatever order it likes without an `orderBy`, so
    // the same order could list its lines differently on two reads. This email
    // exists to be CHECKED against a screen, and a summary whose lines move is
    // one a shopper cannot check.
    //
    // ⚠️ TWO LINES ARE REQUIRED FOR THIS TO MEAN ANYTHING — with one, every
    // ordering is identical. That is why the second fixture exists.
    //
    // 🔴 MEASURED, AND THE GUARD IS STILL NOT DEMONSTRATED: removing the
    // `orderBy` leaves this test GREEN. The order transaction inserts its items
    // in ascending productId, so the heap order already matches and a sequential
    // scan returns them in the order the guard asks for. What the `orderBy`
    // protects against is the day that stops being true — an UPDATE moving a row
    // to the end of the heap, a vacuum, a different plan — none of which this
    // fixture can produce. Correct and cheap; do not read this tick as proof.
    const cookie = await signIn()
    await cartWith(1)
    await alsoCartWith(3)
    const quote = await validate(cookie)
    await post('/api/checkout/pay', {
      fingerprint: quote.fingerprint, deliveryMethod: 'courier', address: ADDRESS,
      idempotencyKey: 'route-line-order', simulatedOutcome: 'success',
    }, cookie)

    // ISSUE-094: the send trails the response — wait for it to land first.
    await vi.waitFor(() => expect(mailbox.sent).toHaveLength(1), { timeout: 5_000 })
    const body = mailbox.sent[0]!.body

    // The order the transaction writes them in: ascending productId.
    const order = await prisma.order.findFirstOrThrow({
      where: { user: { email: EMAIL } },
      select: { items: { orderBy: { productId: 'asc' }, select: { productNameHeAtPurchase: true } } },
    })
    const expected = order.items.map((item) => item.productNameHeAtPurchase)
    expect(expected).toHaveLength(2)

    const positions = expected.map((name) => body.indexOf(name))
    expect(positions.every((p) => p >= 0)).toBe(true)
    // 🔴 STRICTLY ASCENDING — the email's lines follow the same order.
    expect(positions[1]!).toBeGreaterThan(positions[0]!)
  })

  it('🔴 TEST-043 — no card data is stored anywhere on the order', async () => {
    // The route reads no card field and the schema has none. This asserts the
    // absence rather than trusting it: a future "convenience" field would fail
    // here rather than at a code review that might not happen.
    const cookie = await signIn()
    await cartWith(1)
    const quote = await validate(cookie)

    await post('/api/checkout/pay', {
      fingerprint: quote.fingerprint, deliveryMethod: 'courier', address: ADDRESS,
      idempotencyKey: 'route-nocard', simulatedOutcome: 'success',
      // Sent deliberately, and it must be ignored rather than persisted.
      cardNumber: '4111111111111111', cvv: '123',
    }, cookie)

    const order = await prisma.order.findFirstOrThrow({ where: { user: { email: EMAIL } } })

    // 🔴 STRUCTURAL, NOT A STRING SEARCH FOR ONE NUMBER. A first version
    // asserted the serialised row did not contain '4111' or '123456' — which is
    // true of every row this schema can produce, so it could never fail and
    // proved nothing. This asserts the shape instead: no COLUMN on an order may
    // be named for a payment instrument.
    const forbidden = /card|cvv|cvc|\bpan\b|expiry/i
    expect(Object.keys(order).filter((key) => forbidden.test(key))).toEqual([])

    // And the value that was sent is nowhere in the row.
    expect(JSON.stringify(order)).not.toContain('4111111111111111')

    // ⚠️ HONEST ABOUT ITS LIMIT: this guards the ORDER row, which is where such
    // a field would most plausibly be added. It does not and cannot prove
    // nothing was written to a log — REQ-F-043's no-logging clause is enforced
    // by the route reading no card field at all, which is visible in
    // `checkout.ts` and not observable from here.
  })
})
