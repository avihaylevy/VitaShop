import argon2 from 'argon2'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { PrismaClient, UserStatus } from '@prisma/client'
import {
  attemptLogin,
  isLocked,
  LOCKOUT_MS,
  MAX_FAILED_ATTEMPTS,
  prewarmDummyHash,
  resetDummyHashForTests,
} from './loginService.js'
import { ARGON2_OPTIONS } from './registrationService.js'

/**
 * TEST-032 — A1 (identical failure) and A2 (constant time, all three
 * branches). TEST-033 — A5 (lockout and its lazy reset).
 */

const PASSWORD = 'Abcdef12'
let passwordHash: string

beforeAll(async () => {
  passwordHash = await argon2.hash(PASSWORD, ARGON2_OPTIONS)
  // Pay the dummy-hash cost once, so the first unknown-email case in this
  // file is not artificially slow and the timing test stays honest.
  await prewarmDummyHash()
}, 30_000)

interface UserSeed {
  status?: UserStatus
  failedLoginCount?: number
  lockedUntil?: Date | null
}

function fakePrisma(user: UserSeed | null) {
  const updates: Record<string, unknown>[] = []
  const row =
    user === null
      ? null
      : {
          id: 'user-1',
          passwordHash,
          status: user.status ?? ('active' as UserStatus),
          failedLoginCount: user.failedLoginCount ?? 0,
          lockedUntil: user.lockedUntil ?? null,
        }

  return {
    updates,
    prisma: {
      user: {
        findUnique: vi.fn(async () => row),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          updates.push(data)
          return {}
        }),
      },
    } as unknown as PrismaClient,
  }
}

describe('TEST-032 — A1: every failure is indistinguishable', () => {
  it('🔴 returns an outcome carrying NO reason, on all four failing branches', async () => {
    const unknown = await attemptLogin(
      { email: 'nobody@example.com', password: PASSWORD },
      { prisma: fakePrisma(null).prisma },
    )
    const wrongPassword = await attemptLogin(
      { email: 'a@b.com', password: 'Wrongxx1' },
      { prisma: fakePrisma({}).prisma },
    )
    const locked = await attemptLogin(
      { email: 'a@b.com', password: PASSWORD },
      { prisma: fakePrisma({ lockedUntil: new Date(Date.now() + LOCKOUT_MS) }).prisma },
    )
    const disabled = await attemptLogin(
      { email: 'a@b.com', password: PASSWORD },
      { prisma: fakePrisma({ status: 'disabled' }).prisma },
    )

    // Deep equality, not just `.ok === false`: if a `reason` field is ever
    // added "for logging", the caller can leak it, so the shape is pinned.
    for (const outcome of [unknown, wrongPassword, locked, disabled]) {
      expect(outcome).toEqual({ ok: false })
    }
  })

  it('succeeds only with the right password on an unlocked, enabled account', async () => {
    const { prisma } = fakePrisma({})
    await expect(attemptLogin({ email: 'a@b.com', password: PASSWORD }, { prisma })).resolves.toEqual(
      { ok: true, userId: 'user-1' },
    )
  })
})

