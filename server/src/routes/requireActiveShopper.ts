import type { RequestHandler } from 'express'
import type { PrismaClient } from '@prisma/client'

/**
 * MILESTONE-008 — ISSUE-091 and ISSUE-092, answered together because they are
 * one question: which account statuses may do what, and where is that decided.
 *
 * 🔴 BEFORE THIS, NO SHOPPER ROUTE READ `User.status` AT ALL. `attemptLogin`
 * blocked `disabled` at sign-in and nothing checked again, so:
 *
 *   · disabling an account invalidated nothing. The existing cookie still
 *     opened `/checkout/pay` and `/orders/:id/cancel`, and a suspended shopper
 *     kept creating orders and moving stock (ISSUE-092)
 *   · REQ-F-031 — "an unverified account cannot complete an order", `Approved`,
 *     straight from the specification — was enforced NOWHERE. A9 handed that
 *     gate to M-008 as O3 and nothing implemented it (ISSUE-091)
 *
 * ⚠️ THE ADMIN SIDE ALREADY GOT THIS RIGHT. `requireAdmin` reads the row on
 * every request precisely because "the session outlives the account row it
 * names" (DEC-065). This is the shopper-side counterpart, and it follows the
 * same three rules: read per request, fail closed, say as little as possible.
 *
 * 🔴 TWO LEVELS, NOT ONE, AND THE DIFFERENCE IS LOAD-BEARING.
 *
 *   requireActiveShopper    not `disabled`. Every authenticated route.
 *   requireVerifiedShopper  the above, and not `pending_verification`.
 *                           The ORDER routes only.
 *
 * A single blanket guard would refuse an unverified shopper their own profile,
 * which is how `/api/account/profile` shipped a login loop: 401, the client
 * reads "session expired", the login succeeds, repeat. REQ-F-031 gates
 * COMPLETING AN ORDER — not reading your own name, and not cancelling an order
 * you already have.
 */

type StatusVerdict =
  | { ok: true; status: string }
  | { ok: false; kind: 'anonymous' | 'gone' | 'unavailable' }

async function readStatus(prisma: PrismaClient, userId: unknown): Promise<StatusVerdict> {
  if (typeof userId !== 'string' || userId === '') return { ok: false, kind: 'anonymous' }
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } })
    if (!user) return { ok: false, kind: 'gone' }
    return { ok: true, status: user.status }
  } catch (error) {
    // 🔴 FAIL CLOSED. A database error must never be mistaken for a permitted
    // status — a check that opens on failure is worse than no check, because it
    // reads as protected. Same reasoning as `requireAdmin`'s 503.
    console.error(`[shopper] status lookup failed for ${String(userId)}`, error)
    return { ok: false, kind: 'unavailable' }
  }
}

/**
 * Signed in, and the account is not disabled.
 *
 * 🔴 A REFUSAL HERE DESTROYS THE SESSION. Answering 401 while leaving the
 * cookie valid is what let a disabled account keep working everywhere the
 * guard was not mounted; destroying it means one refused request ends the
 * session everywhere at once.
 */
export function createRequireActiveShopper(prisma: PrismaClient): RequestHandler {
  return async (req, res, next) => {
    const verdict = await readStatus(prisma, req.session?.userId)

    if (!verdict.ok) {
      if (verdict.kind === 'unavailable') {
        res.status(503).json({
          error: { code: 'STATUS_CHECK_UNAVAILABLE', message: 'Try again shortly.' },
        })
        return
      }
      // `gone` and `anonymous` answer identically: the session names nobody who
      // can act, and the response reveals nothing about which case it was.
      if (verdict.kind === 'gone') req.session?.destroy(() => {})
      res.status(401).json({
        error: { code: 'AUTHENTICATION_REQUIRED', message: 'Sign in to continue.' },
      })
      return
    }

    if (verdict.status === 'disabled') {
      req.session?.destroy(() => {})
      res.status(401).json({
        error: { code: 'AUTHENTICATION_REQUIRED', message: 'Sign in to continue.' },
      })
      return
    }

    next()
  }
}

/**
 * DEC-074's guard for the two order READS — the account must EXIST, and
 * nothing more.
 *
 * 🔴 WHY THIS EXISTS (review finding on DEC-074's first cut): swapping
 * `requireActiveShopper` for the bare session guard also dropped the
 * GONE-ACCOUNT teardown, so a session naming a DELETED user row answered
 * `200 []` forever — a phantom session rendering "no orders" instead of
 * sending its holder to sign in. DEC-074 loosened exactly one thing, the
 * `disabled` status; existence was never part of that decision.
 */
export function createRequireShopperAccount(prisma: PrismaClient): RequestHandler {
  return async (req, res, next) => {
    const verdict = await readStatus(prisma, req.session?.userId)

    if (!verdict.ok) {
      if (verdict.kind === 'unavailable') {
        res.status(503).json({
          error: { code: 'STATUS_CHECK_UNAVAILABLE', message: 'Try again shortly.' },
        })
        return
      }
      if (verdict.kind === 'gone') req.session?.destroy(() => {})
      res.status(401).json({
        error: { code: 'AUTHENTICATION_REQUIRED', message: 'Sign in to continue.' },
      })
      return
    }

    // Any EXISTING status passes — `disabled` included, per DEC-074: a
    // suspension stops acting, not reading one's own purchase records.
    next()
  }
}

/**
 * REQ-F-031's gate — O3, finally enforced.
 *
 * 🔴 403, NOT 401, and the code NAMES the cause. A 401 tells the shopper to
 * sign in, which they have already done and which will not help; they must
 * open the verification mail. This project's own lesson, twice over: a refusal
 * that does not say what to do next is a dead end (ISSUE-080, and the
 * checkout screen's own blocked-order branch).
 *
 * ⚠️ It does NOT gate `/orders/:id/cancel`. Cancelling is not completing an
 * order, and an unverified shopper holding a pending order must be able to
 * get out of it.
 */
export function createRequireVerifiedShopper(prisma: PrismaClient): RequestHandler {
  return async (req, res, next) => {
    /*
     * 🔴 ONE READ, NOT TWO. The first version composed this guard out of
     * `requireActiveShopper` and then read the row AGAIN for the verification
     * rule — two round trips per request to answer one question about one
     * row, on the hottest authenticated path in the application.
     *
     * ⚠️ IT WAS NOT MERELY WASTEFUL. With the doubled load, unrelated tests in
     * `checkout.integration.test.ts` began failing intermittently — a
     * DIFFERENT test each run, always around the post-commit email. Both
     * guards ask the same question of the same row; asking once is the fix and
     * the composition was the bug.
     */
    const verdict = await readStatus(prisma, req.session?.userId)

    if (!verdict.ok) {
      if (verdict.kind === 'unavailable') {
        res.status(503).json({
          error: { code: 'STATUS_CHECK_UNAVAILABLE', message: 'Try again shortly.' },
        })
        return
      }
      if (verdict.kind === 'gone') req.session?.destroy(() => {})
      res.status(401).json({
        error: { code: 'AUTHENTICATION_REQUIRED', message: 'Sign in to continue.' },
      })
      return
    }

    if (verdict.status === 'disabled') {
      req.session?.destroy(() => {})
      res.status(401).json({
        error: { code: 'AUTHENTICATION_REQUIRED', message: 'Sign in to continue.' },
      })
      return
    }

    if (verdict.status === 'pending_verification') {
      res.status(403).json({
        error: {
          code: 'EMAIL_NOT_VERIFIED',
          message: 'Verify your email address before completing an order.',
        },
      })
      return
    }

    next()
  }
}
