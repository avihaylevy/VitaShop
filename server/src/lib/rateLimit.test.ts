import type { Server } from 'node:http'
import express from 'express'
import type { PrismaClient } from '@prisma/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NullEmailProvider } from './emailService.js'
import { AUTH_RATE_LIMITS, createAuthRateLimiters, RATE_LIMIT_RESPONSE } from './rateLimit.js'
import { createAuthRouter } from '../routes/auth.js'

/** Minimal shape of an Express router layer — enough to walk the stack. */
interface RouterLayer {
  route?: { path: string; methods: Record<string, boolean>; stack: unknown[] }
}

/**
 * Checkpoint G — rate limiting. Closes O1.
 *
 * 🔴 THE TEST THAT MATTERS is "known and unknown addresses cross into 429 at
 * the SAME attempt with the SAME body". A 429 is not a 200, so a limiter that
 * only counted attempts against existing accounts would hand back the exact
 * enumeration oracle A3 and DEC-053 4b close.
 */

let server: Server | undefined

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()))
    server = undefined
  }
})

/**
 * `userExists` decides whether the fake database has the address. The limiter
 * must behave identically either way — that is the whole point.
 */
async function startApp(userExists: boolean) {
  const app = express()
  // 🔴 Body parsing BEFORE the router, which is what makes the email
  // keyGenerator able to see req.body. See the ordering test below.
  app.use(express.json())
  app.use((req, _res, next) => {
    ;(req as unknown as { session: unknown }).session = {
      regenerate: (cb: (e?: unknown) => void) => cb(),
      save: (cb: (e?: unknown) => void) => cb(),
      destroy: (cb: (e?: unknown) => void) => cb(),
    }
    Object.defineProperty(req, 'sessionID', { get: () => 'sid', configurable: true })
    next()
  })

  const prisma = {
    user: {
      findUnique: vi.fn(async () => (userExists ? { id: 'user-1', status: 'active' } : null)),
    },
    passwordResetToken: { create: vi.fn(async () => ({})) },
  } as unknown as PrismaClient

  app.use(
    '/api',
    createAuthRouter({
      prisma,
      emailService: new NullEmailProvider(),
      appBaseUrl: 'http://localhost:5173',
      // Fresh limiters per app, so counters never leak between cases.
      rateLimiters: createAuthRateLimiters(),
    }),
  )

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve())
  })
  const address = server?.address()
  if (!address || typeof address === 'string') throw new Error('no port')
  return `http://127.0.0.1:${address.port}`
}

function resetRequest(baseUrl: string, email: string) {
  return fetch(`${baseUrl}/api/auth/password-reset`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  })
}

/** Hits the endpoint until it 429s; returns the attempt number and the body. */
async function firstRejection(baseUrl: string, email: string, maxAttempts: number) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await resetRequest(baseUrl, email)
    if (response.status === 429) {
      return { attempt, status: response.status, body: await response.json() }
    }
  }
  return { attempt: -1, status: 200, body: null }
}

describe('🔴 G — the limiter must not reopen A3', () => {
  it('known and unknown addresses cross into 429 at the SAME attempt', async () => {
    const overshoot = AUTH_RATE_LIMITS.passwordResetEmail.limit + 3

    const knownUrl = await startApp(true)
    const known = await firstRejection(knownUrl, 'a@b.com', overshoot)
    await new Promise<void>((resolve) => server?.close(() => resolve()))
    server = undefined

    const unknownUrl = await startApp(false)
    const unknown = await firstRejection(unknownUrl, 'a@b.com', overshoot)

    // If the counter only advanced when the account existed, the known address
    // would 429 first and the unknown one would keep returning 200 — the
    // enumeration oracle A3 closes, handed back by the limiter.
    expect(known.attempt).toBeGreaterThan(0)
    expect(unknown.attempt).toBe(known.attempt)
    expect(unknown.attempt).toBe(AUTH_RATE_LIMITS.passwordResetEmail.limit + 1)
  })

  it('the 429 body is IDENTICAL regardless of account existence', async () => {
    const overshoot = AUTH_RATE_LIMITS.passwordResetEmail.limit + 3

    const knownUrl = await startApp(true)
    const known = await firstRejection(knownUrl, 'a@b.com', overshoot)
    await new Promise<void>((resolve) => server?.close(() => resolve()))
    server = undefined

    const unknownUrl = await startApp(false)
    const unknown = await firstRejection(unknownUrl, 'a@b.com', overshoot)

    expect(unknown.body).toEqual(known.body)
    expect(known.body).toEqual(RATE_LIMIT_RESPONSE)
  })

  it('🔴 the 429 body says nothing about the address or which limit fired', () => {
    const serialised = JSON.stringify(RATE_LIMIT_RESPONSE).toLowerCase()
    for (const leak of ['email', 'account', 'exists', 'register', 'reset', 'ip']) {
      expect(serialised).not.toContain(leak)
    }
  })
})

