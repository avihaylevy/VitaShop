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
 * Either the Prisma Decimal (the product row) or an already-canonical
 * two-decimal string (a DTO field derived from one). Accepting the string
 * lets `toDto` compute the savings from the line it just built instead of
 * carrying the Decimal beside it in a parallel structure.
 */
type PriceInput = string | DecimalLike

function canonical(price: PriceInput): string {
  return typeof price === 'string' ? price : price.toFixed(2)
}

/**
 * The canonical two-decimal price a given shopper pays per unit.
 * Non-members (and guests — a null/absent membership is false) pay the
 * stored price unchanged, byte-for-byte.
 */
export function effectiveUnitPrice(price: PriceInput, isClubMember: boolean): string {
  const base = canonical(price)
  if (!isClubMember) return base
  const agorot = toAgorot(base)
  const discounted = Math.round((agorot * (100 - CLUB_DISCOUNT_PERCENT)) / 100)
  return (discounted / 100).toFixed(2)
}

/**
 * The user's seventh list, item 2 — the per-unit saving the club gives, in
 * integer agorot.
 *
 * 🔴 DERIVED FROM `effectiveUnitPrice`, NEVER RESTATED. This file's header
 * explains why the discount rule must exist exactly once; a savings figure
 * computed as `base * 10%` anywhere else is a second copy of the rule that
 * can drift from the price the shopper actually pays. Because the member
 * unit price is rounded per unit, the saving is too — so a line's saving
 * times its quantity always agrees with the displayed prices.
 *
 * The SAME figure serves both audiences: for a member it is what the club
 * is saving them right now; for a non-member it is what joining would save.
 */
export function clubSavingsPerUnitAgorot(price: PriceInput): number {
  const base = canonical(price)
  return toAgorot(base) - toAgorot(effectiveUnitPrice(base, true))
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
