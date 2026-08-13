import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import argon2 from 'argon2'
import express from 'express'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cartRouter } from './cart.js'
import { createAuthRouter } from './auth.js'
import type { EmailMessage, EmailService } from '../lib/emailService.js'
import { createAuthRateLimiters } from '../lib/rateLimit.js'
import { ARGON2_OPTIONS } from '../lib/registrationService.js'
import { prewarmDummyHash } from '../lib/loginService.js'
import { createSessionMiddleware } from '../lib/session.js'

/**
 * 🔴 ISSUE-070 — THE END-TO-END JOURNEY. MILESTONE-007 Checkpoint H.
 *
 * This is the test the milestone owed from the beginning, and the one that
 * would have caught `ad0c737` on day one.
 *
 * Checkpoints E and F both closed green and both did NOTHING in production:
 * `auth.ts` handed the seam `req.sessionID` while carts are keyed on
 * `guestCartId`, a different UUID. Registration promoted nothing and login
 * merged nothing, silently, for every real shopper.
 *
 * ⚠️ EVERY TEST THAT EXISTED THEN PASSED, and each was passing honestly about
 * the wrong thing:
 *
 *   promoteGuestCart.integration    calls the SEAM directly, supplying the id
 *   auth.login / auth.register      FAKE session objects, so no real cookie
 *                                   and no real guest cart ever existed
 *   cartIdentityWiring              real cookie jar, but still calls
 *                                   `promoteGuestCart` directly — it proves
 *                                   the two ids DIFFER, not that the ROUTE
 *                                   passes the right one
 *
 * 🔴 SO THIS FILE TOUCHES NEITHER SEAM. It drives `POST /api/cart/items`,
 * then `POST /api/auth/register` or `POST /api/auth/login`, over ONE cookie
 * jar, through the REAL session middleware — and then asks the DATABASE
 * whether the account's cart holds what the guest put in it. Nothing in the
 * test supplies an identifier to anything.
 *
 * ⚠️ IT IS NOT A UI ASSERTION, deliberately. Under `ad0c737`'s defect a
 * rendered cart page showed an empty cart — indistinguishable from a shopper
 * who added nothing. Only crossing the wire and reading the account's rows
 * can tell those apart.
 */

let prisma: PrismaClient
let server: Server
let baseUrl: string

const REGISTER_EMAIL = 'zz-journey-register@example.test'
const LOGIN_EMAIL = 'zz-journey-login@example.test'
const PASSWORD = 'Abcdef12xyz'
const SLUG = 'altman-probiotic-intense-30'
/** TEST-020 says TWO products. A single line would not exercise the loop. */
const SLUG_B = 'naturalis-magnesium-citrate-120'

/**
 * Captures what was mailed, so the REGISTRATION journey can complete email
 * verification the way a shopper does — by following the link. Clause A4
 * stores a SHA-256 digest, so the plaintext token exists nowhere else: the
 * database cannot supply it and the test must not invent one.
 */
class CapturingEmailProvider implements EmailService {
  readonly sent: EmailMessage[] = []
  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message)
  }
}

const mailbox = new CapturingEmailProvider()

/** 🔴 Scoped to what THIS file created — ISSUE-071's parallel-worker lesson. */
const createdCartSessionIds = new Set<string>()

