/**
 * MILESTONE-012 / DEC-086 — the membership club's ONE pricing seam.
 *
 * 🔴 THE SHARED RULE, not a description of one. The purchasable filter
 * drifted twice by being written out by hand (purchasability.ts's header
 * tells that story), and a price rule has a sharper failure mode than a
 * shipping reversal: `checkoutService` quotes from the cart DTO while
 * `/pay`'s orderService RE-DERIVES the same figures from live product rows
 * to verify DEC-060's fingerprint. If the two ever disagree about a
 * member's price, every member payment halts with CHECKOUT_CHANGED.
 * Both sides therefore call THIS function and nothing else.
 *
 * 🔴 §3.4 — the discount is server arithmetic. The client renders the
 * discounted strings the DTO carries; it never multiplies.
 *
 * Rounding: integer agorot, half-up via Math.round, per UNIT — the line
 * total is the rounded unit price times the quantity, so a line can never
 * disagree with its own displayed unit price.
 */
import { toAgorot } from './shipping.js'

/** DEC-086 O2 — flat 10% for members. A rate change is a code change here. */
export const CLUB_DISCOUNT_PERCENT = 10

type DecimalLike = { toFixed: (digits: number) => string }

/**
 * The canonical two-decimal price a given shopper pays per unit.
 * Non-members (and guests — a null/absent membership is false) pay the
 * stored price unchanged, byte-for-byte.
 */
export function effectiveUnitPrice(price: DecimalLike, isClubMember: boolean): string {
  const base = price.toFixed(2)
  if (!isClubMember) return base
  const agorot = toAgorot(base)
  const discounted = Math.round((agorot * (100 - CLUB_DISCOUNT_PERCENT)) / 100)
  return (discounted / 100).toFixed(2)
}

/**
 * Per-request membership read (the DEC-065 revocation pattern): the flag
 * comes from the user ROW on every priced request, never from the session,
 * so leaving the club takes effect on the next request. A guest identity
 * (no userId) is never a member.
 *
 * `db` accepts a transaction client too — orderService reads it INSIDE the
 * placement transaction so the frozen prices and the membership they were
 * computed from commit together.
 */
export async function readClubMembership(
  db: { user: { findUnique: (args: { where: { id: string }; select: { isClubMember: true } }) => Promise<{ isClubMember: boolean } | null> } },
  userId: string | null | undefined,
): Promise<boolean> {
  if (!userId) return false
  const user = await db.user.findUnique({ where: { id: userId }, select: { isClubMember: true } })
  return user?.isClubMember ?? false
}
