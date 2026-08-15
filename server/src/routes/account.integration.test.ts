import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import argon2 from 'argon2'
import express from 'express'
import type { Server } from 'node:http'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createAccountRouter } from './account.js'
import { createAuthRouter } from './auth.js'
import { createAuthRateLimiters } from '../lib/rateLimit.js'
import { ARGON2_OPTIONS } from '../lib/registrationService.js'
import { prewarmDummyHash } from '../lib/loginService.js'
import { createSessionMiddleware } from '../lib/session.js'
import { NullEmailProvider } from '../lib/emailService.js'

/**
 * MILESTONE-008 Checkpoint F2b — `GET /api/account/profile`, the first route
 * in this project that serves PERSONAL data.
 *
 * 🔴 THE SUBJECT IS WHO GETS WHAT, not the shape of the payload. A name, a
 * phone number and a home address are exactly the data an IDOR leaks, and this
 * route is the first one that could have one.
 */

let prisma: PrismaClient
let server: Server
let baseUrl: string

const ALICE = 'zz-account-alice@example.test'
const BOB = 'zz-account-bob@example.test'
const NO_ADDRESS = 'zz-account-bare@example.test'
const PASSWORD = 'Abcdef12xyz'

let aliceId = ''
let bobId = ''

async function signIn(email: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  expect(response.status).toBe(200)
  const set = response.headers.get('set-cookie')
  if (!set) throw new Error('no session cookie')
  return set.split(';')[0] ?? ''
}

function getProfile(cookie?: string) {
  return fetch(`${baseUrl}/api/account/profile`, {
    headers: { ...(cookie ? { cookie } : {}) },
  })
}

beforeAll(async () => {
  await prewarmDummyHash()
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

  const hash = await argon2.hash(PASSWORD, ARGON2_OPTIONS)
  for (const [email, firstName, phone] of [
    [ALICE, 'Alice', '050-1111111'],
    [BOB, 'Bob', '050-2222222'],
    [NO_ADDRESS, 'Bare', null],
  ] as const) {
    await prisma.user.upsert({
      where: { email },
      create: {
        email,
        firstName,
        lastName: 'Account',
        phone,
        passwordHash: hash,
        termsAcceptedAt: new Date(),
        status: 'active',
        role: 'customer',
      },
      update: { status: 'active', passwordHash: hash, phone, firstName },
      select: { id: true },
    })
  }
  aliceId = (await prisma.user.findUniqueOrThrow({ where: { email: ALICE }, select: { id: true } })).id
  bobId = (await prisma.user.findUniqueOrThrow({ where: { email: BOB }, select: { id: true } })).id

  await prisma.address.deleteMany({ where: { userId: { in: [aliceId, bobId] } } })
  await prisma.address.create({
    data: { userId: aliceId, line1: 'רחוב אליס 1', city: 'תל אביב', zipCode: '6100000', isDefault: true },
  })
  await prisma.address.create({
    data: { userId: bobId, line1: 'רחוב בוב 2', city: 'חיפה', zipCode: '3100000', isDefault: true },
  })
}, 60_000)

beforeEach(async () => {
  // A fresh app per test so one cannot spend another's limiter budget.
  const app = express()
  app.use(express.json())
  app.use(createSessionMiddleware())
  app.use('/api/account', createAccountRouter({ prisma }))
  app.use(
    '/api',
    createAuthRouter({
      prisma,
      emailService: new NullEmailProvider(),
      appBaseUrl: 'http://127.0.0.1',
      rateLimiters: createAuthRateLimiters(),
    }),
  )
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const address = server.address()
      baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
      resolve()
    })
  })
})

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

afterAll(async () => {
  await prisma.address.deleteMany({ where: { userId: { in: [aliceId, bobId] } } })
  await prisma.user.deleteMany({ where: { email: { in: [ALICE, BOB, NO_ADDRESS] } } })
  await prisma.$disconnect()
})