async function wipe() {
  const ids = [...createdCartSessionIds]
  if (ids.length > 0) {
    const carts = await prisma.cart.findMany({
      where: { sessionId: { in: ids } },
      select: { id: true },
    })
    const cartIds = carts.map((c) => c.id)
    if (cartIds.length > 0) {
      await prisma.cartItem.deleteMany({ where: { cartId: { in: cartIds } } })
      await prisma.cart.deleteMany({ where: { id: { in: cartIds } } })
    }
    createdCartSessionIds.clear()
  }

  // 🔴 Any GUEST cart holding this file's products, not only the ids it managed
  // to record. A failed run used to leak carts, and the next run's
  // `findFirst(orderBy: id desc)` then picked a leftover — that is what turned
  // one flake into two. Safe to scope this broadly only because DEC-057 runs
  // integration files ONE AT A TIME; under the old parallel pool this would
  // have deleted a sibling suite's carts, which is ISSUE-071 incident 5.
  const strays = await prisma.cart.findMany({
    where: { userId: null, items: { some: { product: { slug: { in: [SLUG, SLUG_B] } } } } },
    select: { id: true },
  })
  if (strays.length > 0) {
    const strayIds = strays.map((c) => c.id)
    await prisma.cartItem.deleteMany({ where: { cartId: { in: strayIds } } })
    await prisma.cart.deleteMany({ where: { id: { in: strayIds } } })
  }

  const emails = [REGISTER_EMAIL, LOGIN_EMAIL]
  const owned = await prisma.cart.findMany({
    where: { user: { email: { in: emails } } },
    select: { id: true },
  })
  if (owned.length > 0) {
    const cartIds = owned.map((c) => c.id)
    await prisma.cartItem.deleteMany({ where: { cartId: { in: cartIds } } })
    await prisma.cart.deleteMany({ where: { id: { in: cartIds } } })
  }
  await prisma.emailVerificationToken.deleteMany({ where: { user: { email: { in: emails } } } })
  await prisma.user.deleteMany({ where: { email: { in: emails } } })
}

beforeAll(async () => {
  await prewarmDummyHash()

  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  })

  // 🔴 THE REAL STACK, in the real order index.ts mounts it. A fake session
  // here would reproduce exactly the blind spot that let E and F ship inert.
  const app = express()
  app.use(express.json())
  app.use(createSessionMiddleware())
  app.use('/api/cart', cartRouter)
  app.use(
    '/api',
    createAuthRouter({
      prisma,
      emailService: mailbox,
      appBaseUrl: 'http://127.0.0.1',
      // Fresh limiters, so this file cannot exhaust another suite's budget
      // or be throttled by one.
      rateLimiters: createAuthRateLimiters(),
    }),
  )

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('no ephemeral port')
  baseUrl = `http://127.0.0.1:${address.port}`

  await wipe()
}, 60_000)

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()))
  })
  await wipe()
  await prisma.$disconnect()
})

/** A minimal cookie jar. The cookie surviving the journey IS the subject. */
function jar() {
  let cookie = ''
  return {
    get header() {
      return cookie
    },
    capture(response: Response) {
      const set = response.headers.get('set-cookie')
      if (set) cookie = set.split(';')[0] ?? cookie
    },
  }
}

/**
 * 🔴 Reads the cart back until it holds `expected` lines, or gives up loudly.
 *
 * ⚠️ THE SESSION-STORE WRITE TRAILS THE RESPONSE. `connect-pg-simple` persists
 * `req.session` asynchronously, so a second request issued immediately after
 * the first can arrive before `guestCartId` is durable — `ensureGuestCartId`
 * then mints a NEW one and the second line lands in a DIFFERENT cart. The
 * journey afterwards promotes only one of them and the assertion fails naming
 * the wrong product, which is exactly how this surfaced (1 red in 12).
 *
 * This is the same trailing-write already recorded as ISSUE-071 incident 6 and
 * handled the same way in `cartIdentityWiring`. 🔴 Serialising files does NOT
 * fix it: it is a write-timing race INSIDE one request sequence, not between
 * workers. Waiting for the observable precondition is the honest fix — the
 * claim under test is the journey, never how fast the session store flushes.
 */
async function cartHoldsLines(cookie: string, expected: number) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const body = (await fetch(`${baseUrl}/api/cart`, { headers: { cookie } }).then((r) =>
      r.json(),
    )) as { items: unknown[] }
    if (body.items.length === expected) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`the guest cart never reached ${expected} line(s) — the session did not persist`)
}

/**
 * Step 1 of every journey: a guest adds an item through the REAL cart route.
 * Returns the jar, already carrying the guest session cookie.
 */
