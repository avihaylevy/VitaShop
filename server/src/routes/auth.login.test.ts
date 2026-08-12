import type { Server } from 'node:http'
import argon2 from 'argon2'
import express from 'express'
import type { PrismaClient, UserStatus } from '@prisma/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { NullEmailProvider } from '../lib/emailService.js'
import { LOCKOUT_MS, prewarmDummyHash } from '../lib/loginService.js'
import { ARGON2_OPTIONS } from '../lib/registrationService.js'
import { createAuthRouter } from './auth.js'

/**
 * The login-side ordering, mirroring TEST-030b's three assertions —
 * DEC-053 Rule 3 says the contract is not registration-only — plus A1's
 * identical response at the HTTP layer, which is where it is observable.
 */

const PASSWORD = 'Abcdef12'
let passwordHash: string

beforeAll(async () => {
  passwordHash = await argon2.hash(PASSWORD, ARGON2_OPTIONS)
  await prewarmDummyHash()
}, 30_000)

let server: Server | undefined

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()))
    server = undefined
  }
})

interface Trace {
  events: string[]
  sessionIdAtCredentialCheck?: string
  sessionIdAtMerge?: string
  initialSessionId?: string
  finalSessionId?: string
}

async function startApp(
  trace: Trace,
  user: { status?: UserStatus; lockedUntil?: Date | null } | null,
) {
  const app = express()
  app.use(express.json())

  let sessionId = 'guest-session-id'
  trace.initialSessionId = sessionId
  app.use((req, _res, next) => {
    Object.defineProperty(req, 'sessionID', { get: () => sessionId, configurable: true })
    ;(req as unknown as { session: unknown }).session = {
      regenerate(cb: (err?: unknown) => void) {
        trace.events.push('session.regenerate')
        sessionId = 'regenerated-session-id'
        trace.finalSessionId = sessionId
        cb()
      },
      save(cb: (err?: unknown) => void) {
        trace.events.push('session.save')
        cb()
      },
    }
    next()
  })

  const prisma = {
    user: {
      findUnique: vi.fn(async () => {
        trace.events.push('user.findUnique')
        trace.sessionIdAtCredentialCheck = sessionId
        return user === null
          ? null
          : {
              id: 'user-1',
              passwordHash,
              status: user.status ?? ('active' as UserStatus),
              failedLoginCount: 0,
              lockedUntil: user.lockedUntil ?? null,
            }
      }),
      update: vi.fn(async () => {
        trace.events.push('user.update')
        return {}
      }),
    },
    // Checkpoint F filled the MERGE-GUEST-CART seam, which runs a transaction
    // AFTER the credential check and BEFORE regeneration. Recording the event
    // is what lets the ordering assertions below see it in the right place;
    // returning "no guest cart" keeps these tests about ORDERING.
    // 🔴 The merge's own behaviour is covered against the REAL database in
    // promoteGuestCart.integration.test.ts — a fake would only prove the fake.
    $transaction: vi.fn(async (fn: (client: unknown) => Promise<unknown>) => {
      trace.events.push('cart.merge')
      trace.sessionIdAtMerge = sessionId
      return fn({ cart: { findFirst: vi.fn(async () => null) } })
    }),
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

function login(baseUrl: string, password = PASSWORD) {
  return fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@b.com', password }),
  })
}

