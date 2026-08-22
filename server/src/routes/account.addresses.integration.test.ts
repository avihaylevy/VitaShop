import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import argon2 from 'argon2'
import express from 'express'
import type { Server } from 'node:http'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createAccountRouter } from './account.js'
import { createAuthRouter } from './auth.js'
import { createAccountRateLimiters, createAuthRateLimiters } from '../lib/rateLimit.js'
import { ARGON2_OPTIONS } from '../lib/registrationService.js'
import { prewarmDummyHash } from '../lib/loginService.js'
import { createSessionMiddleware } from '../lib/session.js'
import { NullEmailProvider } from '../lib/emailService.js'
import { ADDRESS_CAP } from '../lib/addressBook.js'

/**
 * MILESTONE-009 Checkpoint A — the profile edit + the address book, over
 * the wire.
 *
 * 🔴 THE SUBJECTS: the guard (401), the IDOR scope (a foreign id is a 404
 * and NOTHING changes), the cap's named refusal, default EXCLUSIVITY, the
 * delete-promotes-heir rule, and the live seam — a new default reaches the
 * very next GET /profile prefill read.
 */

let prisma: PrismaClient
let server: Server
let baseUrl: string

const OWNER = 'zz-addrbook-owner@example.test'
const OTHER = 'zz-addrbook-other@example.test'
const PASSWORD = 'Abcdef12xyz'

let ownerId = ''
let otherId = ''

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

function api(path: string, init: { method?: string; cookie?: string; body?: unknown } = {}) {
  return fetch(`${baseUrl}/api/account${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(init.cookie ? { cookie: init.cookie } : {}),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  })
}

const ADDRESS = { line1: 'רחוב הספר 1', city: 'תל אביב', zipCode: '6100000' }

async function wipeAddresses(): Promise<void> {
  await prisma.address.deleteMany({ where: { userId: { in: [ownerId, otherId] } } })
}

beforeAll(async () => {
  await prewarmDummyHash()
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const hash = await argon2.hash(PASSWORD, ARGON2_OPTIONS)
  for (const email of [OWNER, OTHER]) {
    await prisma.user.upsert({
      where: { email },
      create: {
        email,
        firstName: 'ספר',
        lastName: 'כתובות',
        phone: '0501112222',
        passwordHash: hash,
        termsAcceptedAt: new Date(),
        status: 'active',
        role: 'customer',
      },
      update: {
        status: 'active',
        role: 'customer',
        passwordHash: hash,
        firstName: 'ספר',
        lastName: 'כתובות',
        phone: '0501112222',
      },
      select: { id: true },
    })
  }
  ownerId = (await prisma.user.findUniqueOrThrow({ where: { email: OWNER }, select: { id: true } })).id
  otherId = (await prisma.user.findUniqueOrThrow({ where: { email: OTHER }, select: { id: true } })).id
  await wipeAddresses()
}, 60_000)

beforeEach(async () => {
  const app = express()
  app.use(express.json())
  app.use(createSessionMiddleware())
  app.use('/api/account', createAccountRouter({ prisma, rateLimiters: createAccountRateLimiters() }))
  app.use(
    '/api',
    createAuthRouter({
      prisma,
      emailService: new NullEmailProvider(),
      appBaseUrl: 'http://127.0.0.1',
      rateLimiters: createAuthRateLimiters(),
    }),
  )
  await new Promise<void>((r) => {
    server = app.listen(0, () => r())
  })
  const a = server.address()
  if (!a || typeof a === 'string') throw new Error('no ephemeral port')
  baseUrl = `http://127.0.0.1:${a.port}`
  await wipeAddresses()
})

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()))
  await wipeAddresses()
})

afterAll(async () => {
  try {
    await wipeAddresses()
    await prisma.user.deleteMany({ where: { email: { in: [OWNER, OTHER] } } })
  } finally {
    await prisma.$disconnect()
  }
})

describe('🔴 the guard', () => {
  it('anonymous is 401 on every new route', async () => {
    expect((await api('/profile', { method: 'PATCH', body: {} })).status).toBe(401)
    expect((await api('/addresses')).status).toBe(401)
    expect((await api('/addresses', { method: 'POST', body: ADDRESS })).status).toBe(401)
    expect((await api('/addresses/x', { method: 'PATCH', body: ADDRESS })).status).toBe(401)
    expect((await api('/addresses/x', { method: 'DELETE' })).status).toBe(401)
    expect((await api('/addresses/x/default', { method: 'PUT' })).status).toBe(401)
  })
})