describe('who may read a profile', () => {
  it('anonymous gets 401 and no data', async () => {
    const response = await getProfile()
    expect(response.status).toBe(401)
    const body = (await response.json()) as Record<string, unknown>
    expect(JSON.stringify(body)).not.toContain('Alice')
  })

  it('a signed-in shopper gets their OWN name, phone and address', async () => {
    const cookie = await signIn(ALICE)
    const response = await getProfile(cookie)
    expect(response.status).toBe(200)

    const body = (await response.json()) as {
      firstName: string
      phone: string | null
      defaultAddress: { line1: string; city: string; zipCode: string | null } | null
    }
    expect(body.firstName).toBe('Alice')
    expect(body.phone).toBe('050-1111111')
    expect(body.defaultAddress).toEqual({
      line1: 'רחוב אליס 1',
      city: 'תל אביב',
      zipCode: '6100000',
    })
  })

  /**
   * 🔴 THE IDOR SHAPE, and the reason it cannot be reached: there is no
   * parameter to tamper with. The test drives it anyway — a later refactor
   * that adds `?userId=` for convenience must fail here rather than ship.
   */
  it('cannot be steered to ANOTHER shopper by any parameter it accepts', async () => {
    const cookie = await signIn(ALICE)
    for (const suffix of [`?userId=${bobId}`, `?id=${bobId}`, `?email=${BOB}`]) {
      const response = await fetch(`${baseUrl}/api/account/profile${suffix}`, {
        headers: { cookie },
      })
      expect(response.status).toBe(200)
      const body = (await response.json()) as { firstName: string; defaultAddress: { city: string } | null }
      // 🔴 Alice's row every time, never Bob's — asserted on BOTH the name and
      // the city, because a leak that swapped only the address would be the
      // worse of the two and a name-only assertion would miss it.
      expect(body.firstName).toBe('Alice')
      expect(body.defaultAddress?.city).toBe('תל אביב')
    }
  })

  /**
   * 🔴 THE CONTROL. Every assertion above says "Alice", which a route that
   * returned a hardcoded profile — or the FIRST user in the table — would
   * satisfy just as well. Bob signing in must get Bob.
   */
  it('a different shopper gets a DIFFERENT profile', async () => {
    const cookie = await signIn(BOB)
    const body = (await getProfile(cookie).then((r) => r.json())) as {
      firstName: string
      phone: string | null
      defaultAddress: { city: string } | null
    }
    expect(body.firstName).toBe('Bob')
    expect(body.phone).toBe('050-2222222')
    expect(body.defaultAddress?.city).toBe('חיפה')
  })

  it('a DISABLED account is refused, even holding a valid session', async () => {
    const cookie = await signIn(ALICE)
    expect((await getProfile(cookie)).status).toBe(200)
    try {
      await prisma.user.update({ where: { id: aliceId }, data: { status: 'disabled' } })
      const response = await getProfile(cookie)
      // 401, not 404: the session names an account that cannot act, and the
      // answer says nothing about whether the row exists.
      expect(response.status).toBe(401)
      expect(JSON.stringify(await response.json())).not.toContain('Alice')
    } finally {
      await prisma.user.update({ where: { id: aliceId }, data: { status: 'active' } })
    }
  })

  it('🔴 and the refusal DESTROYS the session, so re-enabling does not revive it', async () => {
    // Refusing this one request while the same cookie still opens
    // /checkout/pay would leave a disabled shopper creating orders.
    const cookie = await signIn(ALICE)
    try {
      await prisma.user.update({ where: { id: aliceId }, data: { status: 'disabled' } })
      expect((await getProfile(cookie)).status).toBe(401)
      await prisma.user.update({ where: { id: aliceId }, data: { status: 'active' } })
      // The account is fine again; the SESSION is not, because it was
      // destroyed rather than merely refused.
      expect((await getProfile(cookie)).status).toBe(401)
    } finally {
      await prisma.user.update({ where: { id: aliceId }, data: { status: 'active' } })
    }
  })

  /**
   * 🔴 THE CASE WITH NO CONTROL ON IT, and it was a defect. The branch read
   * `status !== 'active'`, which refused `pending_verification` too — while
   * `attemptLogin` blocks only `disabled` and checkout gates on
   * `requireShopper` alone. An unverified shopper could sign in, fill a cart
   * and pay, and this read answered 401, which the client takes for an expired
   * session and bounces to a login that immediately succeeds.
   *
   * ⚠️ REQ-F-031's "an unverified account cannot complete an order" is real
   * and is NOT this route's job — it is O3, it belongs on the order, and
   * ISSUE-091 tracks that it is unenforced anywhere.
   */
  it('a PENDING_VERIFICATION account gets its profile — the gate is on the order, not here', async () => {
    try {
      await prisma.user.update({
        where: { id: aliceId },
        data: { status: 'pending_verification' },
      })
      const cookie = await signIn(ALICE)
      const response = await getProfile(cookie)
      expect(response.status).toBe(200)
      expect(((await response.json()) as { firstName: string }).firstName).toBe('Alice')
    } finally {
      await prisma.user.update({ where: { id: aliceId }, data: { status: 'active' } })
    }
  })
})

