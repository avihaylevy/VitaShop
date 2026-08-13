import type { PrismaClient } from '@prisma/client'
import { applyTransition } from './orderTransitionService.js'

/**
 * MILESTONE-008 Checkpoint E3 — ISSUE-082's reconciliation.
 *
 * 🔴 THE HOLE THIS CLOSES. An order and its payment status are two separate
 * transactions: `createOrder` commits, then the `pending_payment -> paid` move
 * runs. Anything that stops the second leaves an order committed in a state
 * §8.9 allows only `paid` or `cancelled` out of — so **not even an admin can
 * push it to `processing`**. `/checkout/pay` repairs the case where the client
 * retries, but when the failure is swallowed the shopper receives a 201, no
 * retry is ever sent, and nothing else in the system moves the order.
 *
 * ⚠️ NO TRIGGER, BY DECISION (user, 2026-08-13). This is a callable function
 * with tests; nothing in this project runs scheduled work, and adding a job
 * runner is a dependency decision of its own (DEC-030's deferred list). Wiring
 * it to a schedule is a deployment concern.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *
 * 🔴 READ THIS BEFORE CALLING `reconcileStuckOrders` — IT RESTS ON ONE
 * ASSUMPTION ABOUT THE CHECKOUT FLOW, AND THE ASSUMPTION IS LOAD-BEARING.
 *
 * Today `createOrder` runs only AFTER the simulated payment has succeeded
 * (`routes/checkout.ts`, step 3 before step 4). There is therefore no such
 * thing as an order that is legitimately awaiting payment: every order sitting
 * in `pending_payment` past the in-flight window is one whose transition
 * failed, and advancing it to `paid` restores the truth.
 *
 * ⚠️ THE DAY THAT ORDERING CHANGES — an order created before payment, a real
 * provider with an asynchronous callback, a "reserve now, pay later" flow —
 * THIS FUNCTION WOULD MARK UNPAID ORDERS AS PAID. It would be inventing
 * revenue, silently, in a sweep nobody is watching. That is why the read-only
 * `findStuckPendingPayment` exists beside it and why repair is a separate,
 * explicit call rather than the default: a caller has to choose it.
 *
 * 🔴 If the payment ordering ever changes, this module must be revisited BEFORE
 * that change ships, not after.
 */

/**
 * How long an order may sit in `pending_payment` before it is considered stuck
 * rather than in flight.
 *
 * ⚠️ It only has to exceed a request. `TRANSACTION_OPTIONS` in `orderService`
 * allows a 15-second transaction, and the transition runs after it, so a
 * generous multiple of that is comfortably clear of anything healthy while
 * still catching a failure the same day.
 */
export const STUCK_AFTER_MINUTES = 15

export type ReconcileOptions = {
  olderThanMinutes?: number
  limit?: number
  /**
   * 🔴 SCOPE IT TO ONE SHOPPER. Unscoped, this sweeps and MUTATES every order in
   * the database past the window — which is what a real reconciliation run
   * wants, and exactly what a test must not do. An integration test calling the
   * unscoped version asserts a global property of the development database:
   * a stray order left by another suite, or by manual use, both breaks the
   * assertion and gets silently marked `paid` by running the test file.
   *
   * ⚠️ Not a test-only affordance — reconciling a single account is the natural
   * shape of a support request ("this shopper's order is stuck").
   */
  userId?: string
}

export type StuckOrder = {
  id: string
  orderNumber: string
  createdAt: Date
}

/**
 * The read. 🔴 SAFE TO CALL ANYWHERE — it changes nothing, and it is the half
 * that answers "is this happening at all?", which ISSUE-082 records as the
 * cheapest first step because nothing counts these today.
 */
export async function findStuckPendingPayment(
  prisma: PrismaClient,
  options: ReconcileOptions = {},
): Promise<StuckOrder[]> {
  const minutes = options.olderThanMinutes ?? STUCK_AFTER_MINUTES
  const cutoff = new Date(Date.now() - minutes * 60_000)

  return prisma.order.findMany({
    where: {
      status: 'pending_payment',
      createdAt: { lt: cutoff },
      ...(options.userId ? { userId: options.userId } : {}),
    },
    // Oldest first: if a limit is applied, the longest-stuck are repaired first.
    orderBy: { createdAt: 'asc' },
    take: options.limit ?? 100,
    select: { id: true, orderNumber: true, createdAt: true },
  })
}

export type ReconcileReport = {
  examined: number
  repaired: number
  /** Orders that could not be moved, with the reason the table or write gave. */
  failed: { orderNumber: string; reason: string }[]
}

/**
 * The repair. 🔴 EXPLICIT, NEVER A SIDE EFFECT OF THE READ — see the header's
 * assumption.
 *
 * ⚠️ EACH ORDER IS ITS OWN TRANSACTION, deliberately. One failure must not roll
 * back the orders already repaired, and a sweep is not an atomic unit: it is a
 * batch of independent repairs that happens to be issued together.
 *
 * ⚠️ A FAILURE IS COLLECTED, NOT THROWN. Throwing on the third of fifty would
 * abandon the remaining forty-seven and hide which ones were fine — the report
 * is the point.
 */
export async function reconcileStuckOrders(
  prisma: PrismaClient,
  options: ReconcileOptions = {},
): Promise<ReconcileReport> {
  const stuck = await findStuckPendingPayment(prisma, options)
  const report: ReconcileReport = { examined: stuck.length, repaired: 0, failed: [] }

  for (const order of stuck) {
    try {
      // 🔴 THROUGH §8.9's TABLE, with the SYSTEM actor — the same move
      // `/checkout/pay` makes, and the only one `system` is permitted. The
      // history row's null actor says no human did this, which is exactly true
      // of a sweep.
      const moved = await applyTransition(prisma, {
        orderId: order.id,
        to: 'paid',
        actor: 'system',
      })
      if (moved.ok && moved.moved) report.repaired += 1
      else if (!moved.ok) report.failed.push({ orderNumber: order.orderNumber, reason: moved.reason })
      // `moved: false` means another caller got there first — not a failure,
      // and not a repair either.
    } catch (error) {
      report.failed.push({
        orderNumber: order.orderNumber,
        reason: error instanceof Error ? error.message : 'unknown error',
      })
    }
  }

  return report
}
