import { Router } from 'express'
import type { PrismaClient } from '@prisma/client'
import { applyTransition } from '../lib/orderTransitionService.js'
import { createOrderRateLimiters, type OrderRateLimiters } from '../lib/rateLimit.js'
import { requireShopper } from './requireShopper.js'

/**
 * MILESTONE-008 Checkpoint E3 — the shopper's own order actions.
 *
 * 🔴 SHOPPER-ONLY, BY DECISION (user, 2026-08-13). §8.9 gives four transitions
 * to ADMIN ONLY — `paid -> processing`, `processing -> shipped`,
 * `processing -> cancelled`, `shipped -> delivered` — and **there is no admin
 * authorization anywhere in this server**. `UserRole` and `User.role` exist in
 * the schema, nothing reads them, and the session carries only `userId`.
 * Building those routes means building a security guard that gates stock
 * restoration and fulfilment, which is not in Checkpoint E's contract. It is
 * filed as its own issue for MILESTONE-010, the admin/audit milestone the
 * schema notes already point at.
 *
 * ⚠️ THE ADMIN TRANSITIONS ARE ALREADY ENFORCED AND TESTED at the service —
 * they are simply unreachable over HTTP. Nothing here weakens the table.
 *
 * 🔴 THE ROUTE DECIDES NOTHING ABOUT THE STATE MACHINE. Whether a cancellation
 * is legal, who may make it and whether stock returns is `orderTransitions.ts`'s
 * answer; performing it atomically is `orderTransitionService.ts`'s. This file
 * reads a request, checks ownership, and maps an answer to a status code.
 */

export type OrderRouterDeps = {
  prisma: PrismaClient
  /** Injectable so a coverage test can identify the limiter, not merely count it. */
  rateLimiters?: OrderRateLimiters
}

export function createOrderRouter(deps: OrderRouterDeps): ReturnType<typeof Router> {
  const { prisma } = deps
  const limiters = deps.rateLimiters ?? createOrderRateLimiters()
  const router = Router()

  /**
   * REQ-F-045's sibling: the shopper withdrawing an order they placed.
   *
   * §8.9 permits `pending_payment -> cancelled` and `paid -> cancelled` for a
   * shopper, and stops there — fulfilment begins at `processing`.
   */
  router.post('/:id/cancel', limiters.cancel, requireShopper, async (req, res) => {
    const userId = req.session!.userId!
    // ⚠️ Narrowed rather than asserted. Express types a path parameter as
    // possibly an array, and an array reaching a Prisma `where` is a type error
    // at best and a malformed query at worst.
    const orderId = typeof req.params.id === 'string' ? req.params.id : ''
    if (orderId === '') {
      res.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'No such order.' } })
      return
    }

    // ── OWNERSHIP, AND IT IS ANSWERED AS 404 ───────────────────────────────
    // 🔴 THE IDOR SHAPE, AND THE STATUS CODE IS THE CONTROL. Another shopper's
    // order must be indistinguishable from one that does not exist. A 403 would
    // confirm the id is real — an enumeration oracle over every order in the
    // store, which is exactly the defect ISSUE-067 closed on the auth side and
    // which TEST-050b exists to prevent on this one.
    //
    // ⚠️ Scoped in the WHERE rather than fetched and compared, so there is no
    // branch that can be written the wrong way round.
    const order = await prisma.order.findFirst({
      where: { id: orderId, userId },
      select: { id: true },
    })
    if (!order) {
      res.status(404).json({
        error: { code: 'ORDER_NOT_FOUND', message: 'No such order.' },
      })
      return
    }

    // 🔴 WRAPPED, BECAUSE IT CAN THROW. P2028 when the restore loop waits on a
    // product lock held by an in-flight checkout, a deadlock, a connection
    // reset. Unwrapped, Express 5 forwards the rejection to its BUILT-IN error
    // handler, which answers with an HTML body — not this project's
    // `{ error: { code, message } }` envelope that every client parser expects —
    // and includes the stack whenever NODE_ENV is not 'production'.
    // ⚠️ `routes/checkout.ts` wraps the identical call for exactly this reason.
    let result: Awaited<ReturnType<typeof applyTransition>>
    try {
      result = await applyTransition(prisma, {
        orderId: order.id,
        to: 'cancelled',
        actor: 'shopper',
        actorUserId: userId,
      })
    } catch (error) {
      console.error(`[orders] cancelling ${order.id} threw`, error)
      res.status(500).json({
        error: {
          code: 'CANCELLATION_FAILED',
          message: 'The order could not be cancelled just now. Please try again.',
        },
      })
      return
    }

    if (result.ok) {
      // 🔴 AN ALREADY-CANCELLED ORDER ANSWERS 200, NOT AN ERROR. A shopper who
      // taps twice, or whose first response was dropped, has got what they
      // asked for. Reporting a conflict for a request whose outcome already
      // holds is how a retry becomes a support ticket.
      res.status(200).json({
        orderId: order.id,
        status: 'cancelled',
        alreadyCancelled: !result.moved,
        restoredStock: result.moved ? result.restoredStock : false,
      })
      return
    }

    // 🔴 THE THREE REFUSALS MEAN DIFFERENT THINGS AND GET DIFFERENT CODES.
    // `FORBIDDEN_FOR_ACTOR` is the shopper asking for a move that exists but is
    // not theirs — fulfilment has begun, and an admin still can. 403 says "not
    // yours", which leaves them somewhere to go; 409 would say "impossible",
    // which is untrue and ends the conversation.
    // ⚠️ `ORDER_NOT_FOUND` IS 404 HERE TOO. It is reachable — the row can
    // disappear between the ownership check above and the transition — and
    // answering 409 would contradict this route's own 404 policy thirty lines
    // up, handing the caller two different codes for one condition.
    const status =
      result.reason === 'FORBIDDEN_FOR_ACTOR' ? 403 : result.reason === 'ORDER_NOT_FOUND' ? 404 : 409
    res.status(status).json({
      error: { code: result.reason, message: messageFor(result.reason) },
    })
  })

  return router
}

function messageFor(reason: string): string {
  switch (reason) {
    case 'ORDER_NOT_FOUND':
      return 'No such order.'
    case 'FORBIDDEN_FOR_ACTOR':
      return 'This order is already being prepared and can no longer be cancelled here.'
    case 'TERMINAL':
      return 'This order is already complete.'
    case 'CONCURRENT_TRANSITION':
      return 'The order changed while this was being processed. Try again.'
    default:
      return 'This order cannot be cancelled.'
  }
}
