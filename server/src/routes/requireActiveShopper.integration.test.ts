import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import argon2 from 'argon2'
import express from 'express'
import type { Server } from 'node:http'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createAccountRouter } from './account.js'
import { createAuthRouter } from './auth.js'
import { createCheckoutRouter } from './checkout.js'
import { createOrderRouter } from './orders.js'
import { createAuthRateLimiters } from '../lib/rateLimit.js'
import { ARGON2_OPTIONS } from '../lib/registrationService.js'
import { prewarmDummyHash } from '../lib/loginService.js'
import { createSessionMiddleware } from '../lib/session.js'
import { NullEmailProvider } from '../lib/emailService.js'

/**
 * ISSUE-091 and ISSUE-092 — the shopper status guards, over the wire.
 *
 * 🔴 THE SUBJECT IS WHICH STATUS MAY DO WHAT, and the two levels are the whole
 * point: `active` for reading your own profile or cancelling an order,
 * `verified` for completing one (REQ-F-031, O3).
 *
 * ⚠️ NO CART OR ORDER FIXTURES ARE NEEDED, deliberately. The guards run BEFORE
 * the handlers, so a refusal is visible with an empty cart and a made-up order
 * id — and the ALLOWED case is proved by the handler's OWN error arriving
 * instead (409 EMPTY_CART, 404 ORDER_NOT_FOUND). A test that asserted only
 * "not 403" would pass against a route that refused everything with a 500.
 */

let prisma: PrismaClient
let server: Server
let baseUrl: string

const ACTIVE = 'zz-guard-active@example.test'
const UNVERIFIED = 'zz-guard-unverified@example.test'
const DISABLED = 'zz-guard-disabled@example.test'
const PASSWORD = 'Abcdef12xyz'
const EMAILS = [ACTIVE, UNVERIFIED, DISABLED]

async function signIn(email: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  expect(response.status).toBe(200)
  return (response.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
}

/** Signs in while ACTIVE, then moves the account — the session outlives it. */
async function sessionThenStatus(email: string, status: 'disabled' | 'pending_verification') {
  const cookie = await signIn(email)
  await prisma.user.update({ where: { email }, data: { status } })
  return cookie
}

function post(path: string, cookie: string, body: unknown = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  })
}

async function codeOf(response: Response): Promise<string | undefined> {
  const body = (await response.json()) as { error?: { code?: string } }
  return body.error?.code
}

beforeAll(async () => {
  await prewarmDummyHash()
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const hash = await argon2.hash(PASSWORD, ARGON2_OPTIONS)
  for (const email of EMAILS) {
    await prisma.user.upsert({
      where: { email },
      create: {
        email,
        firstName: 'Guard',
        lastName: 'Test',
        passwordHash: hash,
        termsAcceptedAt: new Date(),
        status: 'active',
        role: 'customer',
      },
      update: { status: 'active', passwordHash: hash },
      select: { id: true },
    })
  }
}, 60_000)

beforeEach(async () => {
  for (const email of EMAILS) {
    await prisma.user.update({ where: { email }, data: { status: 'active' } })
  }
  const app = express()
  app.use(express.json())
  app.use(createSessionMiddleware())
  app.use('/api/account', createAccountRouter({ prisma }))
  app.use('/api/checkout', createCheckoutRouter({ prisma, emailService: new NullEmailProvider() }))
  app.use('/api/orders', createOrderRouter({ prisma }))
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
  await prisma.user.deleteMany({ where: { email: { in: EMAILS } } })
  await prisma.$disconnect()
})