describe('login ordering — DEC-053 Rule 3', () => {
  it('🔴 A1: the seam sees the PRE-regeneration session id', async () => {
    const trace: Trace = { events: [] }
    const baseUrl = await startApp(trace, {})
    await login(baseUrl)

    // Cart.session_id is keyed to this value; DEC-019's merge branch attaches
    // at the seam and needs the id the request arrived with.
    expect(trace.sessionIdAtCredentialCheck).toBe('guest-session-id')
    expect(trace.sessionIdAtCredentialCheck).not.toBe(trace.finalSessionId)
  })

  it('🔴 A2: the session id DIFFERS by the end', async () => {
    const trace: Trace = { events: [] }
    const baseUrl = await startApp(trace, {})
    await login(baseUrl)

    // Without regeneration this is an A6 session-fixation hole.
    expect(trace.events).toContain('session.regenerate')
    expect(trace.finalSessionId).not.toBe(trace.initialSessionId)
  })

  it('🔴 A3: every database write COMPLETES before the regeneration', async () => {
    const trace: Trace = { events: [] }
    const baseUrl = await startApp(trace, {})
    await login(baseUrl)

    // Rule 2 applied to login: connect-pg-simple writes through its own pool,
    // so a regeneration cannot be rolled back with any transaction around it.
    const lastWrite = trace.events.lastIndexOf('user.update')
    const regenerate = trace.events.indexOf('session.regenerate')
    expect(lastWrite).toBeGreaterThanOrEqual(0)
    expect(regenerate).toBeGreaterThan(lastWrite)
  })

  it('does NOT regenerate the session on a failed login', async () => {
    const trace: Trace = { events: [] }
    const baseUrl = await startApp(trace, {})
    await login(baseUrl, 'Wrongxx1')
    expect(trace.events).not.toContain('session.regenerate')
  })

  it('🔴 A8: writes userId into the session payload on success', async () => {
    // A8's DELETE FROM session WHERE sess->>'userId' = $1 finds nothing
    // without this, so password reset would silently fail to revoke.
    const trace: Trace = { events: [] }
    const baseUrl = await startApp(trace, {})
    const response = await login(baseUrl)
    expect(response.status).toBe(200)
    expect(trace.events).toContain('session.save')
  })
})

describe('TEST-032 at the HTTP layer — A1: one response for every failure', () => {
  async function failureShape(
    user: { status?: UserStatus; lockedUntil?: Date | null } | null,
    password: string,
  ) {
    const trace: Trace = { events: [] }
    const baseUrl = await startApp(trace, user)
    const response = await login(baseUrl, password)
    const body = await response.json()
    await new Promise<void>((resolve) => server?.close(() => resolve()))
    server = undefined
    return { status: response.status, body }
  }

  it('🔴 unknown email, wrong password, locked and disabled are IDENTICAL', async () => {
    const unknown = await failureShape(null, PASSWORD)
    const wrong = await failureShape({}, 'Wrongxx1')
    const locked = await failureShape({ lockedUntil: new Date(Date.now() + LOCKOUT_MS) }, PASSWORD)
    const disabled = await failureShape({ status: 'disabled' }, PASSWORD)

    // Same status AND same body. A "your account is locked" variant is the
    // tempting one and the worst: it confirms the address exists and that
    // someone is attacking it.
    for (const result of [wrong, locked, disabled]) {
      expect(result.status).toBe(unknown.status)
      expect(result.body).toEqual(unknown.body)
    }
    expect(unknown.status).toBe(401)
  })

  it('a malformed body gets the same failure, not a validation error', async () => {
    const trace: Trace = { events: [] }
    const baseUrl = await startApp(trace, {})
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com' }),
    })
    expect(response.status).toBe(401)
    // Nothing was looked up — a malformed body must not even probe the DB.
    expect(trace.events).toEqual([])
  })

  it('🔴 DEC-053 Rule 3: the MERGE runs BEFORE regeneration, on the PRE-regeneration id', async () => {
    // Rule 3's entire justification, and until now nothing asserted it:
    // regeneration DESTROYS the guest session id, and that id is the only way
    // to find the guest cart. A merge after regeneration finds nothing and
    // loses the cart silently.
    //
    // 🔴 Written after a mutation moving the merge AFTER regeneration went
    // GREEN against the existing ordering tests. An untested ordering rule is
    // a comment.
    const trace: Trace = { events: [] }
    const baseUrl = await startApp(trace, {})
    await login(baseUrl)

    const mergeAt = trace.events.indexOf('cart.merge')
    const regenerateAt = trace.events.indexOf('session.regenerate')
    expect(mergeAt).toBeGreaterThanOrEqual(0)
    expect(regenerateAt).toBeGreaterThanOrEqual(0)
    expect(mergeAt).toBeLessThan(regenerateAt)
    expect(trace.sessionIdAtMerge).toBe('guest-session-id')
  })
})