async function guestAddsAnItem() {
  const cookies = jar()
  const added = await fetch(`${baseUrl}/api/cart/items`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookies.header },
    body: JSON.stringify({ slug: SLUG, quantity: 2 }),
  })
  cookies.capture(added)
  expect(added.status, 'the guest add must succeed before the journey means anything').toBe(200)

  // 🔴 The cookie must be durable before the SECOND add, or the two lines can
  // land in two different carts. See cartHoldsLines.
  await cartHoldsLines(cookies.header, 1)

  // TEST-020 step 1 is TWO products. Added over the SAME jar, so both lines
  // belong to one guest cart.
  const addedB = await fetch(`${baseUrl}/api/cart/items`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookies.header },
    body: JSON.stringify({ slug: SLUG_B, quantity: 1 }),
  })
  cookies.capture(addedB)
  expect(addedB.status).toBe(200)

  // 🔴 BOTH lines in ONE cart — asserted, never assumed. If the session split,
  // this fails HERE, naming the real cause, instead of surfacing later as a
  // promotion that appears to have dropped a product.
  await cartHoldsLines(cookies.header, 2)

  // Recorded ONLY so `wipe` can clean up. Nothing downstream is told this id —
  // the whole point is that the routes carry it themselves.
  const guestCarts = await prisma.cart.findMany({
    where: { userId: null, items: { some: { product: { slug: SLUG_B } } } },
    select: { sessionId: true },
  })
  for (const cart of guestCarts) if (cart.sessionId) createdCartSessionIds.add(cart.sessionId)

  return cookies
}

async function cartRowsFor(email: string) {
  return prisma.cartItem.findMany({
    where: { cart: { user: { email } } },
    select: { quantity: true, product: { select: { slug: true } } },
  })
}

describe('🔴 ISSUE-070 — a guest cart survives REGISTRATION, over the wire', () => {
  it('guest adds -> registers with the SAME cookie jar -> the account owns the cart', async () => {
    await wipe()
    const cookies = await guestAddsAnItem()

    // 🔴 The same jar. Nothing hands the route an identifier.
    const registered = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookies.header },
      body: JSON.stringify({
        firstName: 'Journey',
        lastName: 'Register',
        email: REGISTER_EMAIL,
        password: PASSWORD,
        confirmPassword: PASSWORD,
        phone: '0501234567',
        acceptedTerms: true,
      }),
    })
    expect(registered.status).toBe(201)

    // 🔴 THE CLAIM: the account's cart holds what the GUEST added.
    // Before `ad0c737` this was an empty array, silently.
    const rows = await cartRowsFor(REGISTER_EMAIL)
    expect(rows.map((r) => r.product.slug).sort()).toEqual([SLUG, SLUG_B].sort())
    expect(rows.find((r) => r.product.slug === SLUG)?.quantity).toBe(2)
    expect(rows.find((r) => r.product.slug === SLUG_B)?.quantity).toBe(1)

    // TEST-020 step 3 — COMPLETE VERIFICATION, by following the mailed link,
    // and confirm the cart is still there afterwards. Verification is a
    // separate gate that must not disturb the cart; asserting it here is what
    // makes this test TEST-020 rather than an approximation of it.
    const link = mailbox.sent.at(-1)?.body.match(/token=([\w.-]+)/)
    expect(link, 'the verification email must carry a token').not.toBeNull()
    const verified = await fetch(`${baseUrl}/api/auth/verify-email?token=${link?.[1]}`, {
      headers: { cookie: cookies.header },
    })
    expect(verified.status).toBe(200)

    const afterVerification = await cartRowsFor(REGISTER_EMAIL)
    expect(afterVerification).toHaveLength(2)

    // And the guest cart is gone rather than orphaned beside it (DEC-055).
    const orphan = await prisma.cart.findFirst({
      where: { userId: null, sessionId: { in: [...createdCartSessionIds] } },
      select: { id: true },
    })
    expect(orphan, 'the promoted guest cart must not survive as an orphan').toBeNull()
  })
})

