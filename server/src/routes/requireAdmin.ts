import type { PrismaClient } from '@prisma/client'
import type { RequestHandler } from 'express'

/**
 * MILESTONE-008 — the admin role check. ISSUE-083, DEC-065.
 *
 * 🔴 THE ROLE IS READ FROM THE DATABASE ON EVERY REQUEST, and that is the
 * decision rather than an implementation detail (user, 2026-08-13).
 *
 * ⚠️ THE REJECTED ALTERNATIVE WAS CACHING IT IN THE SESSION AT LOGIN, and it
 * fails at exactly the moment the check matters: **revocation**. Demote an
 * admin and a cached role keeps their rights until the session expires — and
 * this project's sessions are long-lived by design. Fixing that needs a
 * session-invalidation sweep, which is more machinery than the lookup it was
 * avoiding.
 *
 * The cost is one primary-key lookup on `/api/admin/*` only. Those routes are
 * low-traffic by their nature; the shopper's path never pays for this.
 *
 * 🔴 IT DOES NOT AUTHENTICATE — `requireShopper` runs first and answers 401.
 * This answers 403. The two are deliberately separate:
 *
 *   401  you are not signed in            → sign in
 *   403  you are signed in, and it is     → ask someone who can
 *        not yours to do
 *
 * Collapsing them would tell a signed-in shopper to sign in, and would let an
 * anonymous caller learn that the route exists and is role-gated.
 */
export function createRequireAdmin(prisma: PrismaClient): RequestHandler {
  return async (req, res, next) => {
    const userId = req.session?.userId
    if (typeof userId !== 'string' || userId === '') {
      // Defensive only — `requireShopper` should have refused already. Answered
      // as 401 rather than 403 so the two guards cannot disagree if the mount
      // order is ever changed.
      res.status(401).json({
        error: { code: 'AUTHENTICATION_REQUIRED', message: 'Sign in to continue.' },
      })
      return
    }

    let role: string | undefined
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true, status: true },
      })
      // 🔴 A DELETED OR SUSPENDED ACCOUNT IS NOT AN ADMIN, whatever the session
      // still says. The session outlives the account row it names, and this is
      // the only place that difference is checked on an admin route.
      if (user && user.status === 'active') role = user.role
    } catch (error) {
      // 🔴 FAIL CLOSED. A database error must never be mistaken for a granted
      // role — a permission check that opens on failure is worse than no check
      // at all, because it reads as protected.
      console.error(`[admin] role lookup failed for ${userId}`, error)
      res.status(503).json({
        error: { code: 'ROLE_CHECK_UNAVAILABLE', message: 'Try again shortly.' },
      })
      return
    }

    if (role !== 'admin') {
      // ⚠️ SAYS NOTHING ABOUT THE ORDER, or about whether one exists. A
      // non-admin learns only that this is not theirs to do.
      res.status(403).json({
        error: { code: 'ADMIN_REQUIRED', message: 'This action requires an administrator.' },
      })
      return
    }

    next()
  }
}
