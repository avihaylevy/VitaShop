import type { PrismaClient } from '@prisma/client'
import {
  restoresStock,
  transitionProblem,
  type OrderActor,
  type OrderStatusName,
  type TransitionRejection,
} from './orderTransitions.js'

/**
 * MILESTONE-008 Checkpoint E2 — applying a transition from §8.9's table.
 *
 * 🔴 THE RULE IS NOT RE-DECIDED HERE. Every question about whether a move is
 * legal, who may make it, and whether it returns stock is answered by
 * `orderTransitions.ts`. This module owns the WRITE: doing it atomically,
 * recording it, and putting the units back. A second opinion about the table
 * living beside the first is the drift `purchasability.ts` exists to make
 * unrepresentable.
 *
 * 🔴 IT REPLACES `lib/orderPaid.ts` BY DELETION. That module was written
 * deliberately narrow in Checkpoint D3 — one transition, no table — so this
 * could absorb it rather than merge with it.
 *
 * ⚠️ INV-01 IN REVERSE, AND THAT IS THE RISKY HALF. The decrement at order
 * creation is guarded so it cannot oversell; the restore has the mirror hazard.
 * A retried cancellation that restored twice would INVENT inventory — units on
 * the shelf that do not exist — and unlike overselling nothing downstream
 * would ever complain. The guard is the same shape: the expected status sits in
 * the update's WHERE, so a second cancel moves nothing and therefore restores
 * nothing.
 */

export type ApplyTransitionInput = {
  orderId: string
  to: OrderStatusName
  actor: OrderActor
  /**
   * 🔴 THE HUMAN WHO DID IT. Required for `shopper` and `admin`, and FORBIDDEN
   * for `system` — null in `OrderStatusHistory.changedByUserId` means "no human
   * moved this", and the schema note is explicit that it is not "unknown".
   * Accepting a user id alongside `system` would let a real person's action be
   * recorded as the system's.
   */
  actorUserId?: string | null
  /**
   * ISSUE-103 — REQ-F-047's tracking number, written ATOMICALLY with the move
   * so an order can never be `shipped` in one write and tracked in another
   * that failed.
   *
   * 🔴 ONLY MEANINGFUL WHEN `to === 'shipped'` — the moment a courier hands
   * one over. The ROUTE enforces that pairing (400 before this service runs);
   * this service additionally ignores it on any other target rather than
   * writing tracking data onto a cancellation.
   *
   * ⚠️ Optional even for `shipped`: REQ-F-047 says "where one exists".
   * A RETRY of an already-shipped order hits the `from === to` short-circuit
   * and writes nothing — correcting a wrong tracking number is deliberate
   * M-010 work, not a side effect of replaying a transition.
   */
  trackingNumber?: string
}

export type ApplyTransitionResult =
  | {
      ok: true
      moved: true
      from: OrderStatusName
      to: OrderStatusName
      /** True when this cancellation put units back. */
      restoredStock: boolean
    }
  /**
   * 🔴 ALREADY THERE — NOT AN ERROR. A retry, a double-click, a replayed
   * request. Reporting an error would turn a correct repeat into a failure the
   * caller has to special-case, which is how a retry becomes a bug.
   */
  | { ok: true; moved: false; status: OrderStatusName }
  | { ok: false; reason: 'ORDER_NOT_FOUND' }
  /** The table's own refusal, carrying the status it refused FROM. */
  | { ok: false; reason: TransitionRejection; from: OrderStatusName }
  /** `shopper`/`admin` with no user id, or `system` with one. */
  | { ok: false; reason: 'ACTOR_REQUIRED' | 'ACTOR_NOT_ALLOWED' }
  /**
   * Someone else moved the order between this transaction's read and its write.
   * The caller re-reads and decides; nothing was changed.
   */
  | { ok: false; reason: 'CONCURRENT_TRANSITION'; from: OrderStatusName }

/**
 * ⚠️ CHECKED BEFORE THE TRANSACTION OPENS. It needs no database, and refusing
 * early keeps a malformed call from taking row locks it will never use.
 */
function actorProblem(
  actor: OrderActor,
  actorUserId: string | null | undefined,
): 'ACTOR_REQUIRED' | 'ACTOR_NOT_ALLOWED' | null {
  const supplied = typeof actorUserId === 'string' && actorUserId !== ''
  if (actor === 'system') return supplied ? 'ACTOR_NOT_ALLOWED' : null
  return supplied ? null : 'ACTOR_REQUIRED'
}

/**
 * 🔴 A DELIBERATE TEST SEAM, AND ITS ABSENCE WAS MEASURED, NOT SUSPECTED.
 *
 * The `status: from` clause in the guarded update is the only thing preventing
 * a concurrent cancellation from restoring stock TWICE — units on the shelf
 * that do not exist. Deleting that clause left ALL FOURTEEN TESTS GREEN,
 * because the `from === to` short-circuit answers a sequential retry before the
 * update is ever reached, and two `Promise.all` transactions serialise often
 * enough that the second one also reads the committed value.
 *
 * ⚠️ So the race cannot be forced from outside: both callers must read BEFORE
 * either commits, and nothing in a test controls that. The seam lets a test
 * stand exactly where the race would.
 *
 * 🔴 THIS POSITION IS LOAD-BEARING. It runs after a plain `findUnique` and
 * BEFORE the guarded update, so this transaction holds NO ROW LOCK yet and a
 * test may move the same order over a different connection and commit. Move it
 * below the update and the outer write blocks on this transaction's lock while
 * this transaction waits for the hook — a self-deadlock resolving only at the
 * transaction timeout. Same shape, same reason, as
 * `CreateOrderHooks.afterPrecheck`.
 *
 * Empty in production, and it changes no behaviour when omitted.
 */
