import argon2 from 'argon2'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { PrismaClient, UserStatus } from '@prisma/client'
import { NullEmailProvider } from './emailService.js'
import {
  buildPasswordResetEmail,
  completePasswordReset,
  requestPasswordReset,
} from './passwordResetService.js'
import { ARGON2_OPTIONS } from './registrationService.js'
import * as sessionInvalidation from './sessionInvalidation.js'
import {
  hashToken,
  PASSWORD_RESET_TOKEN_TTL_MS,
  VERIFICATION_TOKEN_TTL_MS,
} from './verificationToken.js'

/** TEST-034 — password reset. REQ-F-032 · A3 · A4 · A8. */

beforeAll(async () => {
  // Warm argon2 so the first timing measurement is not the outlier.
  await argon2.hash('warmup', ARGON2_OPTIONS)
}, 30_000)

interface Recorded {
  createdToken?: string
  updates: Record<string, unknown>[]
  events: string[]
}

function fakePrisma(
  user: { id: string; status?: UserStatus } | null,
  recorded: Recorded,
  tokenRow?: { expiresAt?: Date; usedAt?: Date | null; status?: UserStatus } | null,
) {
  return {
    user: { findUnique: vi.fn(async () => (user ? { ...user, status: user.status ?? 'active' } : null)) },
    passwordResetToken: {
      create: vi.fn(async ({ data }: { data: { token: string } }) => {
        recorded.createdToken = data.token
        return {}
      }),
      findUnique: vi.fn(async () =>
        tokenRow === null || tokenRow === undefined
          ? null
          : {
              id: 'reset-1',
              userId: 'user-1',
              expiresAt: tokenRow.expiresAt ?? new Date(Date.now() + 60_000),
              usedAt: tokenRow.usedAt ?? null,
              user: { email: 'a@b.com', status: tokenRow.status ?? 'active' },
            },
      ),
    },
    $transaction: vi.fn(async (fn: (client: unknown) => Promise<unknown>) => {
      recorded.events.push('tx.begin')
      const result = await fn({
        passwordResetToken: {
          update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
            recorded.updates.push({ token: data })
            return {}
          }),
        },
        user: {
          update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
            recorded.updates.push({ user: data })
            return {}
          }),
        },
      })
      recorded.events.push('tx.commit')
      return result
    }),
  } as unknown as PrismaClient
}

function deps(prisma: PrismaClient) {
  return { prisma, emailService: new NullEmailProvider(), appBaseUrl: 'http://localhost:5173' }
}

describe('TEST-034 — A3: the request is indistinguishable', () => {
  it('🔴 returns the same shape for a known and an unknown address', async () => {
    const knownRec: Recorded = { updates: [], events: [] }
    const unknownRec: Recorded = { updates: [], events: [] }

    const known = await requestPasswordReset('a@b.com', deps(fakePrisma({ id: 'user-1' }, knownRec)))
    const unknown = await requestPasswordReset('nobody@b.com', deps(fakePrisma(null, unknownRec)))

    // The route returns the same body for both; these internals differ only
    // so the route knows whether to send mail. They must never be surfaced.
    expect(known.userExists).toBe(true)
    expect(unknown.userExists).toBe(false)
    expect(unknown.plaintextToken).toBeNull()
  })

  it('🔴 the unknown path is not measurably faster — A2 applied to A3', async () => {
    const rec: Recorded = { updates: [], events: [] }

    const knownStart = performance.now()
    await requestPasswordReset('a@b.com', deps(fakePrisma({ id: 'user-1' }, rec)))
    const knownMs = performance.now() - knownStart

    const unknownStart = performance.now()
    await requestPasswordReset('nobody@b.com', deps(fakePrisma(null, rec)))
    const unknownMs = performance.now() - unknownStart

    // Without the burned hash the unknown path returns almost instantly and
    // A3's identical body is undone by the clock.
    expect(unknownMs).toBeGreaterThan(knownMs * 0.25)
  })

  it('🔴 a DISABLED account gets no link, and looks identical', async () => {
    const rec: Recorded = { updates: [], events: [] }
    const outcome = await requestPasswordReset(
      'a@b.com',
      deps(fakePrisma({ id: 'user-1', status: 'disabled' }, rec)),
    )

    // Sending one would let a disabled user walk back to a working credential.
    expect(outcome.userExists).toBe(false)
    expect(outcome.plaintextToken).toBeNull()
    expect(rec.createdToken).toBeUndefined()
  })

  it('normalises the address the same way registration stored it', async () => {
    const rec: Recorded = { updates: [], events: [] }
    const outcome = await requestPasswordReset('  A@B.COM ', deps(fakePrisma({ id: 'user-1' }, rec)))
    expect(outcome.email).toBe('a@b.com')
  })
})

