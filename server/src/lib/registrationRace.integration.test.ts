import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isUniqueViolationOn } from './prismaUniqueViolation.js'

/**
 * 🔴 THE REAL COLLISION. A synthetic error is what hid this defect for a whole
 * milestone: `registrationService.test.ts` threw a hand-built object carrying
 * `meta: { target: ['email'] }` — the field the pg driver adapter NEVER SETS —
 * so the matcher passed its test while returning false against every real
 * duplicate. See ISSUE-067.
 *
 * These tests provoke a genuine duplicate insert through the real client, so
 * they fail if the adapter's error shape ever changes again.
 */

let prisma: PrismaClient
const EMAIL = 'zz-racetest-duplicate@example.test'

async function wipe() {
  await prisma.user.deleteMany({ where: { email: EMAIL } })
}

const userData = () => ({
  firstName: 'race',
  lastName: 'test',
  email: EMAIL,
  passwordHash: 'x',
  termsAcceptedAt: new Date(),
})

beforeAll(async () => {
  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  })
  await wipe()
})

afterAll(async () => {
  await wipe()
  await prisma.$disconnect()
})

describe('the duplicate-email P2002, as the database actually raises it', () => {
  it('🔴 is RECOGNISED by the shared matcher — the defect ISSUE-067 records', async () => {
    await wipe()
    await prisma.user.create({ data: userData() })

    let caught: unknown = null
    try {
      await prisma.user.create({ data: userData() })
    } catch (error) {
      caught = error
    }

    expect(caught, 'the database must reject the duplicate').not.toBeNull()
    // Before the fix this returned FALSE, so registration rethrew and the
    // race-loser answered 500 where clause 4b answers 201 — an enumeration
    // oracle, in the control written to close one.
    expect(isUniqueViolationOn(caught, ['email', 'users_email_key'])).toBe(true)
  })

  it('🔴 the adapter really does NOT set meta.target — the shape that broke it', async () => {
    await wipe()
    await prisma.user.create({ data: userData() })

    let caught: { meta?: { target?: unknown } } | null = null
    try {
      await prisma.user.create({ data: userData() })
    } catch (error) {
      caught = error as { meta?: { target?: unknown } }
    }

    // Pinned deliberately. If a future Prisma or adapter starts setting
    // `target`, this fails and someone re-reads the matcher on purpose rather
    // than discovering the divergence through a security defect.
    expect(caught?.meta?.target).toBeUndefined()
  })

  it('🔴 STAYS NARROW — a different constraint is NOT swallowed', async () => {
    await wipe()
    await prisma.user.create({ data: userData() })

    let caught: unknown = null
    try {
      await prisma.user.create({ data: userData() })
    } catch (error) {
      caught = error
    }

    // The email violation must not match some other constraint's name. A broad
    // catch turns a database outage into a fake success and loses the
    // registration silently — worse than the 500 it replaces.
    expect(isUniqueViolationOn(caught, ['carts_session_id_key'])).toBe(false)
    // A field name is listed WITH its constraint name, as every real caller
    // does — under adapter-pg 7.10 the driver reports only the constraint
    // name, and a bare field list is a misuse the matcher refuses loudly
    // (prismaUniqueViolation.test.ts pins that), not a quiet false.
    expect(isUniqueViolationOn(caught, ['phone', 'users_phone_key'])).toBe(false)
  })

  it('a non-P2002 error is never matched', () => {
    expect(isUniqueViolationOn({ code: 'P2025', meta: {} }, ['email'])).toBe(false)
    expect(isUniqueViolationOn(new Error('boom'), ['email'])).toBe(false)
    expect(isUniqueViolationOn(null, ['email'])).toBe(false)
  })
})
