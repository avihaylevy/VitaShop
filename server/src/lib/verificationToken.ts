import { createHash, randomBytes } from 'node:crypto'

/**
 * MILESTONE-006 clause A4 — verification and password-reset tokens.
 *
 * 🔴 THE HASH HERE IS SHA-256 AND IT IS NOT THE PASSWORD HASH.
 * This milestone installs argon2 (DEC-052 Part 1) and reusing it here is the
 * obvious next move. It does not work: argon2 and bcrypt are SALTED, so
 * hashing the same token twice yields two different strings and a lookup of
 * the form `WHERE token = $1` matches NOTHING — every verification and reset
 * link in the system would fail.
 *
 * SHA-256 is sufficient *because of what these values are*: >= 256 bits of
 * server-generated randomness, not a user-chosen secret. The slow-hash
 * rationale exists to make brute-forcing a low-entropy password expensive;
 * there is nothing here to brute-force. A fast deterministic digest is the
 * correct tool and the only one that permits an indexed equality lookup on a
 * `@unique` column. See DEC-052 Part 3.
 */

/** A4: at least 32 bytes from a cryptographically secure source. */
const TOKEN_BYTES = 32

/** REQ-F-031 / DEC-007: the link is valid for 24 hours. */
export const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000

export interface IssuedToken {
  /** Goes in the emailed link. 🔴 Never stored, never logged. */
  plaintext: string
  /** Goes in the database `token` column. */
  digest: string
  /** REQ-F-031 — 24 hours from issue. */
  expiresAt: Date
}

export function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext, 'utf8').digest('hex')
}

export function issueVerificationToken(now: Date = new Date()): IssuedToken {
  const plaintext = randomBytes(TOKEN_BYTES).toString('base64url')
  return {
    plaintext,
    digest: hashToken(plaintext),
    expiresAt: new Date(now.getTime() + VERIFICATION_TOKEN_TTL_MS),
  }
}

/**
 * REQ-F-031 — single-use and time-limited, both enforced here rather than at
 * the call site, so neither can be forgotten by one caller.
 *
 * `usedAt` being set is what makes a token single-use: the row is kept (the
 * record of a completed verification is worth having) but can never be
 * redeemed twice.
 */
export function isTokenRedeemable(
  token: { expiresAt: Date; usedAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (token.usedAt !== null) return false
  return token.expiresAt.getTime() > now.getTime()
}
