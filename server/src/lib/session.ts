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
    name: 'vitashop.sid',
    secret,
    store,
    resave: false,
    // Do not persist untouched anonymous sessions — a row per visitor,
    // written on every request, for no information.
    saveUninitialized: false,
    cookie: {
      httpOnly: true, // A6 — never readable from JavaScript
      secure: process.env.NODE_ENV === 'production', // A6 — TLS-only in prod
      sameSite: 'lax', // A6-CSRF — this is the CSRF control
      maxAge: SESSION_TTL_MS,
    },
  })
}
