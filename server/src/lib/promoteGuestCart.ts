import type { Prisma } from '@prisma/client'
import { clampAddition, clampCartQuantity } from './cartQuantity.js'

/**
 * MILESTONE-007 Checkpoint E — PROMOTE-GUEST-CART.
 *
 * 🔴 CALLED INSIDE `registerUser`'s TRANSACTION, and it must stay there:
 * promotion is a Prisma write that has to ROLL BACK WITH THE USER ROW. A
 * promotion surviving a failed registration is worse than one that never ran —
 * the guest would lose a cart to an account that does not exist.
 *
 * ⚠️ That is also why session REGENERATION lives OUTSIDE the transaction
 * (DEC-053 Rule 2): the two have opposite rollback needs. Regeneration cannot
 * be undone by a rollback and would leave a phantom session.
 *
 * 🔴 INV-04 is untouched here: this function performs NO external call. The
 * verification email is sent by the caller, after the commit.
 *
 * DEC-056 — a guest cart promoting into an account that ALREADY has one
 * MERGES: sums per product, RE-CLAMPED. The re-clamp is not optional, because
 * two lawful carts can sum past the cap or past stock, and skipping it would
 * let the guest path create a line no direct add could produce.
 *
 * DEC-055 — ONE cart per identity. The losing row is DELETED deliberately,
 * never orphaned.
 *
 * Nothing here writes `Product.stock`, and no price is stored on a line.
 */

export type PromotionOutcome = {
  /** No guest cart existed; nothing was created. */
  promoted: boolean
  /** True when an account cart already existed and the two were merged. */
  merged: boolean
  /** Lines whose merged quantity had to be clamped, for the caller to report. */
  clampedSlugs: string[]
}

export async function promoteGuestCart(
  tx: Prisma.TransactionClient,
  guestSessionId: string | null | undefined,
  userId: string,
): Promise<PromotionOutcome> {
  const none: PromotionOutcome = { promoted: false, merged: false, clampedSlugs: [] }
  if (!guestSessionId) return none

  const guestCart = await tx.cart.findFirst({
    where: { sessionId: guestSessionId, userId: null },
    select: { id: true, items: { select: { id: true, productId: true, quantity: true } } },
  })
  // 🔴 A guest with NO cart creates NOTHING. An empty cart per registration
  // would be a row nobody asked for and a lie about what the shopper did.
  if (!guestCart) return none

  const accountCart = await tx.cart.findFirst({ where: { userId }, select: { id: true } })

  if (!accountCart) {
    // No collision: the guest cart simply becomes the account's. Clearing
    // sessionId keeps DEC-055's unique constraint satisfiable for a future
    // guest reusing that session id.
    await tx.cart.update({
      where: { id: guestCart.id },
      data: { userId, sessionId: null },
    })
    return { promoted: true, merged: false, clampedSlugs: [] }
  }

  // ── DEC-056's MERGE ────────────────────────────────────────────────────
  const clampedSlugs: string[] = []

  for (const line of guestCart.items) {
    const product = await tx.product.findUnique({
      where: { id: line.productId },
      select: { slug: true, stockQuantity: true, isActive: true },
    })
    // A product that went INACTIVE mid-flight is not carried over. It cannot
    // be added through any other path either (the M-005 precedent), so
    // promoting it would make registration the one way to acquire it.
    if (!product || !product.isActive) continue

    const existing = await tx.cartItem.findUnique({
      where: { cartId_productId: { cartId: accountCart.id, productId: line.productId } },
      select: { id: true, quantity: true },
    })

    // 🔴 ONE clamp, the proved one. No inline Math.min.
    const clamped = existing
      ? clampAddition(existing.quantity, line.quantity, product.stockQuantity)
      : clampCartQuantity(line.quantity, product.stockQuantity)
    if (!clamped.ok) continue

    const intended = (existing?.quantity ?? 0) + line.quantity
    if (clamped.quantity < intended) clampedSlugs.push(product.slug)

    if (existing) {
      await tx.cartItem.update({ where: { id: existing.id }, data: { quantity: clamped.quantity } })
    } else {
      await tx.cartItem.create({
        data: { cartId: accountCart.id, productId: line.productId, quantity: clamped.quantity },
      })
    }
  }

  // 🔴 The losing cart is removed DELIBERATELY, items first. Leaving it would
  // orphan rows and leave two carts reachable for one shopper — the silent
  // loss DEC-055 exists to prevent.
  await tx.cartItem.deleteMany({ where: { cartId: guestCart.id } })
  await tx.cart.delete({ where: { id: guestCart.id } })

  return { promoted: true, merged: true, clampedSlugs }
}