describe('the profile edit (REQ-F-051)', () => {
  it('updates name + phone (normalised), and the very next GET reflects it', async () => {
    const cookie = await signIn(OWNER)
    const r = await api('/profile', {
      method: 'PATCH',
      cookie,
      body: { firstName: 'משה', lastName: 'לוי', phone: '052-1234567' },
    })
    expect(r.status).toBe(200)

    const read = await api('/profile', { cookie })
    const body = (await read.json()) as { firstName: string; lastName: string; phone: string }
    expect(body.firstName).toBe('משה')
    expect(body.lastName).toBe('לוי')
    // Stored dash-free — the registration form's own normalisation.
    expect(body.phone).toBe('0521234567')
  })

  it('🔴 refusals carry named codes; an UNKNOWN key is refused by strictness; a MALFORMED email is EMAIL_INVALID', async () => {
    /*
     * ⚠️ AMENDED in the hundred-sixth pass. The original probe PATCHed a
     * VALID email expecting DEC-090 O2's strictness refusal — but ISSUE-173
     * (user-approved amendment) made `email` a legal field, so the "refusal"
     * probe started SUCCEEDING and silently ROTATED the fixture owner's
     * sign-in email, 401-ing every later signIn(OWNER) in this file: one
     * stale pin took six healthy tests down with it. The strictness half now
     * probes a key that is still unknown; the email half pins the NEW
     * contract's refusal (malformed → EMAIL_INVALID, row untouched). The
     * accept path lives in account.integration.test.ts (ISSUE-173's tests).
     * The rotated residue row this bug left behind (new@example.test) was
     * removed the same day per DEC-063 — 0 addresses, 0 orders, fixture-born.
     */
    const cookie = await signIn(OWNER)
    const bad = await api('/profile', {
      method: 'PATCH',
      cookie,
      body: { firstName: '', lastName: 'x', phone: '123' },
    })
    expect(bad.status).toBe(400)
    const codes = ((await bad.json()) as { error: { codes: string[] } }).error.codes
    expect(codes).toContain('FIRST_NAME_REQUIRED')
    expect(codes).toContain('PHONE_INVALID')

    // Strictness still holds for keys the schema does not know.
    const unknown = await api('/profile', {
      method: 'PATCH',
      cookie,
      body: { firstName: 'א', lastName: 'ב', phone: '0521234567', role: 'admin' },
    })
    expect(unknown.status).toBe(400)

    // A malformed email is refused by the field's own rule, not strictness.
    const email = await api('/profile', {
      method: 'PATCH',
      cookie,
      body: { firstName: 'א', lastName: 'ב', phone: '0521234567', email: 'not-an-email' },
    })
    expect(email.status).toBe(400)
    const emailCodes = ((await email.json()) as { error: { codes: string[] } }).error.codes
    expect(emailCodes).toContain('EMAIL_INVALID')

    // Nothing changed on any refusal — the sign-in identity above all.
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: ownerId },
      select: { email: true },
    })
    expect(row.email).toBe(OWNER)
  })
})