export type ApplyTransitionHooks = {
  /** Runs after the status is read, before the guarded update. */
  afterRead?: () => Promise<void>
}

/**
 * 🔴 CHOSEN, NOT INHERITED — and the default was actively wrong here.
 *
 * Prisma's defaults are 2s maxWait / 5s timeout. `orderService` gives order
 * creation 15s deliberately, and it holds a row lock on every product in the
 * cart for that whole window. A cancellation whose restore loop touches one of
 * those products BLOCKS on that lock — and at Prisma's 5s default it would be
 * aborted with P2028 while the checkout it is waiting for is still perfectly
 * healthy.
 *
 * ⚠️ That is the same outcome the ascending-productId ordering below exists to
 * prevent — a clean cancellation failing as a 500 because of someone else's
 * in-flight checkout — reintroduced through the timeout instead of the lock
 * order. The window must be at least as generous as the lock it can wait on.
 */
const TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const

export async function applyTransition(
  prisma: PrismaClient,
  input: ApplyTransitionInput,
  hooks: ApplyTransitionHooks = {},
): Promise<ApplyTransitionResult> {
  const { orderId, to, actor } = input

  const actorFault = actorProblem(actor, input.actorUserId)
  if (actorFault) return { ok: false, reason: actorFault }

  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { status: true },
    })
    if (!order) return { ok: false as const, reason: 'ORDER_NOT_FOUND' as const }

    const from = order.status as OrderStatusName

    // 🔴 THE RETRY IS ANSWERED BEFORE THE TABLE IS CONSULTED. `from -> from` is
    // not a row in §8.9 and never will be, so asking the table first would
    // report NOT_A_TRANSITION for a request that is simply already satisfied.
    if (from === to) return { ok: true as const, moved: false as const, status: from }

    const problem = transitionProblem(from, to, actor)
    if (problem) return { ok: false as const, reason: problem, from }

    // The seam. Empty in production; see ApplyTransitionHooks for why it exists.
    if (hooks.afterRead) await hooks.afterRead()

    // ── THE GUARDED MOVE ───────────────────────────────────────────────────
    // 🔴 THE EXPECTED STATUS IS IN THE WHERE, and it is doing two jobs at once.
    // It makes the move idempotent — a second cancellation matches nothing —
    // and it makes it safe under concurrency, because a read-then-write would
    // let two callers both see `paid` and both proceed to restore the stock.
    // ⚠️ `updateMany`, not `update`: `update` throws when the WHERE matches
    // nothing, and a throw is indistinguishable from a real database failure.
    const moved = await tx.order.updateMany({
      where: { id: orderId, status: from },
      data: {
        status: to,
        // ISSUE-103: the tracking number rides the SAME guarded write as the
        // status, so a lost race writes neither. Shipped-only — see the input.
        ...(to === 'shipped' && typeof input.trackingNumber === 'string' && input.trackingNumber !== ''
          ? { trackingNumber: input.trackingNumber }
          : {}),
      },
    })
    if (moved.count !== 1) {
      // Someone moved it in between, and the caller re-reads.
      //
      // 🔴 THIS RETURNS BEFORE ANY WRITE — IT DOES NOT ROLL BACK, and the
      // distinction matters to whoever edits this next. Returning a value from
      // a `$transaction` callback COMMITS. Nothing has been written at this
      // point, so committing an empty transaction is correct; the guard is safe
      // because of WHERE it sits, not because of what returning does.
      // ⚠️ The same is true of the `ORDER_NOT_FOUND`, `from === to` and
      // rejection returns above. Add a write above any of them and it PERSISTS
      // on a path that reads as if it were undone.
      return { ok: false as const, reason: 'CONCURRENT_TRANSITION' as const, from }
    }

    // ── THE STOCK, PUT BACK ────────────────────────────────────────────────
    const restoring = restoresStock(from, to)
    if (restoring) {
      const items = await tx.orderItem.findMany({
        where: { orderId },
        // 🔴 ASCENDING productId, AND IT PREVENTS A DEADLOCK. `orderService`'s
        // decrement loop takes its product locks in exactly this order. A
        // cancellation restoring in a different order could hold P while a
        // concurrent checkout holds Q and each waits for the other — Postgres
        // resolves that by aborting one with 40P01, which is neither a stock
        // failure nor a permission failure and would surface as a 500 on a
        // cancellation that had nothing wrong with it.
        orderBy: { productId: 'asc' },
        select: { productId: true, quantity: true },
      })

      for (const item of items) {
        // ⚠️ NO `isActive` IN THE WHERE, unlike the decrement. A product
        // withdrawn after the order was placed still has to receive its units
        // back — they physically exist. Requiring `isActive` here would
        // silently swallow the restore for exactly the orders most likely to be
        // cancelled.
        await tx.product.update({
          where: { id: item.productId },
          data: { stockQuantity: { increment: item.quantity } },
        })
      }
    }

    // DEC-050: append-only, and every row names its actor. Null = SYSTEM, and
    // it means that rather than "unknown".
    await tx.orderStatusHistory.create({
      data: {
        orderId,
        status: to,
        changedByUserId: actor === 'system' ? null : (input.actorUserId as string),
      },
    })

    return { ok: true as const, moved: true as const, from, to, restoredStock: restoring }
  }, TRANSACTION_OPTIONS)
}
