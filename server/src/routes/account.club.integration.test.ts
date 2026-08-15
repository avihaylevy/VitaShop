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
 * MILESTONE-012 Checkpoint B / DEC-086 — the club join/leave routes.
 *
 * The same frame as the favourites suite: membership is personal state, the
 * session is the only identity, and the join date is history that a repeat
 * press must not rewrite. Fixture rule (DEC-063): this file's users are its
 * own (zz-club-*), removed exactly as created.
 */

let prisma: PrismaClient
let server: Server
let baseUrl: string

const EMAIL = 'zz-club-shopper@example.test'
const PASSWORD = 'Abcdef12xyz'
let userId = ''

async function signIn(): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  expect(response.status).toBe(200)
  const set = response.headers.get('set-cookie')
  if (!set) throw new Error('no session cookie')
  return set.split(';')[0] ?? ''
}

const status = (cookie?: string) =>
  fetch(`${baseUrl}/api/account/club`, { headers: cookie ? { cookie } : {} })
const act = (action: unknown, cookie?: string) =>
  fetch(`${baseUrl}/api/account/club`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ action }),
  })

beforeAll(async () => {
  await prewarmDummyHash()
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const hash = await argon2.hash(PASSWORD, ARGON2_OPTIONS)
  await prisma.user.upsert({
    where: { email: EMAIL },
    create: {
      email: EMAIL, firstName: 'Club', lastName: 'Shopper',
      passwordHash: hash, termsAcceptedAt: new Date(),
      status: 'active', role: 'customer',
    },
    update: { status: 'active', passwordHash: hash, isClubMember: false, clubJoinedAt: null },
  })
  userId = (await prisma.user.findUniqueOrThrow({ where: { email: EMAIL }, select: { id: true } })).id
}, 60_000)

beforeEach(async () => {
  await prisma.user.update({ where: { id: userId }, data: { isClubMember: false, clubJoinedAt: null } })
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
  await prisma.user.deleteMany({ where: { email: EMAIL } })
  await prisma.$disconnect()
})

describe('the club routes — session-only identity, idempotent both ways', () => {
  it('anonymous gets 401 on both routes and learns nothing', async () => {
    expect((await status()).status).toBe(401)
    expect((await act('join')).status).toBe(401)
  })

  it('a fresh shopper is not a member, joins, and the answer carries the join date', async () => {
    const cookie = await signIn()
    const before = (await (await status(cookie)).json()) as { isClubMember: boolean; clubJoinedAt: string | null }
    expect(before).toEqual({ isClubMember: false, clubJoinedAt: null })

    const joined = (await (await act('join', cookie)).json()) as { isClubMember: boolean; clubJoinedAt: string | null }
    expect(joined.isClubMember).toBe(true)
    expect(joined.clubJoinedAt).not.toBeNull()
  })

  it('🔴 a REPEAT join keeps the ORIGINAL join date — a second press must not rewrite history', async () => {
    const cookie = await signIn()
    const first = (await (await act('join', cookie)).json()) as { clubJoinedAt: string }
    const second = (await (await act('join', cookie)).json()) as { clubJoinedAt: string }
    expect(second.clubJoinedAt).toBe(first.clubJoinedAt)
  })

  it('leave clears both fields and is idempotent', async () => {
    const cookie = await signIn()
    await act('join', cookie)
    const left = (await (await act('leave', cookie)).json()) as { isClubMember: boolean; clubJoinedAt: string | null }
    expect(left).toEqual({ isClubMember: false, clubJoinedAt: null })
    const again = (await (await act('leave', cookie)).json()) as { isClubMember: boolean }
    expect(again.isClubMember).toBe(false)
  })

  it('a malformed action is a 400 naming the contract, never a silent no-op', async () => {
    const cookie = await signIn()
    for (const bad of ['JOIN', '', 42, null, undefined]) {
      const res = await act(bad, cookie)
      expect(res.status).toBe(400)
    }
    // and nothing changed
    const after = (await (await status(cookie)).json()) as { isClubMember: boolean }
    expect(after.isClubMember).toBe(false)
  })

  it('🔴 THE SEAM IS LIVE: joining changes the very next cart read (no session state to refresh)', async () => {
    const cookie = await signIn()
    // a real active product in the cart, via the DB directly (cart routes are
    // another suite's subject)
    const product = await prisma.product.findFirstOrThrow({
      where: { isActive: true },
      select: { id: true, price: true },
    })
    const cart = await prisma.cart.upsert({
      where: { userId }, create: { userId }, update: {}, select: { id: true },
    })
    await prisma.cartItem.upsert({
      where: { cartId_productId: { cartId: cart.id, productId: product.id } },
      create: { cartId: cart.id, productId: product.id, quantity: 1 },
      update: { quantity: 1 },
    })
    try {
      const { getCart } = await import('../lib/cartService.js')
      const before = await getCart(prisma, { userId, guestCartId: undefined })
      expect(before.items[0]!.unitPrice).toBe(product.price.toFixed(2))

      await act('join', cookie)
      const after = await getCart(prisma, { userId, guestCartId: undefined })
      const expected = ((Math.round(Math.round(Number(product.price.toFixed(2)) * 100) * 0.9)) / 100).toFixed(2)
      expect(after.items[0]!.unitPrice).toBe(expected)
    } finally {
      await prisma.cartItem.deleteMany({ where: { cartId: cart.id } })
      await prisma.cart.deleteMany({ where: { id: cart.id } })
    }
  })
})