describe('TEST-032 — A2: all THREE branches hash before responding', () => {
  async function timeOf(seed: UserSeed | null, password: string): Promise<number> {
    const { prisma } = fakePrisma(seed)
    const started = performance.now()
    await attemptLogin({ email: 'a@b.com', password }, { prisma })
    return performance.now() - started
  }

  it('🔴 unknown email is not measurably faster than a wrong password', async () => {
    // The unknown-email branch has no user row and therefore no hash of its
    // own; without the fixed dummy it would skip verification and return
    // almost instantly, which is A1's oracle reached through timing.
    const unknownMs = await timeOf(null, PASSWORD)
    const wrongMs = await timeOf({}, 'Wrongxx1')
    expect(unknownMs).toBeGreaterThan(wrongMs * 0.25)
  })

  it('🔴 a LOCKED account is not measurably faster either', async () => {
    // The lockout check could plausibly short-circuit before hashing. It must
    // not: that would leak both that the address exists and that it is locked.
    const lockedMs = await timeOf({ lockedUntil: new Date(Date.now() + LOCKOUT_MS) }, PASSWORD)
    const wrongMs = await timeOf({}, 'Wrongxx1')
    expect(lockedMs).toBeGreaterThan(wrongMs * 0.25)
  })

  it('🔴 the dummy hash is LOAD-BEARING — it is a real argon2 hash', async () => {
    // If the constant were ever replaced with a cheap placeholder, the
    // unknown-email branch would stop costing what a real verify costs and
    // the timing tests above would silently become meaningless.
    const dummy = await prewarmDummyHash()
    expect(dummy).toMatch(/^\$argon2id\$/)
    expect(dummy).toContain('m=19456')
  })

  it('caches the dummy hash, so cost is identical after the first call', async () => {
    expect(await prewarmDummyHash()).toBe(await prewarmDummyHash())
  })

  it('🔴 a REJECTED dummy hash still yields A1s failure, not a throw', async () => {
    // THE DEFECT. `??=` cached the promise, including a rejected one, forever.
    // Only the unknown-email branch awaits it, so a single failure meant
    // unknown email 500s while a known email 401s — account enumeration by
    // STATUS CODE, in the exact branch A2 exists to equalize.
    resetDummyHashForTests()
    const hashSpy = vi.spyOn(argon2, 'hash').mockRejectedValueOnce(new Error('argon2 exploded'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const outcome = await attemptLogin(
      { email: 'nobody@example.com', password: PASSWORD },
      { prisma: fakePrisma(null).prisma },
    )

    // Identical to every other failure. No throw, no 500, no distinguishable
    // shape — and the operator still learns about it, server-side only.
    expect(outcome).toEqual({ ok: false })
    expect(errorSpy).toHaveBeenCalled()

    hashSpy.mockRestore()
    errorSpy.mockRestore()
    resetDummyHashForTests()
    await prewarmDummyHash()
  })

  it('🔴 does NOT cache the rejection — the next call retries', async () => {
    resetDummyHashForTests()
    const hashSpy = vi.spyOn(argon2, 'hash').mockRejectedValueOnce(new Error('transient'))

    await expect(prewarmDummyHash()).rejects.toThrow('transient')
    hashSpy.mockRestore()

    // A retry after a transient failure must succeed rather than replay the
    // cached rejection forever.
    await expect(prewarmDummyHash()).resolves.toMatch(/^\$argon2id\$/)
  })
})

describe('🔴 1b — a failing verify is logged, not swallowed silently', () => {
  it('returns no-match AND logs when the stored hash is corrupt', async () => {
    // Returning false is right — a verify failure must be indistinguishable
    // from a wrong password. But silence means a corrupted stored hash locks
    // that user out permanently with no signal anywhere.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { prisma } = fakePrisma({})
    const verifySpy = vi
      .spyOn(argon2, 'verify')
      .mockRejectedValueOnce(new Error('pchstr must contain a $ as first char'))

    const outcome = await attemptLogin({ email: 'a@b.com', password: PASSWORD }, { prisma })

    expect(outcome).toEqual({ ok: false })
    expect(errorSpy).toHaveBeenCalled()

    verifySpy.mockRestore()
    errorSpy.mockRestore()
  })
})

describe('TEST-033 — A5: lockout after five attempts', () => {
  it('does not lock before the fifth failure', async () => {
    const { prisma, updates } = fakePrisma({ failedLoginCount: 3 })
    await attemptLogin({ email: 'a@b.com', password: 'Wrongxx1' }, { prisma })
    expect(updates[0]).toEqual({ failedLoginCount: 4, lockedUntil: null })
  })

  it('🔴 the FIFTH failure locks, for fifteen minutes', async () => {
    const now = new Date('2026-08-10T12:00:00.000Z')
    const { prisma, updates } = fakePrisma({ failedLoginCount: MAX_FAILED_ATTEMPTS - 1 })
    await attemptLogin({ email: 'a@b.com', password: 'Wrongxx1' }, { prisma, now: () => now })

    expect(updates[0]?.failedLoginCount).toBe(5)
    expect((updates[0]?.lockedUntil as Date).getTime()).toBe(now.getTime() + LOCKOUT_MS)
    expect(LOCKOUT_MS).toBe(15 * 60 * 1000)
  })

  it('rejects a sixth attempt during the window — even with the RIGHT password', async () => {
    const now = new Date('2026-08-10T12:00:00.000Z')
    const { prisma, updates } = fakePrisma({
      failedLoginCount: 5,
      lockedUntil: new Date(now.getTime() + LOCKOUT_MS),
    })
    const outcome = await attemptLogin(
      { email: 'a@b.com', password: PASSWORD },
      { prisma, now: () => now },
    )

    expect(outcome).toEqual({ ok: false })
    // A locked account is not counted against further: the lock already holds.
    expect(updates).toEqual([])
  })

  it('🔴 after expiry the counter is RESET — a full five attempts, not one', async () => {
    // The defect this pins: without the lazy reset the counter stays at 5, so
    // the first failure after the window re-locks instantly and the user has
    // a permanent one-strike account.
    const now = new Date('2026-08-10T12:30:00.000Z')
    const { prisma, updates } = fakePrisma({
      failedLoginCount: 5,
      lockedUntil: new Date('2026-08-10T12:15:00.000Z'), // expired
    })

    await attemptLogin({ email: 'a@b.com', password: 'Wrongxx1' }, { prisma, now: () => now })

    // First write: the lazy reset. Second: this attempt counted as #1.
    expect(updates[0]).toEqual({ failedLoginCount: 0, lockedUntil: null })
    expect(updates[1]).toEqual({ failedLoginCount: 1, lockedUntil: null })
  })

  it('a correct password after expiry succeeds and clears the counters', async () => {
    const now = new Date('2026-08-10T12:30:00.000Z')
    const { prisma, updates } = fakePrisma({
      failedLoginCount: 5,
      lockedUntil: new Date('2026-08-10T12:15:00.000Z'),
    })

    const outcome = await attemptLogin(
      { email: 'a@b.com', password: PASSWORD },
      { prisma, now: () => now },
    )

    expect(outcome).toEqual({ ok: true, userId: 'user-1' })
    expect(updates.at(-1)).toEqual({ failedLoginCount: 0, lockedUntil: null })
  })

  it('resets the counter on a successful login', async () => {
    const { prisma, updates } = fakePrisma({ failedLoginCount: 2 })
    await attemptLogin({ email: 'a@b.com', password: PASSWORD }, { prisma })
    expect(updates.at(-1)).toEqual({ failedLoginCount: 0, lockedUntil: null })
  })
})

describe('A5 — isLocked is the single source of truth (DEC-024)', () => {
  const now = new Date('2026-08-10T12:00:00.000Z')

  it('is false when lockedUntil is null', () => {
    expect(isLocked({ lockedUntil: null }, now)).toBe(false)
  })

  it('is true only while the timestamp is in the future', () => {
    expect(isLocked({ lockedUntil: new Date(now.getTime() + 1) }, now)).toBe(true)
    expect(isLocked({ lockedUntil: now }, now)).toBe(false)
    expect(isLocked({ lockedUntil: new Date(now.getTime() - 1) }, now)).toBe(false)
  })
})