describe('REQ-F-031 — an unverified account cannot COMPLETE an order (O3)', () => {
  it('/checkout/validate refuses it with EMAIL_NOT_VERIFIED, and 403 not 401', async () => {
    const cookie = await sessionThenStatus(UNVERIFIED, 'pending_verification')
    const response = await post('/api/checkout/validate', cookie, { deliveryMethod: 'courier' })

    // 🔴 403, and the code NAMES the cause. A 401 would tell the shopper to
    // sign in — which they have done, and which will not help.
    expect(response.status).toBe(403)
    expect(await codeOf(response)).toBe('EMAIL_NOT_VERIFIED')
  })

  it('/checkout/pay refuses it too — the gate is not only on the earlier screen', async () => {
    const cookie = await sessionThenStatus(UNVERIFIED, 'pending_verification')
    const response = await post('/api/checkout/pay', cookie, {
      deliveryMethod: 'courier',
      fingerprint: 'anything',
      idempotencyKey: 'guard-unverified',
    })
    expect(response.status).toBe(403)
    expect(await codeOf(response)).toBe('EMAIL_NOT_VERIFIED')
  })

  /**
   * 🔴 THE CONTROL. Every assertion above is a refusal, and a guard that
   * refused EVERY status would satisfy all of them. An active account must
   * reach the HANDLER — proved by the handler's own error arriving.
   */
  it('an ACTIVE account passes the guard and reaches the handler', async () => {
    const cookie = await signIn(ACTIVE)
    const response = await post('/api/checkout/validate', cookie, { deliveryMethod: 'courier' })

    expect(response.status).toBe(409)
    // EMPTY_CART is the handler speaking, which it could not do if the guard
    // had refused.
    expect(await codeOf(response)).toBe('EMPTY_CART')
  })
})

describe('ISSUE-092 — a disabled account loses the session it is holding', () => {
  it('/checkout/validate refuses it with 401', async () => {
    const cookie = await sessionThenStatus(DISABLED, 'disabled')
    const response = await post('/api/checkout/validate', cookie, { deliveryMethod: 'courier' })
    expect(response.status).toBe(401)
    expect(await codeOf(response)).toBe('AUTHENTICATION_REQUIRED')
  })

  it('🔴 and the session is DESTROYED, so re-enabling the account does not revive it', async () => {
    const cookie = await sessionThenStatus(DISABLED, 'disabled')
    expect((await post('/api/checkout/validate', cookie, { deliveryMethod: 'courier' })).status).toBe(401)

    await prisma.user.update({ where: { email: DISABLED }, data: { status: 'active' } })
    // The account is fine again; that cookie is not. Refusing the request
    // while leaving the cookie valid is what let a disabled shopper keep
    // paying on every route the guard was not mounted on.
    const after = await post('/api/checkout/validate', cookie, { deliveryMethod: 'courier' })
    expect(after.status).toBe(401)
  })

  it('/orders/:id/cancel refuses it as well', async () => {
    const cookie = await sessionThenStatus(DISABLED, 'disabled')
    const response = await post('/api/orders/00000000-0000-0000-0000-000000000000/cancel', cookie)
    expect(response.status).toBe(401)
  })

  it('/api/account/profile refuses it as well', async () => {
    const cookie = await sessionThenStatus(DISABLED, 'disabled')
    const response = await fetch(`${baseUrl}/api/account/profile`, { headers: { cookie } })
    expect(response.status).toBe(401)
  })
})

describe('🔴 the two levels differ, and the difference is deliberate', () => {
  it('an UNVERIFIED shopper may still CANCEL — cancelling is not completing', async () => {
    const cookie = await sessionThenStatus(UNVERIFIED, 'pending_verification')
    const response = await post('/api/orders/00000000-0000-0000-0000-000000000000/cancel', cookie)

    // 404 from the handler, not 403 from the guard: they got through. An
    // unverified shopper holding a pending order must be able to get out of it.
    expect(response.status).toBe(404)
    expect(await codeOf(response)).toBe('ORDER_NOT_FOUND')
  })

  it('an UNVERIFIED shopper may still read their own profile — the loop that shipped', async () => {
    const cookie = await sessionThenStatus(UNVERIFIED, 'pending_verification')
    const response = await fetch(`${baseUrl}/api/account/profile`, { headers: { cookie } })

    // Refusing this is what produced the login loop: 401, the client reads
    // "session expired", the login succeeds, repeat.
    expect(response.status).toBe(200)
  })
})
