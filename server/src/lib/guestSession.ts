import { randomUUID } from 'node:crypto'
import type { SessionData } from 'express-session'

/**
 * MILESTONE-007 Checkpoint B — O8, the guest cart's session identity.
 *
 * 🔴 WHY THIS IS ITS OWN CHECKPOINT. `saveUninitialized` is `false`, so an
 * UNTOUCHED guest session is never persisted and its id does not recur on the
 * next request. Until something WRITES to `req.session`, a `Cart.session_id`
 * captured today refers to a row that will never be reachable again — and
 * nothing throws. PROMOTE-GUEST-CART and MERGE-GUEST-CART are decorative
 * without this, and all four inherited seams (§6.25) fail SILENTLY.
 *
 * 🔴 THE WRONG FIX is flipping `saveUninitialized` to `true`: that trades one
 * silent orphan for a persisted session row per anonymous visitor per request.
 * The right fix is to write only when a guest cart identity is actually needed,
 * which is what `ensureGuestCartId` does.
 *
 * §3.4 — the client is not a source of truth about who it is. This id is
 * generated server-side and lives in the session store; nothing reads it from
 * a header, a body or a query parameter.
 */

/**
 * §7.9 Q5, decided by the user 2026-08-12: **30 days, rolling.** Previously the
 * guest cart lived for however long the session cookie happened to last, which
 * was decided by accident rather than chosen.
 */
export const GUEST_CART_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * 🔴 THE AUTHENTICATED SESSION KEEPS ITS OWN, SHORTER LIFETIME.
 *
 * Q5 is a decision about a GUEST CART, not about how long a logged-in session
 * may live. Raising the shared cookie TTL to 30 days would have extended every
 * AUTHENTICATED session from 24 hours to a month — a security regression
 * smuggled in as a cart feature. So the rolling extension is applied to
 * ANONYMOUS sessions only, and `session.ts`'s 24-hour default stands for the
 * rest. This is called out because the two lifetimes look like one setting.
 */
// 🔴 The REAL express-session types, not a hand-rolled copy. `SessionLike` used
// to restate `userId` and `guestCartId` structurally, which meant a rename in
// auth.ts would compile fine here and silently turn every authenticated session
// into a guest. See src/types/express-session.d.ts.
type SessionLike = Omit<Partial<SessionData>, 'cookie'> & {
  cookie?: { maxAge?: number | null }
}

type RequestLike = { session?: SessionLike }

function isAuthenticated(session: SessionLike): boolean {
  return typeof session.userId === 'string' && session.userId.length > 0
}

/**
 * Returns the caller's stable guest cart id, creating one if needed.
 *
 * 🔴 IDEMPOTENT BY CONTRACT. Calling it twice in one request, or once per
 * request across a hundred requests, yields the SAME id for as long as the
 * session survives — that recurrence IS the thing O8 is about.
 *
 * Returns `null` when there is no session at all (an unauthenticated route
 * mounted before the session middleware, or a test harness without it). 🔴 It
 * does NOT invent an id in that case: an id nobody can store is worse than an
 * absent one, because it looks like it worked.
 */
export function ensureGuestCartId(req: RequestLike): string | null {
  const session = req.session
  if (!session) return null

  if (typeof session.guestCartId !== 'string' || session.guestCartId.length === 0) {
    // 🔴 THE WRITE. This is the whole point of O8: touching the session is what
    // makes `saveUninitialized: false` persist it and what makes the id recur.
    session.guestCartId = randomUUID()
  }

  touchGuestCartLifetime(session)
  return session.guestCartId
}

/**
 * Applies Q5's ROLLING window: activity extends the guest cart's life.
 *
 * Exported so a future cart route can extend the window on a read without
 * being forced to also mint an id. Authenticated sessions are left alone —
 * see the note on `GUEST_CART_TTL_MS`.
 */
export function touchGuestCartLifetime(session: SessionLike): void {
  if (isAuthenticated(session)) return
  if (!session.cookie) return
  session.cookie.maxAge = GUEST_CART_TTL_MS
}

/**
 * Reads the id WITHOUT creating one. For callers that must not cause a session
 * write — a plain GET that should stay cacheable, or the promote/merge seams,
 * which want to know whether a guest cart identity existed BEFORE they act.
 */
export function peekGuestCartId(req: RequestLike): string | null {
  const value = req.session?.guestCartId
  return typeof value === 'string' && value.length > 0 ? value : null
}
