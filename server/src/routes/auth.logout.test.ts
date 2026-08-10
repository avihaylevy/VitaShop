import type { Server } from 'node:http'
import express from 'express'
import type { PrismaClient } from '@prisma/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NullEmailProvider } from '../lib/emailService.js'
import { createAuthRouter } from './auth.js'

/**
 * Checkpoint F2 — clause A7.
 *
 * 🔴 THE ASSERTION THAT MATTERS IS THE STORE QUERY, not the cookie.
 *
 * A7 exists because "regeneration alone leaves the previous server-side record
 * alive". A test that only checks the response cookie passes under exactly
 * that bug: the browser gets a new sid while the old row — still carrying
 * `userId` — stays redeemable by anyone holding the old cookie. Only looking
 * at what remains in the store can tell the two apart.
 *
 * The fake store below stands in for connect-pg-simple's table so the check is
 * a real one without needing a live database.
 */

let server: Server | undefined

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()))
    server = undefined
  }
})

/** Stands in for the `session` table: sid -> payload. */
type FakeStore = Map<string, { userId?: string }>

async function startApp(store: FakeStore, existingSid: string | null) {
  const app = express()
  app.use(express.json())

  let sessionId = existingSid ?? 'anonymous-sid'
  app.use((req, _res, next) => {
    Object.defineProperty(req, 'sessionID', { get: () => sessionId, configurable: true })
    ;(req as unknown as { session: unknown }).session = {
      destroy(cb: (err?: unknown) => void) {
        // What express-session's destroy does: remove the row from the store.
        store.delete(sessionId)
        cb()
      },
      regenerate(cb: (err?: unknown) => void) {
        // Deliberately available so the "wrong implementation" test can use it.
        sessionId = 'regenerated-sid'
        store.set(sessionId, {})
        cb()
      },
      save(cb: (err?: unknown) => void) {
        cb()
      },
    }
    next()
  })

  app.use(
    '/api',
    createAuthRouter({
      prisma: { user: { findUnique: vi.fn() } } as unknown as PrismaClient,
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

function logout(baseUrl: string) {
  return fetch(`${baseUrl}/api/auth/logout`, { method: 'POST' })
}

describe('A7 — logout DESTROYS the session record', () => {
  it('🔴 the row is GONE from the store afterwards', async () => {
    const store: FakeStore = new Map([['live-sid', { userId: 'user-1' }]])
    const baseUrl = await startApp(store, 'live-sid')

    expect(store.has('live-sid')).toBe(true)
    const response = await logout(baseUrl)

    // THE assertion. Regeneration would leave this row in place, still
    // carrying userId, redeemable by whoever holds the old cookie.
    expect(store.has('live-sid')).toBe(false)
    expect(store.size).toBe(0)
    expect(response.status).toBe(200)
  })

  it('🔴 leaves NO record behind at all — not a detached one', async () => {
    // The failure A7 names is a record that survives under a different sid.
    // Asserting the specific sid is gone is not enough; the store must be
    // empty of anything belonging to that session.
    const store: FakeStore = new Map([['live-sid', { userId: 'user-1' }]])
    const baseUrl = await startApp(store, 'live-sid')
    await logout(baseUrl)

    expect([...store.values()].some((payload) => payload.userId === 'user-1')).toBe(false)
  })

  it('clears the cookie, with the name the middleware actually sets', async () => {
    // A mismatched name leaves the browser sending a cookie whose row is gone.
    const store: FakeStore = new Map([['live-sid', { userId: 'user-1' }]])
    const baseUrl = await startApp(store, 'live-sid')
    const response = await logout(baseUrl)

    expect(response.headers.get('set-cookie')).toContain('vitashop.sid')
  })
})

describe('A7 — the response does not branch', () => {
  it('🔴 responds identically when there was no session to destroy', async () => {
    const withSession: FakeStore = new Map([['live-sid', { userId: 'user-1' }]])
    const withUrl = await startApp(withSession, 'live-sid')
    const withResponse = await logout(withUrl)
    const withBody = await withResponse.json()
    await new Promise<void>((resolve) => server?.close(() => resolve()))
    server = undefined

    const withoutSession: FakeStore = new Map()
    const withoutUrl = await startApp(withoutSession, null)
    const withoutResponse = await logout(withoutUrl)
    const withoutBody = await withoutResponse.json()

    // Nothing to disclose — "you were not logged in" tells an attacker only
    // what they already knew about their own request — and no reason to
    // branch, so both paths are byte-identical.
    expect(withoutResponse.status).toBe(withResponse.status)
    expect(withoutBody).toEqual(withBody)
  })

  it('does not error when the store is already empty', async () => {
    const store: FakeStore = new Map()
    const baseUrl = await startApp(store, null)
    const response = await logout(baseUrl)
    expect(response.status).toBe(200)
  })
})
