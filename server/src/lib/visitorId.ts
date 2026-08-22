import { randomUUID } from 'node:crypto'
import type { Request, Response } from 'express'
import { sessionCookieOptions } from './session.js'

/**
 * DEC-103 / ISSUE-189 — the funnel's DURABLE VISITOR IDENTITY.
 *
 * `req.sessionID` was the funnel key and it fragments twice: an anonymous
 * session is never persisted (`saveUninitialized: false` — MILESTONE-007
 * Checkpoint B), so every guest view minted a one-request id and KPI-01's
 * denominator approximated PAGEVIEWS; and login REGENERATES the session id
 * (DEC-053 RULE 3), splitting one visitor's guest-browse → sign-in →
 * purchase journey into two "sessions".
 *
 * The fix is its own first-party cookie, independent of the session:
 *   · minted once per browser, carried for a year — login's regenerate
 *     never touches it, so the journey stays one identity;
 *   · PURE COOKIE STATE — no server-side row is created, so Checkpoint
 *     B's "a read must not mint an identity" (which is about session
 *     ROWS in the store) is preserved: an anonymous visitor who only
 *     reads leaves nothing in the database;
 *   · a random UUID carrying NOTHING personal — it links funnel rows to
 *     one anonymous browser and to nothing else. The same httpOnly /
 *     secure-in-prod / SameSite=Lax contract as the session cookie.
 *
 * FunnelEvent.sessionId therefore stores this VISITOR id (the column name
 * predates the fix and is not worth a migration; the dashboard's
 * "distinct sessions" figures are distinct VISITORS).
 */

export const VISITOR_COOKIE = 'vs_vid'

/** One year — an analytics identity, not an auth credential. */
const VISITOR_COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * Cookie-header parse, by hand — the ONE cookie this project reads
 * outside express-session, and adding cookie-parser for it would be a
 * new dependency (stop-and-ask) for three lines of string handling.
 */
export function readVisitorCookie(header: string | undefined): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() !== VISITOR_COOKIE) continue
    const value = part.slice(eq + 1).trim()
    // Only the shape we mint — a tampered value must not become a bucket
    // an attacker chooses (KPI denominators aggregate over these).
    return UUID_SHAPE.test(value) ? value : null
  }
  return null
}

/**
 * The visitor id for THIS request — read from the cookie, or minted and
 * SET on the response. 🔴 Synchronous, and must be called BEFORE the
 * response body is written (Set-Cookie is a header): every instrumented
 * route captures the id early and hands the string onward.
 */
export function ensureVisitorId(req: Request, res: Response): string {
  const existing = readVisitorCookie(req.headers.cookie)
  if (existing) return existing
  const minted = randomUUID()
  if (!res.headersSent) {
    res.cookie(VISITOR_COOKIE, minted, {
      ...sessionCookieOptions(),
      maxAge: VISITOR_COOKIE_MAX_AGE_MS,
    })
  }
  return minted
}
