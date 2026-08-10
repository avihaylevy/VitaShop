import type { Server } from 'node:http'
import express from 'express'
import type { PrismaClient } from '@prisma/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NullEmailProvider } from '../lib/emailService.js'
import { createAuthRouter } from './auth.js'

/**
 * TEST-030b — assertions A1 and A2, which are route-level.
 *
 *   A1  the seam observes the PRE-regeneration session id
 *   A2  the session id DIFFERS by the end
 *   A3  the user row is committed before the id changes
 *       (A3's commit half lives in registrationService.test.ts; here we
 *        assert the commit happens before `regenerate` is called, which is
 *        the route's share of the same rule)
 *
 * 🔴 All three are required. Each alone passes on a broken handler.
 *
 * A fake session middleware stands in for express-session so the ordering is
 * observable without a database or a store.
 */

const body = {
  firstName: 'משה',
  lastName: 'כהן',
  email: 'moshe@example.com',
  password: 'Abcdef12',
  confirmPassword: 'Abcdef12',
  phone: '050-9871234',
  acceptedTerms: true,
}

interface Trace {
  events: string[]
  sessionIdAtSeam?: string
  initialSessionId?: string
  finalSessionId?: string
}

let server: Server | undefined

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()))
    server = undefined
  }
})

async function startApp(trace: Trace, existingUser: { id: string } | null) {
  const app = express()
  app.use(express.json())

  // Minimal stand-in for express-session: a mutable sessionID that
  // `regenerate` replaces, exactly as the real middleware does.
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
      findUnique: vi.fn(async () => existingUser),
    },
    $transaction: vi.fn(async (fn: (client: unknown) => Promise<unknown>) => {
      trace.events.push('tx.begin')
      const result = await fn({
        user: { create: vi.fn(async () => ({ id: 'user-1' })) },
        emailVerificationToken: {
          create: vi.fn(async () => {
            // The seam sits immediately after these writes, inside the
            // transaction. This is the closest observable point to it.
            trace.sessionIdAtSeam = sessionId
            return { id: 'tok-1' }
          }),
        },
      })
      trace.events.push('tx.commit')
      return result
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

describe('TEST-030b — registration ordering, at the route', () => {
  it('🔴 A1: the seam observes the PRE-regeneration session id', async () => {
    const trace: Trace = { events: [] }
    const baseUrl = await startApp(trace, null)

    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    expect(response.status).toBe(201)

    // Capturing after regeneration would record 'regenerated-session-id' —
    // an id no cart row has ever carried. The guest cart would keep the old
    // session_id forever and be orphaned, with nothing thrown.
    expect(trace.sessionIdAtSeam).toBe('guest-session-id')
    expect(trace.sessionIdAtSeam).not.toBe(trace.finalSessionId)
  })

  it('🔴 A2: the session id DIFFERS by the end', async () => {
    const trace: Trace = { events: [] }
    const baseUrl = await startApp(trace, null)
    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

    // Without this, a handler that never regenerates passes A1 trivially and
    // ships an A6 session-fixation hole.
    expect(trace.events).toContain('session.regenerate')
    expect(trace.finalSessionId).toBe('regenerated-session-id')
    expect(trace.finalSessionId).not.toBe(trace.initialSessionId)
  })

  it('🔴 A3: the transaction COMMITS before the session is regenerated', async () => {
    const trace: Trace = { events: [] }
    const baseUrl = await startApp(trace, null)
    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

    // Rule 2. Regeneration inside the transaction cannot be rolled back —
    // connect-pg-simple writes through its own pool — so a rollback would
    // leave a phantom session authenticated as a nonexistent user.
    const commit = trace.events.indexOf('tx.commit')
    const regenerate = trace.events.indexOf('session.regenerate')
    expect(commit).toBeGreaterThanOrEqual(0)
    expect(regenerate).toBeGreaterThan(commit)
  })
})

describe('DEC-053 clause 4b — the response does not distinguish', () => {
  it('🔴 returns the SAME status and body for an already-registered email', async () => {
    const fresh: Trace = { events: [] }
    const freshUrl = await startApp(fresh, null)
    const freshResponse = await fetch(`${freshUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const freshBody = await freshResponse.json()
    await new Promise<void>((resolve) => server?.close(() => resolve()))
    server = undefined

    const existing: Trace = { events: [] }
    const existingUrl = await startApp(existing, { id: 'already-here' })
    const existingResponse = await fetch(`${existingUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const existingBody = await existingResponse.json()

    // 🔴 No 409. No "email already in use". Identical status and identical
    // body — anything else is an account-enumeration oracle, and a friendlier
    // one than login because it needs no password guess.
    expect(existingResponse.status).toBe(freshResponse.status)
    expect(existingResponse.status).toBe(201)
    expect(existingBody).toEqual(freshBody)
  })

  it('does not regenerate the session for an already-registered email', async () => {
    const trace: Trace = { events: [] }
    const baseUrl = await startApp(trace, { id: 'already-here' })
    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

    // The requester may not own that address; handing them an authenticated
    // session would be worse than the enumeration leak 4b closes.
    expect(trace.events).not.toContain('session.regenerate')
  })
})

describe('registration validation is enforced at the route (A11, §3.4)', () => {
  it('rejects a bad payload with 400 and names the fields', async () => {
    const trace: Trace = { events: [] }
    const baseUrl = await startApp(trace, null)
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, acceptedTerms: false, password: 'weak' }),
    })

    expect(response.status).toBe(400)
    const payload = (await response.json()) as { error: { code: string; fields: string[] } }
    expect(payload.error.code).toBe('REGISTRATION_INVALID')
    expect(payload.error.fields).toContain('acceptedTerms')
    // 🔴 Nothing was written and no session was touched on the reject path.
    expect(trace.events).toEqual([])
  })
})
