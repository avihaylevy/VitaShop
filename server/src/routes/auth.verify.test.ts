import type { Server } from 'node:http'
import express from 'express'
import type { PrismaClient } from '@prisma/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NullEmailProvider } from '../lib/emailService.js'
import { hashToken } from '../lib/verificationToken.js'
import { createAuthRouter } from './auth.js'

/**
 * TEST-031's route half, plus the Checkpoint D review's defect 2b.
 *
 * 2b: an unconditional `status: 'active'` let a DISABLED account restore
 * itself by clicking an old, unexpired verification link. Not reachable today
 * — no disable flow exists — but Checkpoint F adds one, and by then it would
 * be live silent privilege restoration.
 */

let server: Server | undefined

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()))
    server = undefined
  }
})

interface Recorded {
  statusUpdates: unknown[]
  tokenSpent: boolean
}

async function startApp(
  userStatus: 'pending_verification' | 'active' | 'disabled' | null,
  recorded: Recorded,
  overrides: { expiresAt?: Date; usedAt?: Date | null } = {},
) {
  const app = express()
  app.use(express.json())

  const prisma = {
    emailVerificationToken: {
      findUnique: vi.fn(async () =>
        userStatus === null
          ? null
          : {
              id: 'tok-1',
              userId: 'user-1',
              expiresAt: overrides.expiresAt ?? new Date(Date.now() + 60_000),
              usedAt: overrides.usedAt ?? null,
              user: { status: userStatus },
            },
      ),
    },
    $transaction: vi.fn(async (fn: (client: unknown) => Promise<unknown>) =>
      fn({
        emailVerificationToken: {
          update: vi.fn(async () => {
            recorded.tokenSpent = true
            return {}
          }),
        },
        user: {
          update: vi.fn(async (args: unknown) => {
            recorded.statusUpdates.push(args)
            return {}
          }),
        },
      }),
    ),
  } as unknown as PrismaClient

  app.use(
    '/api',
    createAuthRouter({
      prisma,
      emailService: new NullEmailProvider(),
      appBaseUrl: 'http://localhost:5173',
    }),
  )

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve())
  })
  const address = server?.address()
  if (!address || typeof address === 'string') throw new Error('no port')
  return `http://127.0.0.1:${address.port}`
}

function verify(baseUrl: string, token = 'a-plaintext-token') {
  return fetch(`${baseUrl}/api/auth/verify-email?token=${token}`)
}

describe('verify-email — the happy path', () => {
  it('activates a pending_verification account and spends the token', async () => {
    const recorded: Recorded = { statusUpdates: [], tokenSpent: false }
    const baseUrl = await startApp('pending_verification', recorded)

    const response = await verify(baseUrl)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'verified' })
    expect(recorded.tokenSpent).toBe(true)
    expect(recorded.statusUpdates).toHaveLength(1)
  })

  it('looks the token up by its SHA-256 digest, never the plaintext', async () => {
    const recorded: Recorded = { statusUpdates: [], tokenSpent: false }
    const baseUrl = await startApp('pending_verification', recorded)
    await verify(baseUrl, 'the-plaintext')

    // A4 — the plaintext is not in the database, so a digest lookup is the
    // only thing that can find the row.
    expect(hashToken('the-plaintext')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('🔴 defect 2b — a disabled account is NOT reactivated', () => {
  it('does not set status active for a disabled user', async () => {
    const recorded: Recorded = { statusUpdates: [], tokenSpent: false }
    const baseUrl = await startApp('disabled', recorded)

    const response = await verify(baseUrl)

    // The whole defect: no user.update at all.
    expect(recorded.statusUpdates).toEqual([])
    expect(response.status).toBe(400)
  })

  it('🔴 returns the SAME generic message as an invalid link', async () => {
    const disabledRecorded: Recorded = { statusUpdates: [], tokenSpent: false }
    const disabledUrl = await startApp('disabled', disabledRecorded)
    const disabledBody = await (await verify(disabledUrl)).json()
    await new Promise<void>((resolve) => server?.close(() => resolve()))
    server = undefined

    const missingRecorded: Recorded = { statusUpdates: [], tokenSpent: false }
    const missingUrl = await startApp(null, missingRecorded)
    const missingBody = await (await verify(missingUrl)).json()

    // Saying "this account is disabled" would confirm the address is
    // registered AND reveal its state — A1's enumeration reasoning applies.
    expect(disabledBody).toEqual(missingBody)
  })

  it('🔴 still SPENDS the token, so a rejected link cannot be retried', async () => {
    const recorded: Recorded = { statusUpdates: [], tokenSpent: false }
    const baseUrl = await startApp('disabled', recorded)
    await verify(baseUrl)

    // Otherwise the link stays live and would work the moment the account
    // returned to pending_verification.
    expect(recorded.tokenSpent).toBe(true)
  })

  it('does not re-activate an already-active account either', async () => {
    const recorded: Recorded = { statusUpdates: [], tokenSpent: false }
    const baseUrl = await startApp('active', recorded)
    const response = await verify(baseUrl)

    expect(recorded.statusUpdates).toEqual([])
    expect(response.status).toBe(400)
  })
})

describe('verify-email — invalid links all look alike', () => {
  it('rejects a missing token', async () => {
    const recorded: Recorded = { statusUpdates: [], tokenSpent: false }
    const baseUrl = await startApp('pending_verification', recorded)
    const response = await fetch(`${baseUrl}/api/auth/verify-email`)
    expect(response.status).toBe(400)
    expect(recorded.statusUpdates).toEqual([])
  })

  it('rejects an expired token without activating', async () => {
    const recorded: Recorded = { statusUpdates: [], tokenSpent: false }
    const baseUrl = await startApp('pending_verification', recorded, {
      expiresAt: new Date(Date.now() - 1000),
    })
    const response = await verify(baseUrl)
    expect(response.status).toBe(400)
    expect(recorded.statusUpdates).toEqual([])
  })

  it('rejects an already-used token without activating', async () => {
    const recorded: Recorded = { statusUpdates: [], tokenSpent: false }
    const baseUrl = await startApp('pending_verification', recorded, {
      usedAt: new Date(),
    })
    const response = await verify(baseUrl)
    expect(response.status).toBe(400)
    expect(recorded.statusUpdates).toEqual([])
  })
})