describe('how long the response is allowed to live', () => {
  it('🔴 says no-store — personal data over a cacheable GET', async () => {
    const cookie = await signIn(ALICE)
    const response = await getProfile(cookie)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('says it on the REFUSAL too — a cached 401 is its own bug', async () => {
    expect((await getProfile()).headers.get('cache-control')).toBe('no-store')
  })
})

/**
 * 🔴 THE SEAM THE DOC COMMENT PROMISED, NOW STOOD ON.
 *
 * `rateLimiters` is injectable "so a test can identify the limiter rather than
 * count it" — and nothing used it. `checkout.ts` records what happens when a
 * coverage test asserts `stack.length >= 3` instead: the guard sat in FRONT of
 * the limiter and the test stayed green.
 *
 * The ordering is provable from the outside without counting anything: an
 * ANONYMOUS request must still reach the limiter. If the guard ran first it
 * would 401 and the limiter would never see it, which is the whole failure —
 * an unauthenticated flood hitting the session store with no ceiling.
 */
describe('the middleware ORDER, which the file calls the contract', () => {
  it('the limiter sees an anonymous request — it runs BEFORE the guard', async () => {
    const seen: string[] = []
    const app = express()
    app.use(express.json())
    app.use(createSessionMiddleware())
    app.use(
      '/api/account',
      createAccountRouter({
        prisma,
        rateLimiters: {
          profile: (_req, _res, next) => {
            seen.push('limiter')
            next()
          },
          // ISSUE-115 added a second limiter to the shape; this test's
          // subject is /profile's ordering, so a pass-through suffices.
          favourites: (_req, _res, next) => next(),
        },
      }),
    )
    const local = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s))
    })
    try {
      const address = local.address()
      const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
      const response = await fetch(`${url}/api/account/profile`)

      expect(response.status).toBe(401)
      // 🔴 The limiter ran even though the request was refused. Reversed, this
      // array is empty and the 401 looks identical from the outside.
      expect(seen).toEqual(['limiter'])
    } finally {
      await new Promise<void>((resolve) => local.close(() => resolve()))
    }
  })
})

describe('what the payload does and does not carry', () => {
  it('🔴 never returns the email — checkout has no use for it', async () => {
    const cookie = await signIn(ALICE)
    const raw = await getProfile(cookie).then((r) => r.text())
    expect(raw).not.toContain(ALICE)
    expect(raw).not.toContain('@example.test')
  })

  it('never returns the password hash or the user id', async () => {
    const cookie = await signIn(ALICE)
    const raw = await getProfile(cookie).then((r) => r.text())
    expect(raw).not.toContain('$argon2')
    expect(raw).not.toContain(aliceId)
  })

  it('reports NO address as null, distinguishably from a blank one', async () => {
    const cookie = await signIn(NO_ADDRESS)
    const body = (await getProfile(cookie).then((r) => r.json())) as {
      phone: string | null
      defaultAddress: unknown
    }
    // A blank-field object would render as a pre-filled form that is not.
    expect(body.defaultAddress).toBeNull()
    expect(body.phone).toBeNull()
  })

  /**
   * 🔴 THE CASE THAT IS TRUE OF EVERY ADDRESS IN THE DATABASE TODAY. Nothing
   * writes `isDefault` yet, so a route that FILTERED on it — rather than
   * ordering by it — would return null for every shopper on file while the
   * address sat there. Filtering degrades to "no address"; ordering degrades
   * to "the oldest one".
   */
  it('returns an address that is NOT flagged default when it is the only one', async () => {
    const solo = await prisma.address.create({
      data: { userId: bobId, line1: 'רחוב יחיד 3', city: 'באר שבע', zipCode: null, isDefault: false },
    })
    try {
      await prisma.address.deleteMany({ where: { userId: bobId, isDefault: true } })
      const cookie = await signIn(BOB)
      const body = (await getProfile(cookie).then((r) => r.json())) as {
        defaultAddress: { city: string } | null
      }
      expect(body.defaultAddress?.city).toBe('באר שבע')
    } finally {
      await prisma.address.deleteMany({ where: { id: solo.id } })
      await prisma.address.create({
        data: { userId: bobId, line1: 'רחוב בוב 2', city: 'חיפה', zipCode: '3100000', isDefault: true },
      })
    }
  })

  it('prefers the DEFAULT address when a shopper has more than one', async () => {
    const extra = await prisma.address.create({
      data: { userId: aliceId, line1: 'רחוב שני 9', city: 'ירושלים', zipCode: null, isDefault: false },
    })
    try {
      const cookie = await signIn(ALICE)
      const body = (await getProfile(cookie).then((r) => r.json())) as {
        defaultAddress: { city: string } | null
      }
      expect(body.defaultAddress?.city).toBe('תל אביב')
    } finally {
      await prisma.address.delete({ where: { id: extra.id } })
    }
  })
})