describe('the address book', () => {
  it('add → list (default first) → the FIRST row is the default', async () => {
    const cookie = await signIn(OWNER)
    const first = await api('/addresses', { method: 'POST', cookie, body: ADDRESS })
    expect(first.status).toBe(201)
    const second = await api('/addresses', {
      method: 'POST',
      cookie,
      body: { line1: 'שדרות הים 2', city: 'חיפה' },
    })
    expect(second.status).toBe(201)

    const list = (await (await api('/addresses', { cookie })).json()) as {
      addresses: { line1: string; isDefault: boolean }[]
      cap: number
    }
    expect(list.cap).toBe(ADDRESS_CAP)
    expect(list.addresses).toHaveLength(2)
    expect(list.addresses[0]!.isDefault).toBe(true)
    expect(list.addresses[0]!.line1).toBe('רחוב הספר 1')
  })

  it('🔴 the cap refuses the sixth with its NAMED code', async () => {
    const cookie = await signIn(OWNER)
    for (let i = 0; i < ADDRESS_CAP; i++) {
      const r = await api('/addresses', {
        method: 'POST',
        cookie,
        body: { line1: `רחוב ${i + 1}`, city: 'תל אביב' },
      })
      expect(r.status).toBe(201)
    }
    const sixth = await api('/addresses', {
      method: 'POST',
      cookie,
      body: { line1: 'רחוב 6', city: 'תל אביב' },
    })
    expect(sixth.status).toBe(400)
    expect(((await sixth.json()) as { error: { code: string } }).error.code).toBe(
      'ADDRESS_CAP_REACHED',
    )
  })

  it('🔴 IDOR — a foreign id is a 404 on PATCH/DELETE/default, and NOTHING changes', async () => {
    const ownerCookie = await signIn(OWNER)
    const created = await api('/addresses', { method: 'POST', cookie: ownerCookie, body: ADDRESS })
    const { address } = (await created.json()) as { address: { id: string } }

    const otherCookie = await signIn(OTHER)
    expect(
      (
        await api(`/addresses/${address.id}`, {
          method: 'PATCH',
          cookie: otherCookie,
          body: { line1: 'גנוב', city: 'גנובה' },
        })
      ).status,
    ).toBe(404)
    expect((await api(`/addresses/${address.id}`, { method: 'DELETE', cookie: otherCookie })).status).toBe(404)
    expect(
      (await api(`/addresses/${address.id}/default`, { method: 'PUT', cookie: otherCookie })).status,
    ).toBe(404)

    // 🔴 Asserted against the DATABASE.
    const row = await prisma.address.findUniqueOrThrow({
      where: { id: address.id },
      select: { line1: true, userId: true },
    })
    expect(row.line1).toBe('רחוב הספר 1')
    expect(row.userId).toBe(ownerId)
  })

  it('🔴 the default is EXCLUSIVE, and the switch reaches the very next profile prefill read', async () => {
    const cookie = await signIn(OWNER)
    await api('/addresses', { method: 'POST', cookie, body: ADDRESS })
    const second = await api('/addresses', {
      method: 'POST',
      cookie,
      body: { line1: 'שדרות הים 2', city: 'חיפה' },
    })
    const { address: newDefault } = (await second.json()) as { address: { id: string } }

    expect((await api(`/addresses/${newDefault.id}/default`, { method: 'PUT', cookie })).status).toBe(200)

    // Exclusivity, from the DB: exactly one default row.
    const defaults = await prisma.address.findMany({
      where: { userId: ownerId, isDefault: true },
      select: { line1: true },
    })
    expect(defaults).toHaveLength(1)
    expect(defaults[0]!.line1).toBe('שדרות הים 2')

    // The live seam: checkout's prefill (GET /profile) answers the NEW one.
    const profile = (await (await api('/profile', { cookie })).json()) as {
      defaultAddress: { line1: string } | null
    }
    expect(profile.defaultAddress?.line1).toBe('שדרות הים 2')
  })

  it('deleting the DEFAULT promotes the newest remaining row', async () => {
    const cookie = await signIn(OWNER)
    const first = await api('/addresses', { method: 'POST', cookie, body: ADDRESS })
    const { address: original } = (await first.json()) as { address: { id: string } }
    await api('/addresses', { method: 'POST', cookie, body: { line1: 'ב', city: 'חיפה' } })
    const third = await api('/addresses', {
      method: 'POST',
      cookie,
      body: { line1: 'ג', city: 'אילת' },
    })
    expect(third.status).toBe(201)

    expect((await api(`/addresses/${original.id}`, { method: 'DELETE', cookie })).status).toBe(200)

    const defaults = await prisma.address.findMany({
      where: { userId: ownerId, isDefault: true },
      select: { line1: true },
    })
    expect(defaults).toHaveLength(1)
    // The NEWEST remaining row ('ג'), not the oldest.
    expect(defaults[0]!.line1).toBe('ג')
  })

  it('a bad address carries named codes', async () => {
    const cookie = await signIn(OWNER)
    const r = await api('/addresses', { method: 'POST', cookie, body: { line1: '', city: '' } })
    expect(r.status).toBe(400)
    const codes = ((await r.json()) as { error: { codes: string[] } }).error.codes
    expect(codes).toContain('LINE1_REQUIRED')
    expect(codes).toContain('CITY_REQUIRED')
  })
})