describe('🔴 ISSUE-070 — a guest cart survives LOGIN, over the wire', () => {
  it('guest adds -> logs in with the SAME cookie jar -> the account owns the cart', async () => {
    await wipe()

    // An already-registered, ACTIVE account, created directly: this case is
    // about the LOGIN seam, and registering here would exercise the other one.
    await prisma.user.create({
      data: {
        firstName: 'Journey',
        lastName: 'Login',
        email: LOGIN_EMAIL,
        passwordHash: await argon2.hash(PASSWORD, ARGON2_OPTIONS),
        termsAcceptedAt: new Date(),
        status: 'active',
      },
    })

    const cookies = await guestAddsAnItem()

    const loggedIn = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookies.header },
      body: JSON.stringify({ email: LOGIN_EMAIL, password: PASSWORD }),
    })
    expect(loggedIn.status).toBe(200)

    const body = (await loggedIn.json()) as { cart?: { mergeFailed?: boolean } }
    // §7.15: a merge failure is caught so it cannot lock anyone out — which
    // means a silent failure would otherwise look exactly like success here.
    expect(body.cart?.mergeFailed).toBe(false)

    const rows = await cartRowsFor(LOGIN_EMAIL)
    expect(rows.map((r) => r.product.slug).sort()).toEqual([SLUG, SLUG_B].sort())
    expect(rows.find((r) => r.product.slug === SLUG)?.quantity).toBe(2)
  }, 30_000)

  it('🔴 logging in a SECOND time is idempotent — no duplicate line, no lost line', async () => {
    // The guest cart is already merged and gone. A second login must not
    // resurrect, duplicate or drop anything.
    const again = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: LOGIN_EMAIL, password: PASSWORD }),
    })
    expect(again.status).toBe(200)

    const rows = await cartRowsFor(LOGIN_EMAIL)
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.product.slug === SLUG)?.quantity).toBe(2)
  }, 30_000)
})

/**
 * 🔴 TEST-022 CLAUSE 4 — "a direct PATCH with quantity: 10 is clamped too".
 *
 * Checkpoint H found this clause had NO route-level test anywhere. The clamp
 * was proved in `cartQuantity.test.ts` (pure) and in `cartUpdate.integration`
 * (the service), and both call the clamp with arguments the test chose. Neither
 * proves the ROUTE reaches it — the same boundary blindness that let the
 * promote/merge seams ship inert.
 *
 * ⚠️ The requirement says "against the server", so the assertion has to be made
 * over HTTP. A client-side stepper that disables its own button proves nothing
 * about a request the client did not send.
 */
describe('🔴 TEST-022 clause 4 — the clamp holds over HTTP, not just in the service', () => {
  it('PATCH quantity 10 against stock 3 is clamped to 3 and SAYS it clamped', async () => {
    await wipe()
    const cookies = jar()

    const added = await fetch(`${baseUrl}/api/cart/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: SLUG, quantity: 1 }),
    })
    cookies.capture(added)
    expect(added.status).toBe(200)

    const cart = (await added.json()) as { cart: { items: { id: string; stockQuantity: number }[] } }
    const line = cart.cart.items[0]
    expect(line, 'the DTO must expose the line id, or no client can PATCH').toBeDefined()
    // The fixture this whole clause depends on. Asserted, not assumed: if the
    // seed ever raises this product's stock the case would silently stop
    // testing a clamp at all.
    expect(line?.stockQuantity, `${SLUG} must be the low-stock fixture`).toBe(3)

    const guest = await prisma.cart.findFirst({
      where: { userId: null, items: { some: { product: { slug: SLUG } } } },
      select: { sessionId: true },
      orderBy: { id: 'desc' },
    })
    if (guest?.sessionId) createdCartSessionIds.add(guest.sessionId)

    const patched = await fetch(`${baseUrl}/api/cart/items/${line?.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: cookies.header },
      body: JSON.stringify({ quantity: 10 }),
    })
    expect(patched.status).toBe(200)

    const body = (await patched.json()) as {
      quantity: number
      clampedByStock: boolean
      cart: { items: { quantity: number }[] }
    }

    // 🔴 3, not 10 — and the response SAYS it clamped, because a silent clamp
    // is a lie the UI cannot render.
    expect(body.quantity).toBe(3)
    expect(body.clampedByStock).toBe(true)
    expect(body.cart.items[0]?.quantity).toBe(3)

    // And the row itself, not just the response.
    const stored = await prisma.cartItem.findFirst({
      where: { cart: { sessionId: guest?.sessionId ?? '' } },
      select: { quantity: true },
    })
    expect(stored?.quantity).toBe(3)
  })
})

