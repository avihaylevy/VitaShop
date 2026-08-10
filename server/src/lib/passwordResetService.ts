import argon2 from 'argon2'
import type { PrismaClient } from '@prisma/client'
import type { EmailService } from './emailService.js'
import { emailStrings } from './emailStrings.js'
import { normalizeEmail } from './normalizeEmail.js'
import { ARGON2_OPTIONS, burnEquivalentHashCost } from './registrationService.js'
import { invalidateUserSessions } from './sessionInvalidation.js'
import {
  hashToken,
  isTokenRedeemable,
  issuePasswordResetToken,
  PASSWORD_RESET_TOKEN_TTL_HOURS,
} from './verificationToken.js'

/**
 * MILESTONE-006 Checkpoint F — password reset. REQ-F-032.
 *
 * Implements A3 (always-200), A4 (SHA-256 token at rest) and A8 (invalidate
 * the user's sessions), reusing D's token and hash-cost modules rather than
 * growing second copies of either.
 */

/**
 * 🔴 FROZEN AT CHECKPOINT F — does the acting session survive its own reset?
 *
 * A8 permits excluding the current sid but does not say whether to, and
 * leaving it unstated means whoever writes the handler decides it by accident.
 *
 * DECISION: **NO. Every session is destroyed, including the one that performed
 * the reset.** `invalidateUserSessions` is called with no `exceptSid`.
 *
 * WHY, since keeping it is the friendlier option: the entire reason DEC-018
 * chose sessions over JWT was that revocation must be immediate, and the
 * threat model for a reset is *someone else already has access*. If an
 * attacker holds a live session and the real owner resets, sparing "the acting
 * session" is meaningless — the owner is not the one acting in the attacker's
 * session, and the attacker is not the one resetting. Excluding a sid only
 * helps the person doing the reset, and costs them one login.
 *
 * A user resetting their own password is already at a password prompt. Asking
 * them to use the password they just chose is not a burden; leaving a session
 * alive because it is convenient is how a revoked credential outlives the
 * event that revoked it — THREAT-009 exactly.
 */
const INVALIDATE_ALL_SESSIONS_INCLUDING_ACTING = true

export interface PasswordResetDeps {
  prisma: PrismaClient
  emailService: EmailService
  appBaseUrl: string
  now?: () => Date
}

export interface RequestResetOutcome {
  /**
   * 🔴 NEVER surfaces in the response — A3 requires an identical 200 either
   * way. It exists so the route knows whether to send mail, and so tests can
   * assert behaviour the response deliberately hides.
   */
  userExists: boolean
  plaintextToken: string | null
  email: string
}

/**
 * A3 — request a reset. Always succeeds from the caller's point of view.
 */
export async function requestPasswordReset(
  rawEmail: string,
  deps: PasswordResetDeps,
): Promise<RequestResetOutcome> {
  const now = deps.now?.() ?? new Date()
  const email = normalizeEmail(rawEmail)

  const user = await deps.prisma.user.findUnique({
    where: { email },
    select: { id: true, status: true },
  })

  // 🔴 A2's timing reasoning, applied to A3. The exists path generates a token
  // and writes a row; the unknown path must not return measurably faster or
  // the identical body is undone by the clock. A token generation is cheap, so
  // the cost that actually matters is matched with one argon2 hash — the same
  // trick DEC-053 4b uses on /register, and the same function.
  if (!user) {
    await burnEquivalentHashCost(email)
    return { userExists: false, plaintextToken: null, email }
  }

  // A disabled account gets no reset link — but the caller cannot tell,
  // because the response is identical. Sending one would let a disabled user
  // walk their way back to a working credential.
  if (user.status === 'disabled') {
    await burnEquivalentHashCost(email)
    return { userExists: false, plaintextToken: null, email }
  }

  const token = issuePasswordResetToken(now)
  await deps.prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      token: token.digest, // 🔴 A4 — SHA-256 digest, never the plaintext
      expiresAt: token.expiresAt,
    },
  })

  return { userExists: true, plaintextToken: token.plaintext, email }
}

export function buildPasswordResetEmail(baseUrl: string, plaintextToken: string) {
  const link = `${baseUrl.replace(/\/$/, '')}/reset-password?token=${plaintextToken}`
  // 🔴 DEC-054 — the wording lives in emailStrings, not here.
  return emailStrings.passwordReset(link, PASSWORD_RESET_TOKEN_TTL_HOURS)
}

export type CompleteResetOutcome =
  | { ok: true; userId: string; email: string; sessionsDestroyed: number }
  // Carries no reason, for the same purpose as the login outcome: nothing to
  // leak even by accident.
  | { ok: false }

/**
 * Complete a reset: redeem the token, set the new hash, and 🔴 invalidate
 * every session belonging to that user (A8).
 */
export async function completePasswordReset(
  plaintextToken: string,
  newPassword: string,
  deps: PasswordResetDeps,
): Promise<CompleteResetOutcome> {
  const now = deps.now?.() ?? new Date()

  // A4 — the plaintext is not stored, so the digest is the only way to find it.
  const record = await deps.prisma.passwordResetToken.findUnique({
    where: { token: hashToken(plaintextToken) },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      usedAt: true,
      user: { select: { email: true, status: true } },
    },
  })

  if (!record || !isTokenRedeemable(record, now)) return { ok: false }

  // Same reasoning as verify-email's status guard: a disabled account must not
  // be able to reset its way back to a usable credential.
  if (record.user.status === 'disabled') return { ok: false }

  const passwordHash = await argon2.hash(newPassword, ARGON2_OPTIONS)

  await deps.prisma.$transaction(async (tx) => {
    // Single-use: stamping usedAt is what spends it.
    await tx.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: now },
    })
    await tx.user.update({
      where: { id: record.userId },
      data: {
        passwordHash,
        // A5 — a successful reset clears any lockout. The user has proven
        // control of the mailbox; leaving them locked out would be punishing
        // them for the attack that locked them.
        failedLoginCount: 0,
        lockedUntil: null,
      },
    })
  })

  // 🔴 A8 — AFTER the commit. This is raw SQL on the session store's own pool
  // (never Prisma), and it is deliberately outside the transaction: the
  // session table is not Prisma's to roll back, exactly as DEC-053 Rule 2
  // established for regeneration. A failure here must not undo the new
  // password — the user would be left unable to log in with either credential.
  const sessionsDestroyed = await invalidateUserSessions(
    record.userId,
    INVALIDATE_ALL_SESSIONS_INCLUDING_ACTING ? {} : { exceptSid: undefined },
  )

  return {
    ok: true,
    userId: record.userId,
    email: record.user.email,
    sessionsDestroyed,
  }
}
