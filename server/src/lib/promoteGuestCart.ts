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

export type DropReason = 'INACTIVE' | 'UNAVAILABLE'

export type PromotionOutcome = {
  /** No guest cart existed; nothing was created. */
  promoted: boolean
  /** True when an account cart already existed and the two were merged. */
  merged: boolean
  /** Lines whose merged quantity had to be clamped, for the caller to report. */
  clampedSlugs: string[]
  /**
   * 🔴 LINES REMOVED ENTIRELY, and WHY. Removal is a LARGER change than a
   * clamp, and it used to be completely silent: a guest carts a product, it
   * sells out, they register, and the line disappears with no message
   * anywhere. That is this module's own rule at its limit — name what
   * changed — and the silent-loss class DEC-055 and DEC-056 exist to stop.
   *
   * The two reasons are separated because they read differently to a shopper:
   * INACTIVE means we no longer sell it; UNAVAILABLE means it is out of stock.
   *
   * 🔴 ISSUE-073 — BOTH NAMES RIDE ALONG. A dropped line is no longer in any
   * cart, so the client has NOTHING to resolve the slug against and was
   * showing the slug itself ("truforme-briamil-mini-60") in a shopper-facing
   * sentence. The product row is already in hand right here; bilingual,
   * because the shopper's language is the client's decision, not this one's.
   */
  dropped: { slug: string; nameHe: string; nameEn: string; reason: DropReason }[]
}

export async function promoteGuestCart(
  tx: Prisma.TransactionClient,
  guestSessionId: string | null | undefined,
  userId: string,
): Promise<PromotionOutcome> {
  const none: PromotionOutcome = { promoted: false, merged: false, clampedSlugs: [], dropped: [] }
  if (!guestSessionId) return none

  const guestCart = await tx.cart.findFirst({
    where: { sessionId: guestSessionId, userId: null },
    select: { id: true, items: { select: { id: true, productId: true, quantity: true } } },
  })
  // 🔴 A guest with NO cart creates NOTHING. An empty cart per registration or
  // login would be a row nobody asked for and a lie about what the shopper did.
  if (!guestCart) return none

  const existingAccountCart = await tx.cart.findFirst({ where: { userId }, select: { id: true } })
  const merged = existingAccountCart !== null

  // 🔴 ONE RULE, ONE PLACE. This used to branch: with no account cart the guest
  // cart was reassigned WHOLESALE — no isActive check, no stock check, no
  // clamp — while the merge path filtered and clamped. So the SAME inactive
  // product was KEPT when the account had no cart and DROPPED when it did, and
  // which branch ran depended on something that has nothing to do with the
  // product. Same shape as the GET/POST precedence asymmetry corrected at
  // Checkpoint C: two paths encoding one rule, only one of them correctly.
  //
  // Now a target cart is created when absent, and EVERY line goes through the
  // same filter and the same clamp on both paths.
  const accountCart =
    existingAccountCart ?? (await tx.cart.create({ data: { userId }, select: { id: true } }))

  const clampedSlugs: string[] = []
  const dropped: { slug: string; nameHe: string; nameEn: string; reason: DropReason }[] = []

  /*
   * ISSUE-068 — ONE findMany, not a findUnique per line. This loop runs
   * INSIDE the registration/login transaction, so its round trips held the
   * transaction open in proportion to cart size. The lines are bounded (one
   * per product, capped quantities), so this was small — but a transaction's
   * duration should not scale with a shopper's cart at all.
   */
  const products = new Map(
    (
      await tx.product.findMany({
        where: { id: { in: guestCart.items.map((line) => line.productId) } },
        select: { id: true, slug: true, nameHe: true, nameEn: true, stockQuantity: true, isActive: true },
      })
    ).map((product) => [product.id, product]),
  )

  for (const line of guestCart.items) {
    const product = products.get(line.productId)
    if (!product) continue

    // A product that went INACTIVE mid-flight is not carried over. It cannot be
    // added through any other path either (the M-005 precedent), so carrying it
    // would make registration or login the one way to acquire it.
    if (!product.isActive) {
      dropped.push({ slug: product.slug, nameHe: product.nameHe, nameEn: product.nameEn, reason: 'INACTIVE' })
      continue
    }

    const existing = await tx.cartItem.findUnique({
      where: { cartId_productId: { cartId: accountCart.id, productId: line.productId } },
      select: { id: true, quantity: true },
    })

    // 🔴 ONE clamp, the proved one. No inline Math.min.
    const clamped = existing
      ? clampAddition(existing.quantity, line.quantity, product.stockQuantity)
      : clampCartQuantity(line.quantity, product.stockQuantity)

    if (!clamped.ok) {
      dropped.push({ slug: product.slug, nameHe: product.nameHe, nameEn: product.nameEn, reason: 'UNAVAILABLE' })
      continue
    }

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
  // orphan rows and leave two carts reachable for one shopper — the silent loss
  // DEC-055 exists to prevent.
  await tx.cartItem.deleteMany({ where: { cartId: guestCart.id } })
  await tx.cart.delete({ where: { id: guestCart.id } })

  return { promoted: true, merged, clampedSlugs, dropped }
}
