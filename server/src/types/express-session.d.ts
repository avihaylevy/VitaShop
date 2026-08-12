import 'express-session'

/**
 * 🔴 THE ONE PLACE `req.session`'s shape is declared.
 *
 * Before this file, `userId` was asserted in THREE places and typed in NONE:
 * `auth.ts` wrote it twice through `req.session as unknown as { userId?: string }`,
 * and `guestSession.ts` read it through a hand-rolled structural type. The names
 * matched — and nothing kept them matching.
 *
 * ⚠️ THE FAILURE THAT WAS ONE RENAME AWAY: rename the field in `auth.ts` and
 * `isAuthenticated()` returns false forever, so EVERY AUTHENTICATED SESSION
 * starts taking the guest's 30-day rolling extension — the exact regression
 * Checkpoint B caught and avoided, arriving through the one door the compiler
 * had been told not to look at.
 *
 * Adding a field here is now the only way to add a session field, and `tsc`
 * holds the call sites together. Verified by renaming one side and confirming
 * the compiler fails.
 */
declare module 'express-session' {
  interface SessionData {
    /** Set at registration and login, AFTER regeneration. See DEC-053. */
    userId?: string
    /** MILESTONE-007 Checkpoint B, O8. See `lib/guestSession.ts`. */
    guestCartId?: string
  }
}
