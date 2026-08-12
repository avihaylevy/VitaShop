import { describe, expect, it } from 'vitest'
import {
  GUEST_CART_TTL_MS,
  ensureGuestCartId,
  peekGuestCartId,
  touchGuestCartLifetime,
} from './guestSession.js'

/**
 * MILESTONE-007 Checkpoint B.
 *
 * 🔴 THESE TESTS EXERCISE THE FAILURE MODES, NOT THE HAPPY PATH. O8's seams
 * fail SILENTLY, so a test that shows a working promotion proves the least
 * interesting thing. What has to be proved is that the identity SURVIVES the
 * events that destroy it — regenerate, login, logout, a second tab, expiry,
 * and a request with no session at all.
 *
 * A session is modelled as a plain object because that is what express-session
 * hands the request: assertions here are about the CONTRACT (does the id
 * persist, is the write made, is the lifetime touched), not about the library.
 */

type Session = { guestCartId?: string; userId?: string; cookie?: { maxAge?: number | null } }

const newSession = (over: Partial<Session> = {}): Session => ({ cookie: { maxAge: 86_400_000 }, ...over })

/** What express-session's regenerate() actually does: a NEW empty session object. */
const afterRegenerate = (): Session => newSession()

describe('ensureGuestCartId — the write O8 is about', () => {
  it('WRITES to the session, which is what makes saveUninitialized:false persist it', () => {
    const session = newSession()
    expect(session.guestCartId).toBeUndefined()

    const id = ensureGuestCartId({ session })

    expect(id).toEqual(expect.any(String))
    // 🔴 The assertion that matters: the id is ON THE SESSION, not merely
    // returned. A function that returned an id without writing would pass a
    // "returns an id" test and leave the cart unreachable forever.
    expect(session.guestCartId).toBe(id)
  })

  it('is IDEMPOTENT — the id RECURS across requests for as long as the session lives', () => {
    const session = newSession()
    const first = ensureGuestCartId({ session })
    const second = ensureGuestCartId({ session })
    const third = ensureGuestCartId({ session })

    expect(second).toBe(first)
    expect(third).toBe(first)
  })

  it('a SECOND TAB on the same session sees the same id', () => {
    const session = newSession()
    const tabOne = ensureGuestCartId({ session })
    const tabTwo = ensureGuestCartId({ session })
    expect(tabTwo).toBe(tabOne)
  })

  it('🔴 returns null with NO SESSION rather than inventing an id nobody can store', () => {
    expect(ensureGuestCartId({})).toBeNull()
    expect(ensureGuestCartId({ session: undefined })).toBeNull()
  })

  it('treats an empty-string id as absent — a blank id is not an identity', () => {
    const session = newSession({ guestCartId: '' })
    const id = ensureGuestCartId({ session })
    expect(id).not.toBe('')
    expect(session.guestCartId).toBe(id)
  })

  it('two independent sessions never share an id', () => {
    const a = ensureGuestCartId({ session: newSession() })
    const b = ensureGuestCartId({ session: newSession() })
    expect(a).not.toBe(b)
  })
})

describe('the events that DESTROY a guest identity', () => {
  it('🔴 REGENERATE drops the id — which is exactly why DEC-053 captures it BEFORE regenerating', () => {
    const before = newSession()
    const captured = ensureGuestCartId({ session: before })
    expect(captured).toEqual(expect.any(String))

    // express-session's regenerate() replaces the session object wholesale.
    const after = afterRegenerate()
    expect(peekGuestCartId({ session: after })).toBeNull()

    // 🔴 The lesson encoded as an assertion: whatever PROMOTE/MERGE need must
    // already be in hand before this point. Reading it afterwards yields null,
    // silently, and the cart is orphaned with nothing thrown.
    const reissued = ensureGuestCartId({ session: after })
    expect(reissued).not.toBe(captured)
  })

  it('LOGOUT (destroy) leaves no identity behind on the new session', () => {
    const session = newSession()
    ensureGuestCartId({ session })
    const destroyed = afterRegenerate() // destroy() + a fresh session on the next request
    expect(peekGuestCartId({ session: destroyed })).toBeNull()
  })

  it('an EXPIRED session is a new session, and gets a new id', () => {
    const expired = newSession() // the store dropped the old row; express-session hands a fresh one
    const id = ensureGuestCartId({ session: expired })
    expect(id).toEqual(expect.any(String))
    expect(peekGuestCartId({ session: expired })).toBe(id)
  })
})

describe('§7.9 Q5 — 30 days, ROLLING, and only for guests', () => {
  it('sets the guest lifetime to 30 days', () => {
    const session = newSession()
    ensureGuestCartId({ session })
    expect(session.cookie?.maxAge).toBe(GUEST_CART_TTL_MS)
    expect(GUEST_CART_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000)
  })

  it('ROLLS — later activity extends the window rather than letting it run down', () => {
    const session = newSession()
    ensureGuestCartId({ session })
    session.cookie!.maxAge = 5_000 // simulate the window having nearly elapsed
    touchGuestCartLifetime(session)
    expect(session.cookie?.maxAge).toBe(GUEST_CART_TTL_MS)
  })

  it('🔴 does NOT extend an AUTHENTICATED session — Q5 is about a cart, not about auth', () => {
    // Raising the shared cookie TTL would have quietly extended every logged-in
    // session from 24 hours to 30 days: a security regression smuggled in as a
    // cart feature. This is the test that stops that.
    const session = newSession({ userId: 'user-1', cookie: { maxAge: 86_400_000 } })
    ensureGuestCartId({ session })
    expect(session.cookie?.maxAge).toBe(86_400_000)
  })

  it('tolerates a session with no cookie object rather than throwing', () => {
    const session: Session = { guestCartId: undefined }
    expect(() => ensureGuestCartId({ session })).not.toThrow()
    expect(session.guestCartId).toEqual(expect.any(String))
  })
})

describe('peekGuestCartId — reads without writing', () => {
  it('returns null on a fresh session and does NOT create an id', () => {
    const session = newSession()
    expect(peekGuestCartId({ session })).toBeNull()
    // 🔴 The no-write half. A "peek" that created an id would make every plain
    // GET persist a session row — the very cost saveUninitialized:false avoids.
    expect(session.guestCartId).toBeUndefined()
  })

  it('returns the id once one exists', () => {
    const session = newSession()
    const id = ensureGuestCartId({ session })
    expect(peekGuestCartId({ session })).toBe(id)
  })
})
