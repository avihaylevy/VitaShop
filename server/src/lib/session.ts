import connectPgSimple from 'connect-pg-simple'
import session from 'express-session'
import type { RequestHandler } from 'express'
import { sessionPool } from './sessionPool.js'

/**
 * MILESTONE-006 Checkpoint C — the session middleware.
 *
 * Contract: DEC-018 (mechanism, Accepted) and clause A6 (FROZEN).
 * 🔴 This module wires the session only. It authenticates nothing and mounts
 * no route — registration, login and logout are Checkpoints D, E and F.
 */

const PgStore = connectPgSimple(session)

/** Sessions live as long as the spec's longest-lived flow needs; 24 hours. */
const SESSION_TTL_MS = 24 * 60 * 60 * 1000

/**
 * 🔴 THE COOKIE CONTRACT — ONE definition, two consumers.
 *
 * `createSessionMiddleware` sets the cookie with these; the logout route
 * clears it with the same object. That is not tidiness: **a browser only
 * removes a cookie when the attributes given to `clearCookie` MATCH the ones
 * it was set with.** `res.clearCookie(name)` with no options sends none of
 * `path`, `sameSite`, `httpOnly` or `secure`, so in production the dead cookie
 * survives and the browser keeps sending a session id that resolves to
 * nothing.
 *
 * Two hand-maintained copies of this shape would drift, and the drift is
 * silent — logout would keep returning 200 while leaving the cookie in place.
 * Same reasoning as `normalizeEmail`: one definition, or eventually two
 * different ones.
 */
export const SESSION_COOKIE_NAME = 'vitashop.sid'

/**
 * 🔴 A FUNCTION, not a frozen constant, and the reason is `secure`.
 *
 * A module-level object would evaluate `NODE_ENV` once at import time. That
 * happens to work in production, where the variable never changes — but it
 * silently makes the value untestable, and the first version of this change
 * broke `session.test.ts`'s "secure only in production" case exactly that way.
 * Reading the environment per call keeps the behaviour observable, and a test
 * that can no longer see a security flag is a test that stops guarding it.
 */
export function sessionCookieOptions() {
  return {
    httpOnly: true, // A6 — never readable from JavaScript
    secure: process.env.NODE_ENV === 'production', // A6 — TLS-only in prod
    sameSite: 'lax', // A6-CSRF — this IS the CSRF control
    path: '/',
  } as const
}

export function createSessionMiddleware(): RequestHandler {
  const secret = process.env.SESSION_SECRET
  if (!secret) {
    // Fail fast and loudly. A missing secret must never fall back to a
    // default or a generated value: express-session would then sign cookies
    // with something that changes on restart, or worse, something guessable.
    // 🔴 No secret is ever hardcoded here — .env only, see .env.example.
    throw new Error(
      'SESSION_SECRET is not set — see .env.example. Required by DEC-018/A6; no default exists.',
    )
  }

  const store = new PgStore({
    pool: sessionPool,
    tableName: 'session',
    // 🔴 The `session` table is BASELINED and tracked by Prisma
    // (DEC-052 Part 2). The store must never create or alter it — that
    // would put the schema back into drift against the migration history,
    // which is the exact failure the baseline exists to prevent.
    createTableIfMissing: false,
  })

  return session({
    name: SESSION_COOKIE_NAME,
    secret,
    store,
    resave: false,
    // Do not persist untouched anonymous sessions — a row per visitor,
    // written on every request, for no information.
    //
    // 🔴 CONSEQUENCE MILESTONE-007 MUST HANDLE (open item O8, DEC-053 Part 3).
    // An untouched session is never written and issues no Set-Cookie, so the
    // browser sends nothing back and `req.sessionID` is a NEW value on every
    // request. `Cart.session_id` IS that identity, and DEC-053 step 1 captures
    // it as the guest identity at registration — so a guest cart created
    // without anything having written to `req.session` is keyed to an id that
    // never recurs. The cart is orphaned on the NEXT request, long before
    // registration, and nothing throws.
    //
    // THE FIX BELONGS AT CART CREATION, NOT HERE: when M-007 creates a guest
    // cart it must write a value into `req.session` — forcing persistence and
    // a cookie — before or as it writes `Cart.session_id`.
    //
    // 🔴 DO NOT set this to `true` to make a cart bug go away. That trades a
    // silent orphan for a persisted session row per anonymous visitor on every
    // request, which is the waste this line exists to avoid.
    saveUninitialized: false,
    // 🔴 Spread the shared contract — see SESSION_COOKIE_OPTIONS. `maxAge` is
    // set-only and deliberately NOT part of it: `clearCookie` must not send a
    // lifetime, and including it here keeps the two consumers honest about
    // which attributes they actually share.
    cookie: { ...sessionCookieOptions(), maxAge: SESSION_TTL_MS },
  })
}
