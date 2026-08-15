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
 * ISSUE-115 / REQ-F-034 — the favourites routes.
 *
 * 🔴 THE SUBJECT IS WHO GETS WHAT — the same IDOR frame as the profile's
 * suite: a favourite is personal data (what a person wants to buy), the
 * session is the only identity, and one shopper's list must be invisible to
 * another however the request is shaped.
 *
 * Fixture rule (DEC-063): this file's users are its own (zz-fav-*), and it
 * removes exactly the rows it created.
 */

let prisma: PrismaClient
let server: Server
let baseUrl: string

const ALICE = 'zz-fav-alice@example.test'
const BOB = 'zz-fav-bob@example.test'
const PASSWORD = 'Abcdef12xyz'

let aliceId = ''
let bobId = ''
/** A real, seeded, ACTIVE product — favourites point at live catalogue rows. */
let productSlug = ''
let secondSlug = ''

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

const list = (cookie?: string) =>
  fetch(`${baseUrl}/api/account/favourites`, { headers: cookie ? { cookie } : {} })
const add = (slug: string, cookie?: string) =>
  fetch(`${baseUrl}/api/account/favourites/${encodeURIComponent(slug)}`, {
    method: 'PUT',
    headers: cookie ? { cookie } : {},
  })
const remove = (slug: string, cookie?: string) =>
  fetch(`${baseUrl}/api/account/favourites/${encodeURIComponent(slug)}`, {
    method: 'DELETE',
    headers: cookie ? { cookie } : {},
  })

beforeAll(async () => {
  await prewarmDummyHash()
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

  const hash = await argon2.hash(PASSWORD, ARGON2_OPTIONS)
  for (const [email, firstName] of [
    [ALICE, 'FavAlice'],
    [BOB, 'FavBob'],
  ] as const) {
    await prisma.user.upsert({
      where: { email },
      create: {
        email,
        firstName,
        lastName: 'Favourites',
        passwordHash: hash,
        termsAcceptedAt: new Date(),
        status: 'active',
        role: 'customer',
      },
      update: { status: 'active', passwordHash: hash },
    })
  }
  aliceId = (await prisma.user.findUniqueOrThrow({ where: { email: ALICE }, select: { id: true } })).id
  bobId = (await prisma.user.findUniqueOrThrow({ where: { email: BOB }, select: { id: true } })).id

  const products = await prisma.product.findMany({
    where: { isActive: true },
    orderBy: { slug: 'asc' },
    take: 2,
    select: { slug: true },
  })
  if (products.length < 2) throw new Error('seeded catalogue expected (need two active products)')
  productSlug = products[0]!.slug
  secondSlug = products[1]!.slug
}, 60_000)

beforeEach(async () => {
  // Each test starts with NO favourites for this file's own users.
  await prisma.favorite.deleteMany({ where: { userId: { in: [aliceId, bobId] } } })

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
  await prisma.favorite.deleteMany({ where: { userId: { in: [aliceId, bobId] } } })
  await prisma.user.deleteMany({ where: { email: { in: [ALICE, BOB] } } })
  await prisma.$disconnect()
})

describe('who may touch favourites (A10 — the ACTION is gated, never the catalogue)', () => {
  it('anonymous gets 401 on all three routes and no data', async () => {
    expect((await list()).status).toBe(401)
    expect((await add(productSlug)).status).toBe(401)
    expect((await remove(productSlug)).status).toBe(401)
  })

  it('🔴 IDOR — one shopper\'s favourite is INVISIBLE to another', async () => {
    const alice = await signIn(ALICE)
    const bob = await signIn(BOB)
    expect((await add(productSlug, alice)).status).toBe(204)

    const bobList = (await (await list(bob)).json()) as { items: { slug: string }[] }
    expect(bobList.items).toHaveLength(0)

    const aliceList = (await (await list(alice)).json()) as { items: { slug: string }[] }
    expect(aliceList.items.map((i) => i.slug)).toEqual([productSlug])
  })
})

describe('the roundtrip', () => {
  it('add → list carries the FULL catalogue card DTO → remove → empty', async () => {
    const cookie = await signIn(ALICE)
    expect((await add(productSlug, cookie)).status).toBe(204)

    const body = (await (await list(cookie)).json()) as { items: Record<string, unknown>[] }
    expect(body.items).toHaveLength(1)
    const item = body.items[0]!
    // The SAME mapper as the catalogue: a favourite can never render
    // differently from its catalogue card.
    for (const key of ['slug', 'nameHe', 'nameEn', 'price', 'stockQuantity', 'brandName', 'brandNameEn']) {
      expect(item[key], key).toBeDefined()
    }

    expect((await remove(productSlug, cookie)).status).toBe(204)
    const after = (await (await list(cookie)).json()) as { items: unknown[] }
    expect(after.items).toHaveLength(0)
  })

  it('PUT is idempotent — hearting twice is ONE favourite', async () => {
    const cookie = await signIn(ALICE)
    expect((await add(productSlug, cookie)).status).toBe(204)
    expect((await add(productSlug, cookie)).status).toBe(204)
    expect(await prisma.favorite.count({ where: { userId: aliceId } })).toBe(1)
  })

  it('DELETE is idempotent — un-hearting nothing is 204, not an error', async () => {
    const cookie = await signIn(ALICE)
    expect((await remove(productSlug, cookie)).status).toBe(204)
  })

  it('an unknown slug is 404 and stores nothing', async () => {
    const cookie = await signIn(ALICE)
    expect((await add('no-such-product-slug', cookie)).status).toBe(404)
    expect(await prisma.favorite.count({ where: { userId: aliceId } })).toBe(0)
  })

  it('newest favourite first', async () => {
    const cookie = await signIn(ALICE)
    expect((await add(productSlug, cookie)).status).toBe(204)
    expect((await add(secondSlug, cookie)).status).toBe(204)
    const body = (await (await list(cookie)).json()) as { items: { slug: string }[] }
    expect(body.items.map((i) => i.slug)).toEqual([secondSlug, productSlug])
  })
})