describe('G — the email key is actually the email', () => {
  it('🔴 a DIFFERENT address has its own budget', async () => {
    // If the keyGenerator silently fell back to the IP — which is what happens
    // when req.body is undefined because body parsing runs too late — every
    // address would share one bucket and this second address would already be
    // exhausted. That failure looks like a working limiter.
    const baseUrl = await startApp(false)
    const limit = AUTH_RATE_LIMITS.passwordResetEmail.limit

    for (let i = 0; i < limit; i++) await resetRequest(baseUrl, 'first@b.com')
    const firstBlocked = await resetRequest(baseUrl, 'first@b.com')
    expect(firstBlocked.status).toBe(429)

    const second = await resetRequest(baseUrl, 'second@b.com')
    expect(second.status).toBe(200)
  })

  it('🔴 case and whitespace do not buy a fresh budget', async () => {
    // Without normalizeEmail, `A@B.com` is a second bucket and the limit is
    // bypassed by holding shift.
    const baseUrl = await startApp(false)
    const limit = AUTH_RATE_LIMITS.passwordResetEmail.limit

    for (let i = 0; i < limit; i++) await resetRequest(baseUrl, 'a@b.com')
    const shouted = await resetRequest(baseUrl, '  A@B.COM ')
    expect(shouted.status).toBe(429)
  })
})

describe('G — every auth route is limited', () => {
  it('login rejects past its ceiling, with the shared body', async () => {
    const baseUrl = await startApp(false)
    const limit = AUTH_RATE_LIMITS.login.limit

    for (let i = 0; i < limit; i++) {
      await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'a@b.com', password: 'Abcdef12' }),
      })
    }
    const blocked = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com', password: 'Abcdef12' }),
    })

    expect(blocked.status).toBe(429)
    await expect(blocked.json()).resolves.toEqual(RATE_LIMIT_RESPONSE)
  })

  it('🔴 /password-reset/complete has its OWN budget, not the request side\'s', async () => {
    // These two shared one rateLimit() instance — and therefore one store —
    // which is invisible at the mount site: both routes read as limited, and
    // they were, just not by a budget of their own. The consequence was that a
    // token-guessing flood on /complete drained the budget needed to REQUEST a
    // reset, so behind NAT one person's mistakes locked everyone else out.
    const baseUrl = await startApp(false)

    // Exhaust the completion route well past the REQUEST side's IP ceiling.
    const overshoot = AUTH_RATE_LIMITS.passwordResetIp.limit + 2
    for (let i = 0; i < overshoot; i++) {
      await fetch(`${baseUrl}/api/auth/password-reset/complete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'garbage', password: 'Abcdef12' }),
      })
    }

    // The request side must be untouched by that.
    const stillWorks = await resetRequest(baseUrl, 'someone@b.com')
    expect(stillWorks.status).not.toBe(429)
  })

  it('the completion budget is more generous than the request budget', () => {
    // Legitimate use needs the room: request (1) + submit (1) + one per
    // rejected new password.
    expect(AUTH_RATE_LIMITS.passwordResetCompleteIp.limit).toBeGreaterThan(
      AUTH_RATE_LIMITS.passwordResetIp.limit,
    )
  })

  it('🔴 EVERY route mounted on the auth router carries a limiter', async () => {
    // THE COVERAGE ASSERTION, and the reason it exists: Checkpoint H added a
    // seventh auth route (`GET /auth/session`) and it slipped past Checkpoint
    // G's stated principle that every auth route is limited — the same shape
    // of gap as clause A7 falling between checkpoints.
    //
    // 🔴 "Every auth route is limited" is a property that can be CHECKED.
    // "Every auth route except the ones judged cheap" is not — it degrades
    // into a judgement call per route, made by whoever adds the next one,
    // usually without noticing there was a rule.
    //
    // This walks the router's real stack rather than a hand-kept list, so an
    // eighth route is covered the moment it is mounted.
    const { createAuthRouter } = await import('../routes/auth.js')
    const router = createAuthRouter({
      prisma: {} as never,
      emailService: new NullEmailProvider(),
      appBaseUrl: 'http://localhost:5173',
    })

    // Express keeps one layer per mounted route; `route.stack` holds that
    // route's own handler chain — limiters plus the final handler.
    const layers = (router as unknown as { stack: RouterLayer[] }).stack.filter((l) => l.route)

    expect(layers.length).toBeGreaterThan(0)

    const unlimited = layers
      .filter((layer) => (layer.route?.stack.length ?? 0) < 2)
      .map((layer) => `${Object.keys(layer.route?.methods ?? {}).join('/')} ${layer.route?.path}`)

    // A route with a single handler has no limiter in front of it. Anything
    // that genuinely should not be limited goes on the exemption list below,
    // BY NAME and with a reason — never by being quietly omitted.
    const EXEMPT: string[] = []

    expect(unlimited.filter((r) => !EXEMPT.includes(r))).toEqual([])
  })

  it('every configured limit is a positive number with a window', () => {
    for (const [name, config] of Object.entries(AUTH_RATE_LIMITS)) {
      expect(config.limit, name).toBeGreaterThan(0)
      expect(config.windowMs, name).toBeGreaterThan(0)
    }
  })

  it('🔴 the email budgets are tighter than the IP budgets', () => {
    // An IP limit that bites first would make the email limit unreachable and
    // therefore decorative.
    expect(AUTH_RATE_LIMITS.registerEmail.limit).toBeLessThan(
      AUTH_RATE_LIMITS.registerIp.limit,
    )
    expect(AUTH_RATE_LIMITS.passwordResetEmail.limit).toBeLessThan(
      AUTH_RATE_LIMITS.passwordResetIp.limit,
    )
  })
})
