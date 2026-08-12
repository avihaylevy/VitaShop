import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import express from 'express'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cartRouter } from './cart.js'
import { createSessionMiddleware } from '../lib/session.js'
import { promoteGuestCart } from '../lib/promoteGuestCart.js'

/**
 * 🔴 THE WIRING BETWEEN THE ROUTE AND THE SEAM, crossed by a REAL COOKIE JAR.
 *
 * Checkpoints E and F were both mutation-proved and both green, and both were
 * NO-OPS in production: `auth.ts` passed `req.sessionID` to `promoteGuestCart`,
 * while `Cart.sessionId` is written from `guestCartId` — a SEPARATE randomUUID
 * minted by `guestSession.ts` into the session. Two different UUIDs, so the
 * lookup could never match, and `if (!guestCart) return none` reported
 * `promoted: false` with no error.
 *
 * ⚠️ EVERY EXISTING TEST PASSED because each supplies BOTH SIDES of the
 * identifier — it creates the guest cart with the same id it hands to the
 * function. That proves the function and never the wiring. 🔴 A unit test that
 * supplies both sides of an identifier cannot catch a mismatch between them.
 *
 * This test therefore drives the REAL cart route through a REAL session cookie
 * and then asks the seam to find that cart using what the route would give it.
 */

let prisma: PrismaClient
let server: Server
let baseUrl: string
const EMAIL = 'zz-wiring-user@example.test'

/**
 * 🔴 SCOPED TO WHAT THIS FILE CREATED. The first version matched
 * `sessionId: { not: null }` and deleted sibling suites' carts mid-run — the
 * same parallel-worker interference this project has now hit four times. Only
 * ids this test minted, plus its own user, are removed.
 */
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
  }
  const owned = await prisma.cart.findMany({
    where: { user: { email: EMAIL } },
    select: { id: true },
  })
  if (owned.length > 0) {
    await prisma.cartItem.deleteMany({ where: { cartId: { in: owned.map((c) => c.id) } } })
    await prisma.cart.deleteMany({ where: { id: { in: owned.map((c) => c.id) } } })
  }
  await prisma.user.deleteMany({ where: { email: EMAIL } })
  createdCartSessionIds.clear()
}

beforeAll(async () => {
  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  })

  const app = express()
  app.use(express.json())
  app.use(createSessionMiddleware())
  app.use('/api/cart', cartRouter)
  // Echoes what `auth.ts` USED to hand the seam, so the test can compare the
  // two identifiers across the boundary without importing either.
  app.get('/what-auth-passed', (req, res) => {
    res.json({ reqSessionID: req.sessionID, guestCartId: req.session?.guestCartId ?? null })
  })

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('no ephemeral port')
  baseUrl = `http://127.0.0.1:${address.port}`
  await wipe()
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()))
  })
  await wipe()
  await prisma.$disconnect()
})

/**
 * Reads the two identifiers, retrying briefly. ⚠️ Under the FULL suite the
 * session store write can trail the response: `guestCartId` read back as null
 * once, in the parallel run only. Retrying is honest here — the claim under
 * test is that the two ids DIFFER and that the seam finds the cart, not that
 * connect-pg-simple has flushed by a particular millisecond.
 */
async function readIdentity(cookie: string) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const identity = (await fetch(`${baseUrl}/what-auth-passed`, { headers: { cookie } }).then((r) =>
      r.json(),
    )) as { reqSessionID: string; guestCartId: string | null }
    if (identity.guestCartId) return identity
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('the session never carried a guestCartId — the cart POST did not write one')
}

/** A minimal cookie jar — this test is about a cookie surviving requests. */
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

describe('🔴 the guest cart identity survives the route → seam boundary', () => {
  it('a guest cart created through the REAL route is found by the seam', async () => {
    await wipe()
    const cookies = jar()

    // 1. As a guest, add an item through the real route.
    const added = await fetch(`${baseUrl}/api/cart/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'altman-probiotic-intense-30', quantity: 1 }),
    })
    cookies.capture(added)
    expect(added.status).toBe(200)

    // 2. Read both identifiers the way the route sees them.
    const identity = await readIdentity(cookies.header)
    expect(identity.guestCartId).toEqual(expect.any(String))
    if (identity.guestCartId) createdCartSessionIds.add(identity.guestCartId)

    // 🔴 THE DEFECT, stated as an assertion: the cart is keyed by
    // `guestCartId`, NOT by `req.sessionID`. They are different UUIDs.
    const storedCart = await prisma.cart.findFirst({
      where: { sessionId: identity.guestCartId },
      select: { id: true },
    })
    expect(storedCart, 'the route stores the cart under guestCartId').not.toBeNull()
    expect(identity.reqSessionID).not.toBe(identity.guestCartId)

    // 3. Ask the seam to promote it using what the route hands over TODAY.
    const user = await prisma.user.create({
      data: {
        firstName: 'wiring',
        lastName: 'test',
        email: EMAIL,
        passwordHash: 'x',
        termsAcceptedAt: new Date(),
      },
      select: { id: true },
    })

    const outcome = await prisma.$transaction((tx) =>
      promoteGuestCart(tx, identity.guestCartId, user.id),
    )

    // Before the fix, auth.ts passed `reqSessionID` here and this was
    // `promoted: false` — silently, for every real shopper.
    expect(outcome.promoted, 'the seam must find the cart the route created').toBe(true)
    expect(await prisma.cartItem.count({ where: { cart: { userId: user.id } } })).toBe(1)
  })

  it('🔴 the value auth USED to pass finds nothing — the defect, pinned', async () => {
    await wipe()
    const cookies = jar()

    const added = await fetch(`${baseUrl}/api/cart/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'altman-probiotic-intense-30', quantity: 1 }),
    })
    cookies.capture(added)

    const identity = await readIdentity(cookies.header)
    if (identity.guestCartId) createdCartSessionIds.add(identity.guestCartId)

    const user = await prisma.user.create({
      data: {
        firstName: 'wiring',
        lastName: 'test',
        email: EMAIL,
        passwordHash: 'x',
        termsAcceptedAt: new Date(),
      },
      select: { id: true },
    })

    // Pinned so the mistake cannot quietly return: req.sessionID is NOT the
    // cart identity, and using it promotes nothing while reporting success.
    const wrong = await prisma.$transaction((tx) =>
      promoteGuestCart(tx, identity.reqSessionID, user.id),
    )
    expect(wrong.promoted).toBe(false)
    expect(await prisma.cartItem.count({ where: { cart: { userId: user.id } } })).toBe(0)
  })
})
