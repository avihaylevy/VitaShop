import { Router } from 'express'
import type { PrismaClient } from '@prisma/client'
import { applyTransition } from '../lib/orderTransitionService.js'
import {
  ORDER_STATUSES,
  adminTransitionsFrom,
  type OrderStatusName,
} from '../lib/orderTransitions.js'
import { createAdminRateLimiters, type AdminRateLimiters } from '../lib/rateLimit.js'
import {
  countStuckPendingPayment,
  findStuckPendingPayment,
  reconcileStuckOrders,
} from '../lib/orderReconciliation.js'
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

/** One screenful. The admin list is low-traffic and read by a human. */
const ADMIN_ORDERS_PAGE_SIZE = 25

/**
 * MILESTONE-008 Checkpoint G3 review — the sample and the batch, named.
 *
 * 🔴 THESE WERE BOTH AN IMPLICIT 100 inherited from
 * `findStuckPendingPayment`'s default, which made two figures indistinguishable
 * from each other: how many are stuck, and how many one request touches. Naming
 * them is what lets `count` mean the total, `sampled` mean the listing, and
 * `remaining` mean what a second run still has to do.
 */
const STUCK_SAMPLE_SIZE = 20
const REPAIR_BATCH_SIZE = 20

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
  /**
   * MILESTONE-008 Checkpoint F3 — the LIST the admin screen renders.
   *
   * 🔴 THE ROUTES THIS FILE ALREADY HAD COULD CHANGE AN ORDER AND NOT FIND
   * ONE. `PATCH /:id/status` has existed since ISSUE-083's guard half, so an
   * admin could move an order they already knew the id of — and there was no
   * way to learn an id. The screen could not exist.
   *
   * 🔴 LIST ONLY, deliberately. A per-order detail route is MILESTONE-010's,
   * and this returns exactly what a row renders: nothing about lines, nothing
   * about the shopper beyond the email the order was placed under.
   *
   * ⚠️ `allowedTransitions` IS COMPUTED SERVER-SIDE, per row. The screen shows
   * one button per legal move, and the alternative is the browser carrying its
   * own copy of §8.9 — the drift this milestone already paid for once when the
   * client's hand-written reason list blanked the blocked-order screen. It is
   * what a UI should OFFER; the PATCH guard still decides.
   */
  router.get('/', limiters.list, requireShopper, requireAdmin, async (req, res) => {
    const rawPage = Number.parseInt(String(req.query.page ?? '1'), 10)
    /*
     * 🔴 CAPPED, NOT MERELY POSITIVE. `skip: (page - 1) * 25` overflows
     * Prisma's Int for a large page — `?page=100000000` becomes a skip of
     * 2.5e9, the query throws, and the catch below answers 503. That
     * contradicts this route's own contract (a page past the end is an EMPTY
     * page, not an error) and spends the 503 reserved for "we could not read
     * the orders" on a request that was merely silly.
     */
    const MAX_PAGE = 1_000_000
    const page =
      Number.isFinite(rawPage) && rawPage > 0 ? Math.min(rawPage, MAX_PAGE) : 1

    // An unknown status is ignored rather than refused: it filters nothing, and
    // a 400 here would break a bookmarked URL after a status is ever renamed.
    const rawStatus = req.query.status
    const status =
      typeof rawStatus === 'string' && ORDER_STATUSES.includes(rawStatus as OrderStatusName)
        ? (rawStatus as OrderStatusName)
        : undefined

    const where = status ? { status } : {}

    try {
      const [totalItems, orders] = await Promise.all([
        prisma.order.count({ where }),
        prisma.order.findMany({
          where,
          /*
           * 🔴 NEWEST FIRST, WITH A UNIQUE TIEBREAKER — and the tiebreaker is
           * not decoration. Prisma's `@default(now())` maps to Postgres
           * CURRENT_TIMESTAMP, which is TRANSACTION-START time, so every order
           * created inside one transaction (a seed script, a fixture batch)
           * carries a byte-identical `createdAt`. With ties, `skip`/`take`
           * ordering is undefined BETWEEN QUERIES: page 1 and page 2 can show
           * the same order twice and omit another entirely.
           *
           * `id` alone would be arbitrary; `id` after `createdAt` is only ever
           * consulted when the timestamps are equal.
           *
           * ⚠️ NO INDEX SUPPORTS THIS SORT. `Order` carries
           * `@@index([userId, createdAt])`, which a global ordering cannot
           * use, so every list request sorts the table. Fine at this size,
           * recorded rather than discovered later.
           */
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * ADMIN_ORDERS_PAGE_SIZE,
          take: ADMIN_ORDERS_PAGE_SIZE,
          select: {
            id: true,
            orderNumber: true,
            createdAt: true,
            status: true,
            totalAmount: true,
            user: { select: { email: true } },
            _count: { select: { items: true } },
          },
        }),
      ])

      res.json({
        // The same `totalPages` convention the catalogue froze at §4a: zero
        // items is zero pages, not one empty page.
        page,
        totalItems,
        totalPages: Math.ceil(totalItems / ADMIN_ORDERS_PAGE_SIZE),
        orders: orders.map((order) => ({
          id: order.id,
          orderNumber: order.orderNumber,
          createdAt: order.createdAt.toISOString(),
          status: order.status,
          totalAmount: order.totalAmount.toFixed(2),
          customerEmail: order.user.email,
          itemCount: order._count.items,
          allowedTransitions: adminTransitionsFrom(order.status as OrderStatusName),
        })),
      })
    } catch (error) {
      console.error('[admin] listing orders failed', error)
      res.status(503).json({
        error: { code: 'ORDER_LIST_UNAVAILABLE', message: 'Try again shortly.' },
      })
    }
  })

  /**
   * MILESTONE-008 Checkpoint G3 — ISSUE-082's TRIGGER, read half. DEC-069.
   *
   * 🔴 SAFE TO CALL: it changes nothing. ISSUE-082 records this as the cheapest
   * first step precisely because NOTHING COUNTS THESE TODAY — an admin cannot
   * currently tell whether the hole has ever been hit.
   *
   * ⚠️ Mounted BEFORE `/:id/status` is irrelevant (different method), but it
   * must stay above nothing that would treat `stuck` as an order id.
   */
  router.get('/stuck', limiters.list, requireShopper, requireAdmin, async (req, res) => {
    /*
     * ⚠️ `?userId=` SCOPES THE READ, and the repair below takes the same
     * option. Reconciling ONE account is the natural shape of a support request
     * ("this shopper's order is stuck"), and it is what keeps a test from
     * asserting a global property of the database.
     */
    const userId = typeof req.query.userId === 'string' ? req.query.userId : undefined

    try {
      /*
       * 🔴 THE COUNT IS A REAL COUNT, NOT THE SAMPLE'S LENGTH.
       * `findStuckPendingPayment` takes 100 by default, so `stuck.length` is a
       * PAGE SIZE — a screen reporting it says "100 stuck orders" when 400 are
       * stuck, and an admin reads a cap as a total. The sample below is what a
       * human can look at; the count is what is true. Found in review.
       */
      const [count, stuck] = await Promise.all([
        countStuckPendingPayment(prisma, userId ? { userId } : {}),
        findStuckPendingPayment(prisma, {
          ...(userId ? { userId } : {}),
          limit: STUCK_SAMPLE_SIZE,
        }),
      ])
      res.json({
        count,
        /** ⚠️ NAMED so the client cannot mistake a capped sample for the lot. */
        sampled: stuck.length,
        orders: stuck.map((order) => ({
          id: order.id,
          orderNumber: order.orderNumber,
          createdAt: order.createdAt.toISOString(),
        })),
      })
    } catch (error) {
      console.error('[admin] counting stuck orders failed', error)
      res.status(503).json({
        error: { code: 'RECONCILE_UNAVAILABLE', message: 'Try again shortly.' },
      })
    }
  })

  /**
   * 🔴 THE REPAIR — and the reason DEC-069 chose an admin action over a
   * schedule. Nothing in this project runs scheduled work; a job runner is its
   * own dependency decision, and a bare `setInterval` would be a background
   * writer firing in every dev and test process.
   *
   * 🔴 THIS ROUTE MARKS ORDERS PAID. That is why it sits behind `requireAdmin`
   * with the tightest ceiling on this router, and why the integration tests
   * assert the refusals against the DATABASE rather than against a status code:
   * a shopper who could reach this could settle their own unpaid order.
   *
   * ⚠️ IT IS A TRIGGER AND NOTHING MORE. Whether a move is legal stays in
   * `orderTransitions.ts`, performing it atomically stays in
   * `orderTransitionService.ts`, and deciding what counts as stuck stays in
   * `orderReconciliation.ts` — which carries the load-bearing assumption that
   * orders are created only AFTER payment succeeds. If that ordering ever
   * changes, this button starts inventing revenue.
   */
  router.post('/reconcile', limiters.reconcile, requireShopper, requireAdmin, async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const userId = typeof body.userId === 'string' ? body.userId : undefined

    try {
      /*
       * ⚠️ A BOUNDED BATCH, and `remaining` is how the caller learns there is
       * more. An unbounded sweep is a long-running write holding the request
       * open; a bounded one that says nothing about the rest reads as complete.
       */
      const report = await reconcileStuckOrders(prisma, {
        ...(userId ? { userId } : {}),
        limit: REPAIR_BATCH_SIZE,
      })
      /*
       * 🔴 HOW MANY ARE STILL STUCK AFTERWARDS, because one sweep repairs at
       * most `findStuckPendingPayment`'s cap of 100. Without this a run that
       * hit the cap looks complete: the report says "100 repaired" and says
       * nothing about the 300 left behind. Found in review, which also caught
       * that this router's rate-limit comment claimed a second run "repairs
       * nothing the first left" — untrue at exactly this boundary.
       */
      const remaining = await countStuckPendingPayment(prisma, userId ? { userId } : {})
      // The report IS the answer: a partial repair is the normal case, and
      // reporting only success would hide which orders are still stuck.
      res.json({ ...report, remaining })
    } catch (error) {
      console.error('[admin] reconciliation failed', error)
      res.status(503).json({
        error: { code: 'RECONCILE_UNAVAILABLE', message: 'Try again shortly.' },
      })
    }
  })

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
