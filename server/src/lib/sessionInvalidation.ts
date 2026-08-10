import type { Pool } from 'pg'
import { sessionPool } from './sessionPool.js'

/**
 * MILESTONE-006 clause A8 — invalidate every server-side session belonging
 * to one user.
 *
 * DEC-018 requires this after a password reset and after an account is
 * disabled: a session that outlives the event which should have ended it is
 * exactly what choosing sessions over JWT was supposed to prevent.
 *
 * 🔴 Why raw SQL rather than Prisma. `connect-pg-simple`'s table is
 * `(sid, sess json, expire)` — there is NO user-id column, so "delete this
 * user's sessions" cannot be expressed as an ordinary lookup. The application
 * writes `userId` into the session payload, and invalidation matches on a JSON
 * predicate over `sess`. Per DEC-052 Part 2b the `session` table is tracked in
 * `schema.prisma` for migration purposes ONLY and is never read or written
 * through the Prisma client, so this runs on the same `pg` pool the store uses.
 */
export async function invalidateUserSessions(
  userId: string,
  options: { exceptSid?: string; pool?: Pool } = {},
): Promise<number> {
  const pool = options.pool ?? sessionPool

  // 🔴 `sess->>'userId'` yields TEXT. The bound parameter MUST be a string —
  // binding a number makes Postgres compare text to a number, the predicate
  // matches nothing, and the delete silently succeeds having removed no rows.
  // No error, no log, and the sessions the password reset was meant to kill
  // stay alive. `String(userId)` is the guard; see the test that pins it.
  const boundUserId = String(userId)

  const result = options.exceptSid
    ? await pool.query(
        `DELETE FROM "session" WHERE "sess"->>'userId' = $1 AND "sid" <> $2`,
        [boundUserId, options.exceptSid],
      )
    : await pool.query(`DELETE FROM "session" WHERE "sess"->>'userId' = $1`, [
        boundUserId,
      ])

  return result.rowCount ?? 0
}
