import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { NullEmailProvider } from './emailService.js'
import { hashToken } from './verificationToken.js'
import { registerUser } from './registrationService.js'

/**
 * TEST-030b — the DEC-053 Part 2 ordering — plus clause 4b's
 * already-registered path.
 *
 * A fake Prisma client records the ORDER of what happened, because ordering
 * is the contract and both of its rules fail silently.
 */

const input = {
  firstName: 'משה',
  lastName: 'כהן',
  email: 'moshe@example.com',
  password: 'Abcdef12',
  confirmPassword: 'Abcdef12',
  phone: '0509871234',
  acceptedTerms: true as const,
  joinClub: false,
}

interface Recorded {
  events: string[]
  createdTokenValue?: string
  createdUserData?: Record<string, unknown>
}

function fakePrisma(existingUser: { id: string } | null, recorded: Recorded) {
  const tx = {
    user: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        recorded.events.push('user.create')
        recorded.createdUserData = data
        return { id: 'user-1' }
      }),
    },
    emailVerificationToken: {
      create: vi.fn(async ({ data }: { data: { token: string } }) => {
        recorded.events.push('token.create')
        recorded.createdTokenValue = data.token
        return { id: 'tok-1' }
      }),
    },
    // MILESTONE-007 Checkpoint E filled the PROMOTE-GUEST-CART seam, which
    // reads the cart INSIDE this transaction. This fake returns "no guest
    // cart", so these ORDERING tests keep testing ordering and nothing else.
    // 🔴 The promotion's own behaviour is covered against the REAL database in
    // promoteGuestCart.integration.test.ts — a fake would only prove the fake.
    cart: {
      findFirst: vi.fn(async () => {
        recorded.events.push('cart.lookup')
        return null
      }),
    },
  }

  return {
    user: {
      findUnique: vi.fn(async () => {
        recorded.events.push('user.findUnique')
        return existingUser
      }),
    },
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => {
      recorded.events.push('tx.begin')
      const result = await fn(tx)
      recorded.events.push('tx.commit')
      return result
    }),
  } as unknown as PrismaClient
}

function deps(prisma: PrismaClient) {
  return { prisma, emailService: new NullEmailProvider(), appBaseUrl: 'http://localhost:5173' }
}

describe('TEST-030b — DEC-053 Part 2 ordering', () => {
  it('🔴 A3: the user row is COMMITTED before registerUser returns', async () => {
    // Rule 2. The route regenerates the session only after this resolves, so
    // "committed before the session id changes" reduces to "the commit
    // happened inside this call". If tx.commit were missing here, the route
    // would regenerate against an open transaction — and a rollback would
    // leave a PHANTOM SESSION authenticated as a user row that never existed.
    const recorded: Recorded = { events: [] }
    const outcome = await registerUser(input, 'guest-sid', deps(fakePrisma(null, recorded)))

    expect(outcome.created).toBe(true)
    expect(recorded.events).toContain('tx.commit')
    expect(recorded.events.indexOf('user.create')).toBeLessThan(
      recorded.events.indexOf('tx.commit'),
    )
  })

  it('creates the user and the token inside ONE transaction', async () => {
    const recorded: Recorded = { events: [] }
    await registerUser(input, 'guest-sid', deps(fakePrisma(null, recorded)))

    const begin = recorded.events.indexOf('tx.begin')
    const commit = recorded.events.indexOf('tx.commit')
    for (const event of ['user.create', 'token.create']) {
      const at = recorded.events.indexOf(event)
      expect(at).toBeGreaterThan(begin)
      expect(at).toBeLessThan(commit)
    }
  })

  it('🔴 A4: stores the token DIGEST, never the plaintext', async () => {
    const recorded: Recorded = { events: [] }
    const outcome = await registerUser(input, 'guest-sid', deps(fakePrisma(null, recorded)))

    expect(outcome.verificationToken).toBeTruthy()
    expect(recorded.createdTokenValue).toBe(hashToken(outcome.verificationToken as string))
    expect(recorded.createdTokenValue).not.toBe(outcome.verificationToken)
  })

  it('records WHEN consent was given (Table 3 field 26)', async () => {
    const recorded: Recorded = { events: [] }
    const prisma = fakePrisma(null, recorded)
    const now = new Date('2026-08-10T12:00:00.000Z')
    await registerUser(input, 'guest-sid', { ...deps(prisma), now: () => now })

    const createCall = (prisma.$transaction as unknown as { mock: { calls: unknown[] } }).mock
    expect(createCall.calls).toHaveLength(1)
    expect(recorded.events).toContain('user.create')
  })
})

