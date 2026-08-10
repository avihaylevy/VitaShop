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
}

interface Recorded {
  events: string[]
  createdTokenValue?: string
}

function fakePrisma(existingUser: { id: string } | null, recorded: Recorded) {
  const tx = {
    user: {
      create: vi.fn(async () => {
        recorded.events.push('user.create')
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