describe('TEST-034 — A4: the reset token at rest', () => {
  it('🔴 stores a SHA-256 DIGEST, never the plaintext', async () => {
    const rec: Recorded = { updates: [], events: [] }
    const outcome = await requestPasswordReset('a@b.com', deps(fakePrisma({ id: 'user-1' }, rec)))

    expect(outcome.plaintextToken).toBeTruthy()
    expect(rec.createdToken).toBe(hashToken(outcome.plaintextToken as string))
    expect(rec.createdToken).not.toBe(outcome.plaintextToken)
  })

  it('🔴 expires in ONE hour — shorter than verification, on purpose', async () => {
    // A reset link grants account takeover; a verification link only confirms
    // an address. The windows should not be equal.
    expect(PASSWORD_RESET_TOKEN_TTL_MS).toBe(60 * 60 * 1000)
    expect(PASSWORD_RESET_TOKEN_TTL_MS).toBeLessThan(VERIFICATION_TOKEN_TTL_MS)
  })

  it('refuses an expired token', async () => {
    const rec: Recorded = { updates: [], events: [] }
    const prisma = fakePrisma({ id: 'user-1' }, rec, { expiresAt: new Date(Date.now() - 1) })
    await expect(completePasswordReset('tok', 'Abcdef12', deps(prisma))).resolves.toEqual({
      ok: false,
    })
  })

  it('refuses an already-used token — single use', async () => {
    const rec: Recorded = { updates: [], events: [] }
    const prisma = fakePrisma({ id: 'user-1' }, rec, { usedAt: new Date() })
    await expect(completePasswordReset('tok', 'Abcdef12', deps(prisma))).resolves.toEqual({
      ok: false,
    })
  })

  it('refuses an unknown token', async () => {
    const rec: Recorded = { updates: [], events: [] }
    const prisma = fakePrisma({ id: 'user-1' }, rec, null)
    await expect(completePasswordReset('tok', 'Abcdef12', deps(prisma))).resolves.toEqual({
      ok: false,
    })
  })

  it('refuses a token belonging to a disabled account', async () => {
    const rec: Recorded = { updates: [], events: [] }
    const prisma = fakePrisma({ id: 'user-1' }, rec, { status: 'disabled' })
    await expect(completePasswordReset('tok', 'Abcdef12', deps(prisma))).resolves.toEqual({
      ok: false,
    })
  })
})

describe('TEST-034 — completing the reset', () => {
  it('spends the token and writes a NEW argon2 hash', async () => {
    const rec: Recorded = { updates: [], events: [] }
    const spy = vi.spyOn(sessionInvalidation, 'invalidateUserSessions').mockResolvedValue(0)

    const outcome = await completePasswordReset('tok', 'Newpass12', deps(fakePrisma({ id: 'user-1' }, rec, {})))

    expect(outcome.ok).toBe(true)
    const tokenUpdate = rec.updates.find((u) => 'token' in u)?.token as Record<string, unknown>
    const userUpdate = rec.updates.find((u) => 'user' in u)?.user as Record<string, unknown>
    expect(tokenUpdate.usedAt).toBeInstanceOf(Date)
    expect(String(userUpdate.passwordHash)).toMatch(/^\$argon2id\$/)
    spy.mockRestore()
  })

  it('🔴 CLEARS the lockout — A5. A reset must not leave the user locked out', async () => {
    const rec: Recorded = { updates: [], events: [] }
    const spy = vi.spyOn(sessionInvalidation, 'invalidateUserSessions').mockResolvedValue(0)

    await completePasswordReset('tok', 'Newpass12', deps(fakePrisma({ id: 'user-1' }, rec, {})))

    // Otherwise the victim of a brute-force stays locked out by the attack
    // they just recovered from.
    const userUpdate = rec.updates.find((u) => 'user' in u)?.user as Record<string, unknown>
    expect(userUpdate.failedLoginCount).toBe(0)
    expect(userUpdate.lockedUntil).toBeNull()
    spy.mockRestore()
  })
})

describe('TEST-034 — A8: sessions are destroyed on a successful reset', () => {
  it('🔴 invalidates EVERY session, including the acting one', async () => {
    const rec: Recorded = { updates: [], events: [] }
    const spy = vi.spyOn(sessionInvalidation, 'invalidateUserSessions').mockResolvedValue(3)

    const outcome = await completePasswordReset(
      'tok',
      'Newpass12',
      deps(fakePrisma({ id: 'user-1' }, rec, {})),
    )

    expect(spy).toHaveBeenCalledOnce()
    // 🔴 The frozen decision: no exceptSid. Sparing "the acting session" only
    // helps whoever is doing the reset, and the threat model for a reset is
    // that someone else already has access.
    const [userId, options] = spy.mock.calls[0] as [string, Record<string, unknown>]
    expect(userId).toBe('user-1')
    expect(options.exceptSid).toBeUndefined()
    expect(outcome).toMatchObject({ ok: true, sessionsDestroyed: 3 })
    spy.mockRestore()
  })

  it('🔴 invalidates AFTER the commit, never inside the transaction', async () => {
    const rec: Recorded = { updates: [], events: [] }
    const spy = vi
      .spyOn(sessionInvalidation, 'invalidateUserSessions')
      .mockImplementation(async () => {
        rec.events.push('invalidate')
        return 0
      })

    await completePasswordReset('tok', 'Newpass12', deps(fakePrisma({ id: 'user-1' }, rec, {})))

    // The session table is not Prisma's to roll back — the same reasoning as
    // DEC-053 Rule 2. A failure here must not undo the new password, or the
    // user is left unable to log in with either credential.
    expect(rec.events.indexOf('invalidate')).toBeGreaterThan(rec.events.indexOf('tx.commit'))
    spy.mockRestore()
  })

  it('does not invalidate anything when the reset fails', async () => {
    const rec: Recorded = { updates: [], events: [] }
    const spy = vi.spyOn(sessionInvalidation, 'invalidateUserSessions').mockResolvedValue(0)
    await completePasswordReset('tok', 'Newpass12', deps(fakePrisma({ id: 'user-1' }, rec, null)))
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('DEC-054 — the reset email uses the string module', () => {
  it('builds the link and takes the wording from emailStrings', () => {
    const mail = buildPasswordResetEmail('http://localhost:5173/', 'the-token')
    expect(mail.body).toContain('http://localhost:5173/reset-password?token=the-token')
    expect(mail.subject).toContain('VitaShop')
    // Hebrew-only for M-006, per DEC-054.
    expect(mail.subject).toMatch(/[֐-׿]/)
  })
})