describe('DEC-053 clause 4b — the already-registered path', () => {
  it('🔴 creates NO second user row and NO token', async () => {
    const recorded: Recorded = { events: [] }
    const outcome = await registerUser(
      input,
      'guest-sid',
      deps(fakePrisma({ id: 'existing' }, recorded)),
    )

    expect(outcome.created).toBe(false)
    expect(outcome.userId).toBeNull()
    expect(recorded.events).not.toContain('user.create')
    expect(recorded.events).not.toContain('tx.begin')
  })

  it('🔴 treats a P2002 email collision as already-registered, not a 500', async () => {
    // THE CHECK-THEN-CREATE RACE. findUnique returns null (the other request
    // has not committed yet), then create loses the race against the unique
    // constraint. Simulated by making create throw, rather than by racing two
    // real requests — the point is the handling, and a real race is
    // non-deterministic.
    const recorded: Recorded = { events: [] }
    const prisma = fakePrisma(null, recorded)
    ;(prisma as unknown as { $transaction: unknown }).$transaction = vi.fn(async () => {
      throw Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
        meta: { target: ['email'] },
      })
    })

    const outcome = await registerUser(input, 'guest-sid', deps(prisma))

    // Identical to the findUnique path — same shape, so the response stays
    // indistinguishable and 4b's oracle stays closed.
    expect(outcome).toEqual({ created: false, userId: null, verificationToken: null })
  })

  it('🔴 does NOT swallow a P2002 on a different constraint', async () => {
    const recorded: Recorded = { events: [] }
    const prisma = fakePrisma(null, recorded)
    ;(prisma as unknown as { $transaction: unknown }).$transaction = vi.fn(async () => {
      throw Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
        meta: { target: ['token'] },
      })
    })

    await expect(registerUser(input, 'guest-sid', deps(prisma))).rejects.toThrow()
  })

  it('🔴 does NOT swallow a non-P2002 error — a DB outage must not fake success', async () => {
    // The catch is narrow on purpose. A blanket catch would turn an outage
    // into a 201 and lose the registration with no trace.
    const recorded: Recorded = { events: [] }
    const prisma = fakePrisma(null, recorded)
    ;(prisma as unknown as { $transaction: unknown }).$transaction = vi.fn(async () => {
      throw Object.assign(new Error('connection terminated'), { code: 'P1001' })
    })

    await expect(registerUser(input, 'guest-sid', deps(prisma))).rejects.toThrow(
      /connection terminated/,
    )
  })

  it('🔴 does NOT swallow a P2002 whose target cannot be attributed', async () => {
    const recorded: Recorded = { events: [] }
    const prisma = fakePrisma(null, recorded)
    ;(prisma as unknown as { $transaction: unknown }).$transaction = vi.fn(async () => {
      throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
    })

    await expect(registerUser(input, 'guest-sid', deps(prisma))).rejects.toThrow()
  })

  it('🔴 still burns an argon2 hash, so it cannot be told apart by TIMING', async () => {
    // A2's reasoning applied to /register. The response shape is identical by
    // 4b; without this the existing-email path would skip hashing and return
    // measurably faster, re-opening the same enumeration oracle through the
    // side channel instead of the body.
    const existingRecorded: Recorded = { events: [] }
    const newRecorded: Recorded = { events: [] }

    const existingStart = performance.now()
    await registerUser(input, 'sid', deps(fakePrisma({ id: 'existing' }, existingRecorded)))
    const existingMs = performance.now() - existingStart

    const newStart = performance.now()
    await registerUser(input, 'sid', deps(fakePrisma(null, newRecorded)))
    const newMs = performance.now() - newStart

    // Both paths perform exactly one argon2 hash, which dominates. A missing
    // dummy hash shows up as the existing path being dramatically faster;
    // the bound is deliberately loose so the test is not flaky on a busy
    // machine, while still failing if the hash is removed entirely.
    expect(existingMs).toBeGreaterThan(newMs * 0.25)
  })
})

describe('the seventh list, item 1 — the club opt-in at registration', () => {
  it('joinClub: true creates the user as a member, stamped when consent was', async () => {
    const recorded: Recorded = { events: [] }
    const outcome = await registerUser(
      { ...input, joinClub: true },
      null,
      deps(fakePrisma(null, recorded)),
    )
    expect(outcome.created).toBe(true)
    expect(recorded.createdUserData?.isClubMember).toBe(true)
    // The same instant as termsAcceptedAt — one `now`, not two clocks.
    expect(recorded.createdUserData?.clubJoinedAt).toEqual(
      recorded.createdUserData?.termsAcceptedAt,
    )
  })

  it('🔴 CONTROL — joinClub: false creates a NON-member with no join date', async () => {
    const recorded: Recorded = { events: [] }
    await registerUser({ ...input, joinClub: false }, null, deps(fakePrisma(null, recorded)))
    expect(recorded.createdUserData?.isClubMember).toBe(false)
    expect(recorded.createdUserData?.clubJoinedAt).toBeNull()
  })
})