/**
 * 🔴 DEC-058 — SHIPPING, OVER HTTP AND WITH A WITHDRAWN LINE.
 *
 * `shipping.test.ts` proves the arithmetic exhaustively, including the ₪249
 * boundary, with arguments the test chooses. This proves the WIRING: that the
 * route reports shipping at all, and that the basis handed to the calculation
 * EXCLUDES withdrawn lines. That second half cannot be shown by a pure test —
 * it lives in `toDto`'s filter, on the other side of the boundary, and it is
 * the half that decides whether a shopper is promised free shipping on an
 * order they cannot place.
 */
describe('🔴 DEC-058 — the shipping basis excludes withdrawn lines, over the wire', () => {
  it('an ordinary cart is charged ₪30 and reports the rule', async () => {
    await wipe()
    const cookies = jar()

    const added = await fetch(`${baseUrl}/api/cart/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: SLUG, quantity: 1 }),
    })
    cookies.capture(added)
    const body = (await added.json()) as {
      cart: { subtotal: string; shipping: Record<string, unknown> }
    }

    const guest = await prisma.cart.findFirst({
      where: { userId: null, items: { some: { product: { slug: SLUG } } } },
      select: { sessionId: true },
      orderBy: { id: 'desc' },
    })
    if (guest?.sessionId) createdCartSessionIds.add(guest.sessionId)

    expect(body.cart.shipping.cost).toBe('30.00')
    expect(body.cart.shipping.isFree).toBe(false)
    expect(body.cart.shipping.hasShippableLines).toBe(true)
    // The threshold travels with the response so the UI states the rule
    // without hardcoding ₪249 in a second place.
    expect(body.cart.shipping.threshold).toBe('249.00')
    // Nothing withdrawn, so the two figures agree — which is what makes the
    // disagreement in the next case meaningful.
    expect(body.cart.shipping.basis).toBe(body.cart.subtotal)
  })

  it('🔴 a WITHDRAWN line counts toward the subtotal but NOT toward free shipping', async () => {
    await wipe()
    const cookies = jar()

    // Two products, both active, both added through the real route.
    for (const slug of [SLUG, SLUG_B]) {
      const res = await fetch(`${baseUrl}/api/cart/items`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: cookies.header },
        body: JSON.stringify({ slug, quantity: 1 }),
      })
      cookies.capture(res)
      expect(res.status).toBe(200)
    }
    await cartHoldsLines(cookies.header, 2)

    const guest = await prisma.cart.findFirst({
      where: { userId: null, items: { some: { product: { slug: SLUG_B } } } },
      select: { sessionId: true },
      orderBy: { id: 'desc' },
    })
    if (guest?.sessionId) createdCartSessionIds.add(guest.sessionId)

    // Withdraw one of them, exactly as a soft delete would.
    await prisma.product.update({ where: { slug: SLUG_B }, data: { isActive: false } })
    try {
      const cart = (await fetch(`${baseUrl}/api/cart`, { headers: { cookie: cookies.header } }).then(
        (r) => r.json(),
      )) as {
        subtotal: string
        hasBlockingLine: boolean
        items: { slug: string; isActive: boolean; lineTotal: string }[]
        shipping: { basis: string; cost: string; isFree: boolean; hasShippableLines: boolean }
      }

      // C3 is UNCHANGED: the line is still THERE. What changed at Checkpoint
      // F1 is what it COUNTS toward — DEC-059 answer 3.
      expect(cart.items).toHaveLength(2)
      expect(cart.hasBlockingLine).toBe(true)

      const withdrawn = cart.items.find((i) => i.slug === SLUG_B)
      const active = cart.items.find((i) => i.slug === SLUG)
      expect(withdrawn?.isActive).toBe(false)

      /*
       * 🔴 THE CLAIM CHANGED AT CHECKPOINT F1, AND SO DID THIS ASSERTION.
       *
       * It used to read `basis < subtotal` — the withdrawn line was counted in
       * the subtotal and excluded from the basis. DEC-059 answer 3 collapses
       * the two, so the claim is now: BOTH equal the active line alone.
       *
       * ⚠️ Still compared against the response's own figures, never against a
       * literal — a hardcoded number would keep passing with the filter
       * deleted if the seed prices ever changed. And the withdrawn line's own
       * total is asserted to be non-zero, so "they agree" cannot be satisfied
       * by an empty cart or a zeroed line.
       */
      expect(Number(withdrawn?.lineTotal)).toBeGreaterThan(0)
      expect(cart.shipping.basis).toBe(active?.lineTotal)
      expect(cart.subtotal).toBe(active?.lineTotal)
      expect(cart.shipping.hasShippableLines).toBe(true)
    } finally {
      // 🔴 Restored even if an assertion throws, or the dev catalogue is left
      // one product short and the NEXT run fails somewhere unrelated.
      await prisma.product.update({ where: { slug: SLUG_B }, data: { isActive: true } })
    }
  })

  it('🔴 a cart of ONLY withdrawn lines is shipped-nothing: no charge, and NOT free', async () => {
    await wipe()
    const cookies = jar()

    const added = await fetch(`${baseUrl}/api/cart/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: SLUG_B, quantity: 1 }),
    })
    cookies.capture(added)
    expect(added.status).toBe(200)

    const guest = await prisma.cart.findFirst({
      where: { userId: null, items: { some: { product: { slug: SLUG_B } } } },
      select: { sessionId: true },
      orderBy: { id: 'desc' },
    })
    if (guest?.sessionId) createdCartSessionIds.add(guest.sessionId)

    await prisma.product.update({ where: { slug: SLUG_B }, data: { isActive: false } })
    try {
      const cart = (await fetch(`${baseUrl}/api/cart`, { headers: { cookie: cookies.header } }).then(
        (r) => r.json(),
      )) as { subtotal: string; shipping: { cost: string; isFree: boolean; hasShippableLines: boolean } }

      // 🔴 The subtotal IS zero as of Checkpoint F1 — the line is still
      // displayed (C3) but buys nothing (DEC-059 answer 3). This asserted
      // `> 0` before, when the two figures were separate.
      expect(cart.subtotal).toBe('0.00')
      // And there is nothing to ship, so there is no charge AND no promise.
      expect(cart.shipping.hasShippableLines).toBe(false)
      expect(cart.shipping.cost).toBe('0.00')
      expect(cart.shipping.isFree).toBe(false)
    } finally {
      await prisma.product.update({ where: { slug: SLUG_B }, data: { isActive: true } })
    }
  })

  it('an EMPTY cart reports no shipping at all', async () => {
    const cart = (await fetch(`${baseUrl}/api/cart`).then((r) => r.json())) as {
      subtotal: string
      shipping: { cost: string; isFree: boolean; hasShippableLines: boolean }
    }
    expect(cart.subtotal).toBe('0.00')
    expect(cart.shipping.hasShippableLines).toBe(false)
    expect(cart.shipping.cost).toBe('0.00')
    expect(cart.shipping.isFree).toBe(false)
  })
})
