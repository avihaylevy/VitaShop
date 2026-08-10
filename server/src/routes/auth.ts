import { Router } from 'express'
import type { PrismaClient } from '@prisma/client'
import type { EmailService } from '../lib/emailService.js'
import {
  attemptLogin,
  LOGIN_FAILURE_CODE,
  LOGIN_FAILURE_MESSAGE,
} from '../lib/loginService.js'
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

  // POST /api/auth/login — REQ-F-032, REQ-F-033. Checkpoint E.
  //
  // 🔴 DEC-053 RULE 3: the SAME capture → commit → regenerate ordering as
  // registration. A6 regenerates here too, and DEC-019's cart MERGE branch
  // attaches at the same seam.
  router.post('/auth/login', async (req, res) => {
    // ── Step 1: capture the guest identity, before regeneration ────────────
    // Same reason as registration: `Cart.session_id` IS this value, and after
    // step 5 it is a different one. O8's precondition applies equally here.
    const guestSessionId = req.sessionID

    const body = req.body as { email?: unknown; password?: unknown }
    if (typeof body?.email !== 'string' || typeof body?.password !== 'string') {
      // 🔴 A1 again: a malformed body gets the SAME failure as a wrong
      // password. A distinct "email is required" would let an attacker probe
      // the shape of the endpoint, and there is no reason to help.
      res.status(401).json({
        error: { code: LOGIN_FAILURE_CODE, message: LOGIN_FAILURE_MESSAGE },
      })
      return
    }

    const outcome = await attemptLogin({ email: body.email, password: body.password }, deps)

    if (!outcome.ok) {
      // 🔴 A1 — one message, one status, one body, for unknown email, wrong
      // password, locked account and disabled account alike. `outcome` carries
      // no reason, so there is nothing here to leak even by accident.
      res.status(401).json({
        error: { code: LOGIN_FAILURE_CODE, message: LOGIN_FAILURE_MESSAGE },
      })
      return
    }

    // ══════════ SEAM: MERGE-GUEST-CART ════════════════════════════════════
    //
    // 🔴 DELIBERATELY EMPTY IN MILESTONE-006. Do not remove it.
    //
    // Owner: REQ-F-020 · DEC-019's LOGIN branch (merge, not promote —
    // quantities summed per productId, clamped to stock, zero-stock dropped,
    // transactional and idempotent) · MILESTONE-007.
    //
    // It sits HERE — after the credentials are known good, before the
    // regeneration below — because DEC-053 Rule 3 puts any transactional work
    // before the commit, and regeneration after it. M-007 will need its own
    // transaction around the merge; that transaction must close before step 5.
    //
    // 🔴 O8's precondition applies: `guestSessionId` is only meaningful if the
    // guest session was persisted.
    void guestSessionId

    // ── Step 5: regenerate AFTER the credential check and any commit ───────
    // A6 — session fixation. Everything transactional above has completed.
    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((err) => (err ? reject(err) : resolve()))
    })
    // A8 — the invalidation helper matches on this.
    ;(req.session as unknown as { userId?: string }).userId = outcome.userId
    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()))
    })

    res.json({ status: 'authenticated' })
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
