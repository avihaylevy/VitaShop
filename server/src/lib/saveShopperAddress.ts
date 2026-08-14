import type { PrismaClient } from '@prisma/client'

/**
 * MILESTONE-008 Checkpoint F2c — ISSUE-093, the missing writer.
 *
 * 🔴 THE `Address` TABLE HAS EXISTED SINCE THE SCHEMA WAS WRITTEN WITH NOTHING
 * WRITING IT. `GET /api/account/profile` returns `defaultAddress` for
 * REQ-F-041's pre-fill, and it was `null` for every shopper alive, because
 * checkout freezes the address onto the ORDER (INV-02) and never saved it to
 * the person.
 *
 * ⚠️ THIS ADDS NO NEW PERSONAL DATA. The address is already stored on the
 * order, permanently and by design. This indexes what the database already
 * holds so a returning shopper does not retype it — which is why the decision
 * was behavioural rather than legal: someone shipping a one-off gift should
 * not silently acquire that address as their default.
 *
 * 🔴 THEREFORE IT IS OPT-IN, DEFAULT OFF. Nothing is written unless the
 * shopper ticked the box.
 */

export type SaveAddressInput = {
  userId: string
  /**
   * ⚠️ `zipCode` is OPTIONAL here, matching `readAddress`'s own shape in the
   * checkout route rather than forcing the caller to normalise first. A
   * missing zip and an explicit null mean the same thing — no postcode — and
   * the normalisation below collapses both.
   */
  address: { line1: string; city: string; zipCode?: string | null } | null
}

/**
 * 🔴 CALL THIS **AFTER** THE ORDER COMMITS, NEVER INSIDE ITS TRANSACTION, and
 * never let it fail the request. The same rule INV-04 states for the
 * confirmation email, for the same reason: the ORDER is the thing that must
 * survive. A shopper whose address failed to save has a placed order and a
 * form to retype next time; a shopper whose order rolled back because a
 * convenience write failed has nothing.
 *
 * Returns what it did, for tests and for logging — never throws.
 */
export async function saveShopperAddress(
  prisma: PrismaClient,
  input: SaveAddressInput,
): Promise<'saved' | 'skipped-empty' | 'skipped-duplicate' | 'failed'> {
  const { userId, address } = input
  // Self pickup carries no address, and a blank one is not an address.
  if (!address || address.line1.trim() === '' || address.city.trim() === '') {
    return 'skipped-empty'
  }

  const line1 = address.line1.trim()
  const city = address.city.trim()
  const zipCode = address.zipCode?.trim() ? address.zipCode.trim() : null

  try {
    const existing = await prisma.address.findMany({
      where: { userId },
      select: { id: true, line1: true, city: true, zipCode: true },
    })

    /*
     * ⚠️ A SHOPPER WHO ORDERS TWICE TO THE SAME PLACE MUST NOT COLLECT TWO
     * IDENTICAL ROWS. Compared on the trimmed values that were actually
     * stored, not on raw input, so trailing whitespace does not create a
     * "different" address.
     */
    const duplicate = existing.some(
      (row) => row.line1 === line1 && row.city === city && (row.zipCode ?? null) === zipCode,
    )
    if (duplicate) return 'skipped-duplicate'

    /*
     * 🔴 THE FIRST ADDRESS IS THE DEFAULT; LATER ONES ARE NOT. Choosing between
     * several is REQ-F-051's "manage addresses", which belongs to
     * MILESTONE-009 — inventing a picker here would be scope this checkpoint
     * has no requirement for. The profile endpoint ORDERS by `isDefault` and
     * falls back to the oldest, so a shopper with only flat rows still gets a
     * sensible answer.
     */
    await prisma.address.create({
      data: { userId, line1, city, zipCode, isDefault: existing.length === 0 },
    })
    return 'saved'
  } catch (error) {
    // 🔴 SWALLOWED ON PURPOSE. The order exists; this is a convenience.
    console.error(`[account] saving the address failed for ${userId}`, error)
    return 'failed'
  }
}
