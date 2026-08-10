import { Router } from 'express'
import type { PrismaClient } from '@prisma/client'
import type { EmailService } from '../lib/emailService.js'
import { parseRegistration } from '../lib/registrationForm.js'
import {
  buildExistingAccountEmail,
  buildVerificationEmail,
  registerUser,
} from '../lib/registrationService.js'
import { hashToken, isTokenRedeemable } from '../lib/verificationToken.js'

/**
 * MILESTONE-006 Checkpoint D — registration and email verification.
 *
 * 🔴 Login, logout, lockout and password reset are NOT here. Checkpoints E
 * and F own them.
 */

export interface AuthRouterDeps {
  prisma: PrismaClient
  emailService: EmailService
  appBaseUrl: string
}

export function createAuthRouter(deps: AuthRouterDeps): Router {
  const router = Router()

  // POST /api/auth/register — REQ-F-030, REQ-F-031.
  //
  // 🔴 The step numbers below are DEC-053 Part 2's, FROZEN. Two of its rules
  // fail SILENTLY if reordered, so the order is not a style choice:
  //   RULE 1  capture before regenerate — else the guest cart is orphaned
  //   RULE 2  COMMIT before regenerate — else a rollback leaves a PHANTOM
  //           SESSION authenticated as a user row that does not exist
  router.post('/auth/register', async (req, res) => {
    // ── Step 1: CAPTURE the guest session identity, before anything else ──
    // 🔴 Must be read here. After step 5 this is a different value, and
    // `Cart.session_id` is keyed to THIS one.
    const guestSessionId = req.sessionID

    // ── Step 2: validate. Server-side, §3.4 / A11. Reject before any write ─
    const parsed = parseRegistration(req.body)
    if (!parsed.ok) {
      res.status(400).json({
        error: {
          code: 'REGISTRATION_INVALID',
          message: 'Registration input failed validation.',
          fields: parsed.fields,
          codes: parsed.codes,
        },
      })
      return
    }

    // ── Steps 3 and 4: transaction (user + token + cart seam), then COMMIT ─
    const outcome = await registerUser(parsed.value, guestSessionId, deps)

    // ── Step 5: regenerate, AFTER the commit ──────────────────────────────
    // Only on the created path: the already-registered path must not hand the
    // requester a session for an account they may not own.
    if (outcome.created && outcome.userId) {
      await new Promise<void>((resolve, reject) => {
        req.session.regenerate((err) => (err ? reject(err) : resolve()))
      })
      // A8 depends on this value being present in the payload.
      ;(req.session as unknown as { userId?: string }).userId = outcome.userId
      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => (err ? reject(err) : resolve()))
      })
    }

    // ── Step 6: respond ───────────────────────────────────────────────────
    // 🔴 DEC-053 4b — IDENTICAL body and status whether or not the account
    // already existed. No 409, no "email already in use", no field that
    // differs. The obvious "helpful" fix here re-opens the enumeration oracle.
    res.status(201).json({
      status: 'registration_received',
      message: 'If the address can be registered, a verification email has been sent.',
    })

    // ── Step 7: send email — AFTER the commit, outside the transaction ─────
    // INV-04, A9, DEC-007. Failure to send must not fail a committed
    // registration, so it is logged and swallowed.
    try {
      if (outcome.created && outcome.verificationToken) {
        const mail = buildVerificationEmail(deps.appBaseUrl, outcome.verificationToken)
        await deps.emailService.send({ to: parsed.value.email, ...mail })
      } else {
        // DEC-053 4b — the existing owner is told instead.
        await deps.emailService.send(buildExistingAccountEmail(parsed.value.email))
      }
    } catch (error) {
      console.error('[auth] verification email failed to send', error)
    }
  })

  // GET /api/auth/verify-email?token=… — REQ-F-031.
  router.get('/auth/verify-email', async (req, res) => {
    const raw = req.query.token
    if (typeof raw !== 'string' || raw.length === 0) {
      res.status(400).json({
        error: { code: 'VERIFICATION_TOKEN_MISSING', message: 'A token is required.' },
      })
      return
    }

    // 🔴 A4 — look the token up by its SHA-256 digest. The plaintext is never
    // stored, so this is the only way to find the row.
    const record = await deps.prisma.emailVerificationToken.findUnique({
      where: { token: hashToken(raw) },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        usedAt: true,
        user: { select: { status: true } },
      },
    })

    // One message for "no such token", "already used" and "expired" — the
    // same enumeration reasoning as A1. A caller learns only that the link
    // does not work now.
    if (!record || !isTokenRedeemable(record)) {
      res.status(400).json({
        error: {
          code: 'VERIFICATION_TOKEN_INVALID',
          message: 'This verification link is not valid.',
        },
      })
      return
    }

    // 🔴 ONLY `pending_verification` MAY BECOME `active`.
    //
    // An unconditional `status: 'active'` would let a DISABLED user restore
    // their own account by clicking an old, unexpired verification link —
    // silent privilege restoration. No disable flow exists yet; Checkpoint F
    // adds one, and by then this would already be live.
    //
    // An already-`active` account is also not re-activated: there is nothing
    // to do, and the token is spent either way.
    const isVerifiable = record.user.status === 'pending_verification'

    await deps.prisma.$transaction(async (tx) => {
      // Single-use (REQ-F-031): stamping `usedAt` is what spends it. The row
      // is kept — a record of a completed verification is worth having.
      // 🔴 The token is spent even when the status is NOT changed, so a
      // rejected link cannot be retried until it happens to be accepted.
      await tx.emailVerificationToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      })

      if (isVerifiable) {
        await tx.user.update({
          where: { id: record.userId },
          data: { status: 'active' },
        })
      }
    })

    if (!isVerifiable) {
      // 🔴 The SAME generic response as an invalid link. Saying "this account
      // is disabled" would confirm both that the address is registered and
      // what state it is in — the enumeration reasoning of A1, applied here.
      res.status(400).json({
        error: {
          code: 'VERIFICATION_TOKEN_INVALID',
          message: 'This verification link is not valid.',
        },
      })
      return
    }

    res.json({ status: 'verified' })
  })

  return router
}
