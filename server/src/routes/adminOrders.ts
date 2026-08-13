import { Router } from 'express'
import type { PrismaClient } from '@prisma/client'
import { applyTransition } from '../lib/orderTransitionService.js'
import { ORDER_STATUSES, type OrderStatusName } from '../lib/orderTransitions.js'
import { createAdminRateLimiters, type AdminRateLimiters } from '../lib/rateLimit.js'
import { requireShopper } from './requireShopper.js'
import { createRequireAdmin } from './requireAdmin.js'

/**
 * MILESTONE-008 — the four ADMIN-ONLY transitions from §8.9. ISSUE-083.
 *
 * 🔴 WHY THIS EXISTS AT ALL. §8.9 gives four moves to admins —
 * `paid -> processing`, `processing -> shipped`, `processing -> cancelled`,
 * `shipped -> delivered` — and until now **none of them could be reached by
 * anyone**, because the server had no admin authorization. An order could not
 * progress past `paid` by any means the running system offered.
 *
 * ⚠️ THERE ARE NO SCREENS HERE, BY DECISION (user, 2026-08-13). The admin UI is
 * MILESTONE-010's entire content, and a minimal orders screen comes with
 * Checkpoint F where the UI work already is. These routes are drivable with an
 * HTTP client today and are what F's screen will call.
 *
 * 🔴 THE ROUTE DECIDES NOTHING ABOUT THE STATE MACHINE. Whether a move is
 * legal, who may make it and whether stock returns is `orderTransitions.ts`'s
 * answer; performing it atomically is `orderTransitionService.ts`'s. This file
 * checks the caller, reads a status, and maps an answer to a code.
 */

export type AdminOrderRouterDeps = {
  prisma: PrismaClient
  /** Injectable so the coverage test can identify the limiter, not count it. */
  rateLimiters?: AdminRateLimiters
}

/** The four an admin may ask for. Quoted from §8.9, not invented here. */
const ADMIN_TARGETS: readonly OrderStatusName[] = ['processing', 'shipped', 'delivered', 'cancelled']

export function createAdminOrderRouter(deps: AdminOrderRouterDeps): ReturnType<typeof Router> {
  const { prisma } = deps
  const limiters = deps.rateLimiters ?? createAdminRateLimiters()
  const requireAdmin = createRequireAdmin(prisma)
  const router = Router()

  /**
   * 🔴 THE MIDDLEWARE ORDER IS THE CONTRACT:
   *   limiter        — before the guards, so an unauthenticated flood is
   *                    bounded rather than reaching the session store freely
   *   requireShopper — 401 for anonymous
   *   requireAdmin   — 403 for a signed-in non-admin, role read PER REQUEST
   */
  router.patch(
    '/:id/status',
    limiters.status,
    requireShopper,
    requireAdmin,
    async (req, res) => {
      const adminId = req.session!.userId!
      const orderId = typeof req.params.id === 'string' ? req.params.id : ''
      const body = (req.body ?? {}) as Record<string, unknown>
      const target = body.status

      if (orderId === '') {
        res.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'No such order.' } })
        return
      }

      // 🔴 CHECKED AGAINST THE ENUM BEFORE IT REACHES THE SERVICE. An unknown
      // string would otherwise be compared against the table and reported as
      // NOT_A_TRANSITION — technically true, and it would tell an admin the
      // move is impossible when the real problem is a typo.
      if (typeof target !== 'string' || !ORDER_STATUSES.includes(target as OrderStatusName)) {
        res.status(400).json({
          error: {
            code: 'INVALID_STATUS',
            message: `status must be one of: ${ORDER_STATUSES.join(', ')}`,
          },
        })
        return
      }

      // ⚠️ NARROWER THAN THE ENUM ON PURPOSE. `pending_payment` and `paid` are
      // reachable only as the SYSTEM (the payment) or the SHOPPER (a cancel) —
      // §8.9 gives an admin neither. Letting an admin ask for `paid` here would
      // be an admin marking an order paid, which is not a fulfilment action and
      // has no requirement behind it.
      if (!ADMIN_TARGETS.includes(target as OrderStatusName)) {
        res.status(403).json({
          error: {
            code: 'NOT_AN_ADMIN_TRANSITION',
            message: `An administrator may move an order to: ${ADMIN_TARGETS.join(', ')}`,
          },
        })
        return
      }

      let result: Awaited<ReturnType<typeof applyTransition>>
      try {
        result = await applyTransition(prisma, {
          orderId,
          to: target as OrderStatusName,
          actor: 'admin',
          actorUserId: adminId,
        })
      } catch (error) {
        // 🔴 The same reasoning as the shopper's cancel route: unwrapped,
        // Express answers with an HTML error page and a stack rather than this
        // project's envelope.
        console.error(`[admin] transition on ${orderId} threw`, error)
        res.status(500).json({
          error: { code: 'TRANSITION_FAILED', message: 'The order could not be updated just now.' },
        })
        return
      }

      if (result.ok) {
        res.status(200).json({
          orderId,
          status: target,
          changed: result.moved,
          restoredStock: result.moved ? result.restoredStock : false,
        })
        return
      }

      const status =
        result.reason === 'ORDER_NOT_FOUND'
          ? 404
          : result.reason === 'FORBIDDEN_FOR_ACTOR'
            ? 403
            : 409
      res.status(status).json({ error: { code: result.reason, message: messageFor(result.reason) } })
    },
  )

  return router
}

function messageFor(reason: string): string {
  switch (reason) {
    case 'ORDER_NOT_FOUND':
      return 'No such order.'
    case 'FORBIDDEN_FOR_ACTOR':
      return 'That move is not an administrator’s to make.'
    case 'TERMINAL':
      return 'This order is already complete and cannot be moved.'
    case 'NOT_A_TRANSITION':
      return 'That is not a legal move from the order’s current status.'
    case 'CONCURRENT_TRANSITION':
      return 'The order changed while this was being processed. Try again.'
    default:
      return 'The order could not be updated.'
  }
}
