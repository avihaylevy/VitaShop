import { Pool } from 'pg'

/**
 * The `pg` pool that backs the session store.
 *
 * 🔴 One pool, two consumers, deliberately:
 *   1. `connect-pg-simple`, for all ordinary session reads and writes
 *   2. MILESTONE-006 clause A8's invalidation helper, which issues raw
 *      SQL against the same `session` table
 *
 * A8 requires that invalidation run on the SAME pool the store uses and
 * never through the Prisma client — see `sessionInvalidation.ts` and
 * DEC-052 Part 2b. Exporting the pool from here is what makes that
 * literally true rather than merely intended.
 */
export const sessionPool = new Pool({
  connectionString: process.env.DATABASE_URL,
})
