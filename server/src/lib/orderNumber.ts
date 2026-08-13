import { randomInt } from 'node:crypto'

/**
 * MILESTONE-008 Checkpoint C — the order number. DEC-059 answer 8.
 *
 * Format: `VS-YYYYMMDD-XXXXXX`
 *
 * 🔴 THE SUFFIX IS RANDOM, NOT SEQUENTIAL, and that is the decision rather than
 * a detail. A sequential number leaks the store's order volume to anyone who
 * places two orders a week apart and subtracts. It is the oldest information
 * leak in retail and it costs nothing to avoid.
 *
 * ⚠️ THE DATE IS NOT AN IDENTIFIER — it is there so a human reading the number
 * to support knows roughly when it happened. Uniqueness comes from the suffix
 * and, ultimately, from `orders.order_number`'s UNIQUE constraint.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *
 * 🔴 THE DATE IS SUPPLIED BY THE CALLER, WHICH ASKS THE DATABASE FOR IT — this
 * module reads no clock of its own, and the reason is a defect that took two
 * attempts to get right:
 *
 *   1. It first read the Node process's LOCAL calendar.
 *   2. A review said use UTC, arguing `createdAt` is UTC. Applied without
 *      checking — and it is FALSE here: `orders.created_at` is
 *      `timestamp WITHOUT time zone` defaulted from `CURRENT_TIMESTAMP`, and
 *      the database's TimeZone is Asia/Jerusalem, so it stores LOCAL time.
 *      The "fix" created a nightly mismatch where none existed.
 *   3. Reverted to process-local — which STILL only agreed by coincidence.
 *      The app process and Postgres are TWO DIFFERENT CLOCKS. Containerise the
 *      app with TZ=UTC against that same database and every order placed after
 *      ~21:00 local carries yesterday's date beside today's `createdAt`.
 *
 * 🔴 So the number now takes its date from THE SAME STATEMENT SOURCE as
 * `createdAt` — `to_char(LOCALTIMESTAMP, 'YYYYMMDD')`, formatted BY POSTGRES so
 * no JavaScript `Date` can reinterpret a zone-less timestamp on the way out.
 * The two agree because they read one clock, not because anyone asserted they
 * do.
 *
 * ⚠️ The underlying fragility — zone-less columns plus `CURRENT_TIMESTAMP` —
 * is ISSUE-079 and is the user's decision, not this module's.
 */

/**
 * 🔴 The alphabet excludes `0 O 1 I`. Customers read these numbers aloud down a
 * phone line and copy them off screens; anything a person cannot reliably
 * transcribe is a support call. 32 characters over 6 positions is ~1.07e9 per
 * day — collisions are rare, which is exactly why the collision path is tested
 * rather than assumed.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const SUFFIX_LENGTH = 6

/** 🔴 Bounded. See `generateOrderNumber`'s note on why it is not unbounded. */
export const MAX_ORDER_NUMBER_ATTEMPTS = 5

/** `YYYYMMDD`, as Postgres formats it. Nothing else is accepted. */
const DATE_PART = /^\d{8}$/

function suffix(): string {
  let out = ''
  for (let i = 0; i < SUFFIX_LENGTH; i += 1) {
    // `randomInt` is crypto-backed and free of the modulo bias a
    // `Math.random() * n | 0` would introduce across a 32-character alphabet.
    out += ALPHABET[randomInt(ALPHABET.length)]
  }
  return out
}

/**
 * One candidate. Uniqueness is the database's to confirm, never this.
 *
 * @param datePart `YYYYMMDD` from the database — see the module header.
 */
export function orderNumberCandidate(datePart: string): string {
  if (!DATE_PART.test(datePart)) {
    // 🔴 Loud, not defaulted. Falling back to a locally-computed date here is
    // precisely the bug this parameter exists to remove, and it would be
    // invisible: the number would still LOOK right.
    throw new Error(`order number needs a YYYYMMDD date from the database, got: ${String(datePart)}`)
  }
  return `VS-${datePart}-${suffix()}`
}

/**
 * Produces a number the caller has confirmed is free, via `isTaken`.
 *
 * 🔴 BOUNDED RETRY, THEN A LOUD FAILURE. `order_number` carries `@unique`, so a
 * collision is a failed INSERT on a checkout that already looked committed to
 * the shopper. Retrying is right; retrying forever is not — if five
 * crypto-random draws from a ~1e9 space all collide, the cause is not bad luck,
 * it is a broken generator or a broken uniqueness check, and looping would hide
 * that behind a hung request.
 *
 * ⚠️ IT NEVER REUSES A NUMBER and never falls back to a "safe" deterministic
 * one. A duplicate order number is worse than a failed checkout: the shopper
 * can retry a failure, and support cannot untangle two orders that answer to
 * the same name.
 *
 * ⚠️ `isTaken` can only see COMMITTED rows, so it cannot detect a concurrent
 * transaction holding the same number uncommitted. That collision is caught at
 * INSERT time and retried by `orderService`'s outer loop — see
 * ORDER_NUMBER_RETRIES there.
 */
export async function generateOrderNumber(
  isTaken: (candidate: string) => Promise<boolean>,
  datePart: string,
): Promise<string> {
  for (let attempt = 1; attempt <= MAX_ORDER_NUMBER_ATTEMPTS; attempt += 1) {
    const candidate = orderNumberCandidate(datePart)
    if (!(await isTaken(candidate))) return candidate
  }
  throw new Error(
    `order number generation failed after ${MAX_ORDER_NUMBER_ATTEMPTS} attempts — ` +
      'this is not bad luck at this alphabet size. Suspect the generator or the ' +
      'uniqueness check, not the odds.',
  )
}
