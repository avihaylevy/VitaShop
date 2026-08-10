import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  hashToken,
  isTokenRedeemable,
  issueVerificationToken,
  VERIFICATION_TOKEN_TTL_MS,
} from './verificationToken.js'

/** TEST-031 — verification token lifecycle. REQ-F-031 · clause A4. */

describe('TEST-031 — the stored value is a SHA-256 digest, not the plaintext', () => {
  it('🔴 never returns the plaintext as the stored digest', () => {
    const token = issueVerificationToken()
    expect(token.digest).not.toBe(token.plaintext)
    // A database read must not yield a working link. This is the whole point
    // of A4: a dump, a replica or a log line would otherwise hand over every
    // pending verification.
    expect(token.digest).not.toContain(token.plaintext)
  })

  it('stores exactly SHA-256(plaintext) in hex', () => {
    const token = issueVerificationToken()
    const expected = createHash('sha256').update(token.plaintext, 'utf8').digest('hex')
    expect(token.digest).toBe(expected)
    expect(token.digest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('🔴 is DETERMINISTIC — the same input always hashes the same way', () => {
    // This is why A4 forbids argon2 here. argon2 and bcrypt are salted, so
    // two hashes of one token differ and `WHERE token = $1` matches nothing —
    // every verification link in the system would fail. A lookup by digest
    // only works because this digest is stable.
    const plaintext = 'a-fixed-token-value'
    expect(hashToken(plaintext)).toBe(hashToken(plaintext))
  })

  it('uses at least 32 bytes of randomness, and does not repeat', () => {
    const a = issueVerificationToken()
    const b = issueVerificationToken()
    expect(a.plaintext).not.toBe(b.plaintext)
    expect(Buffer.from(a.plaintext, 'base64url').length).toBeGreaterThanOrEqual(32)
  })
})

describe('TEST-031 — 24-hour expiry', () => {
  it('expires exactly 24 hours after issue', () => {
    const now = new Date('2026-08-10T12:00:00.000Z')
    const token = issueVerificationToken(now)
    expect(token.expiresAt.getTime() - now.getTime()).toBe(VERIFICATION_TOKEN_TTL_MS)
    expect(VERIFICATION_TOKEN_TTL_MS).toBe(24 * 60 * 60 * 1000)
  })

  it('is redeemable one second before expiry', () => {
    const now = new Date('2026-08-10T12:00:00.000Z')
    const token = issueVerificationToken(now)
    const justBefore = new Date(token.expiresAt.getTime() - 1000)
    expect(isTokenRedeemable({ ...token, usedAt: null }, justBefore)).toBe(true)
  })

  it('🔴 is NOT redeemable at or after expiry', () => {
    const now = new Date('2026-08-10T12:00:00.000Z')
    const token = issueVerificationToken(now)
    expect(isTokenRedeemable({ ...token, usedAt: null }, token.expiresAt)).toBe(false)
    const later = new Date(token.expiresAt.getTime() + 1)
    expect(isTokenRedeemable({ ...token, usedAt: null }, later)).toBe(false)
  })
})

describe('TEST-031 — single use', () => {
  it('🔴 is not redeemable once usedAt is stamped, even before expiry', () => {
    const now = new Date('2026-08-10T12:00:00.000Z')
    const token = issueVerificationToken(now)
    expect(
      isTokenRedeemable({ ...token, usedAt: new Date('2026-08-10T12:05:00.000Z') }, now),
    ).toBe(false)
  })

  it('a used AND expired token is still refused', () => {
    const now = new Date('2026-08-10T12:00:00.000Z')
    const token = issueVerificationToken(now)
    const later = new Date(token.expiresAt.getTime() + 60_000)
    expect(isTokenRedeemable({ ...token, usedAt: now }, later)).toBe(false)
  })
})
