import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import argon2 from 'argon2'
import express from 'express'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createAuthRouter } from './auth.js'
import { createAdminOrderRouter } from './adminOrders.js'
import { createAuthRateLimiters } from '../lib/rateLimit.js'
import { ARGON2_OPTIONS } from '../lib/registrationService.js'
import { prewarmDummyHash } from '../lib/loginService.js'
import { createSessionMiddleware } from '../lib/session.js'
import { NullEmailProvider } from '../lib/emailService.js'

/**
 * `GET /api/auth/session` — ISSUE-097, and DEC-071 amending DEC-065.
 *
 * 🔴 THE ROUTE RETURNED A BARE BOOLEAN, so the client could not know whether
 * the signed-in person is an admin — which is why `/admin/orders` has been
 * linked from nowhere since it shipped, and why the user reported "I cannot do
 * anything as an admin".
 *
 * 🔴 THE ROLE IS FOR SHOWING A LINK, AND NOTHING ELSE. DEC-065 keeps
 * authorization server-side and re-reads `User.role` from the database on EVERY
 * request; this response is advisory, and the last test in this file is the one
 * that matters — a client that lies about its role gains nothing.
 *
 * ⚠️ THIS ROUTE HAD NO BEHAVIOURAL TEST AT ALL before this file. Its only
 * coverage was rate-limiter identity, which says nothing about what it answers.
 */

let prisma: PrismaClient
let server: Server
let baseUrl: string

const ADMIN = 'zz-session-admin@example.test'
const SHOPPER = 'zz-session-shopper@example.test'
const PASSWORD = 'Abcdef12xyz'

async function signIn(email: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  expect(response.status).toBe(200)
  return (response.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
}

function session(cookie?: string) {
  return fetch(`${baseUrl}/api/auth/session`, { headers: cookie ? { cookie } : {} })
}

beforeAll(async () => {
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  await prewarmDummyHash()

  const hash = await argon2.hash(PASSWORD, ARGON2_OPTIONS)
  for (const email of [ADMIN, SHOPPER]) {
    await prisma.user.upsert({
      where: { email },
      create: {
        email,
        firstName: 'Session',
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
  await prisma.user.deleteMany({ where: { email: { in: [ADMIN, SHOPPER] } } })
  server.close()
  await prisma.$disconnect()
})

describe('GET /api/auth/session', () => {
  it('🔴 tells an ANONYMOUS caller nothing but "no"', async () => {
    const body = (await (await session()).json()) as Record<string, unknown>
    expect(body.authenticated).toBe(false)
    // No role, no id, no email. An unauthenticated caller learns only about
    // their own request, which they already knew.
    expect(body.role).toBeUndefined()
    expect(Object.keys(body)).toEqual(['authenticated'])
  })

  it('reports a shopper as a customer', async () => {
    const body = (await (await session(await signIn(SHOPPER))).json()) as Record<string, unknown>
    expect(body.authenticated).toBe(true)
    expect(body.role).toBe('customer')
  })

  it('🔴 reports an ADMIN as an admin — the whole point of ISSUE-097', async () => {
    const body = (await (await session(await signIn(ADMIN))).json()) as Record<string, unknown>
    expect(body.authenticated).toBe(true)
    expect(body.role).toBe('admin')
  })

  it('🔴 THE ROLE IS NOT A PERMISSION — revoking it takes effect IMMEDIATELY', async () => {
    /*
     * 🔴 THE TEST THAT MAKES DEC-071 SAFE, and the reason DEC-065's property is
     * unharmed. The response is advisory: it decides whether a LINK is drawn.
     * Authorization re-reads `User.role` from the database on every request, so
     * an admin demoted mid-session is refused at once — no sign-out, no cache
     * to expire, nothing the browser believes can change it.
     */
    const cookie = await signIn(ADMIN)
    expect(((await (await session(cookie)).json()) as { role?: string }).role).toBe('admin')
    expect((await fetch(`${baseUrl}/api/admin/orders`, { headers: { cookie } })).status).toBe(200)

    await prisma.user.update({ where: { email: ADMIN }, data: { role: 'customer' } })
    try {
      // Same cookie, same session row, no re-login.
      expect((await fetch(`${baseUrl}/api/admin/orders`, { headers: { cookie } })).status).toBe(403)
      // And the advisory answer follows the database too, so a reload corrects
      // the UI rather than leaving a link that only ever 403s.
      expect(((await (await session(cookie)).json()) as { role?: string }).role).toBe('customer')
    } finally {
      await prisma.user.update({ where: { email: ADMIN }, data: { role: 'admin' } })
    }
  })
})
