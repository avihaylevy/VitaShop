import type { PrismaClient } from '@prisma/client'

/**
 * MILESTONE-008 Checkpoint D3 — `pending_payment -> paid`, and ONLY that.
 *
 * 🔴 THIS IS NOT §8.9's TRANSITION TABLE. The table — every legal move, who may
 * trigger it, and stock restoration on cancel — is Checkpoint E's, and building
 * it here would be E's scope arriving unannounced inside D. What D3 owes is the
 * ONE transition its own flow performs: the simulated payment succeeded, so the
 * order it just created stops being `pending_payment`.
 *
 * ⚠️ E will absorb this. When it writes the general machine, this function
 * becomes a call into it rather than a second implementation — the shape
 * `purchasability.ts` had to be created to fix twice already. It is deliberately
 * narrow so that absorbing it is a deletion, not a merge.
 *
 * 🔴 THE ACTOR IS NULL, AND NULL MEANS SOMETHING. §8.9 records this row as a
 * SYSTEM transition: no human moved it, the payment simulation did.
 * `OrderStatusHistory.changedByUserId` is nullable for exactly this case, and
 * the schema note is explicit that null is not "unknown". Writing the shopper's
 * id here would claim they performed an action they did not.
 */

export type MarkPaidResult =
  /** The order moved, and a history row was appended. */
  | { ok: true; moved: true }
  /**
   * 🔴 ALREADY PAID — NOT AN ERROR. A retry reaches this after the first call
   * moved it, and answering an error would turn a correct replay into a failed
   * checkout. See the guarded update for why no second history row appears.
   */
  | { ok: true; moved: false }
  /** The order is not in `pending_payment` and not `paid` — nothing was done. */
  | { ok: false; reason: 'UNEXPECTED_STATUS'; status: string }

export async function markOrderPaid(
  prisma: PrismaClient,
  orderId: string,
): Promise<MarkPaidResult> {
  return prisma.$transaction(async (tx) => {
    // 🔴 THE STATUS IS IN THE WHERE, WHICH IS WHAT MAKES THIS IDEMPOTENT AND
    // SAFE UNDER CONCURRENCY AT ONCE. A read-then-write would let two callers
    // both see `pending_payment` and both append a history row, leaving an
    // append-only log claiming the order was paid twice — and DEC-050 makes
    // that log the audit trail.
    //
    // ⚠️ `updateMany`, not `update`: `update` throws when the WHERE matches
    // nothing, and a throw here is indistinguishable from a real database
    // failure. The count tells us which happened.
    const moved = await tx.order.updateMany({
      where: { id: orderId, status: 'pending_payment' },
      data: { status: 'paid' },
    })

    if (moved.count === 1) {
      // DEC-050: append-only, and every row names its actor. Null = SYSTEM.
      await tx.orderStatusHistory.create({
        data: { orderId, status: 'paid', changedByUserId: null },
      })
      return { ok: true as const, moved: true as const }
    }

    // Nothing moved. Either it is already `paid` — a retry, which is correct —
    // or it is somewhere this function has no business touching.
    const current = await tx.order.findUnique({
      where: { id: orderId },
      select: { status: true },
    })
    if (current?.status === 'paid') return { ok: true as const, moved: false as const }
    return {
      ok: false as const,
      reason: 'UNEXPECTED_STATUS' as const,
      status: current?.status ?? 'MISSING',
    }
  })
}
