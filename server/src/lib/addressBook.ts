import { z } from 'zod'
import type { PrismaClient } from '@prisma/client'

/**
 * MILESTONE-009 / DEC-090 — the address book's rules, in one module.
 *
 * 🔴 DEC-090 O1: the 3-field shape stands (line1 carries street + house
 * number + apartment as one line; the §4.6.2 deviation is recorded in
 * REQUIREMENTS_TRACEABILITY). O5: at most FIVE rows per account,
 * server-enforced. O4: hard-delete — the book is the shopper's own;
 * orders hold their frozen INV-02 copies regardless.
 */

export const ADDRESS_CAP = 5

/** The checkout form's shape, with named codes (the JOIN_CLUB lesson). */
export const LINE1_MAX = 200
export const CITY_MAX = 100

export const addressSchema = z.object({
  // Review finding: a max-length breach must not answer "required" over a
  // visibly filled field — over-long is its own named refusal.
  line1: z
    .string({ message: 'LINE1_REQUIRED' })
    .trim()
    .min(1, 'LINE1_REQUIRED')
    .max(LINE1_MAX, 'LINE1_TOO_LONG'),
  city: z
    .string({ message: 'CITY_REQUIRED' })
    .trim()
    .min(1, 'CITY_REQUIRED')
    .max(CITY_MAX, 'CITY_TOO_LONG'),
  zipCode: z
    .string({ message: 'ZIP_INVALID' })
    .trim()
    .max(20, 'ZIP_INVALID')
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional()
    .default(null),
})

export type AddressInput = z.infer<typeof addressSchema>

export type AddressBookFailure = { ok: false; codes: string[] }

export function parseAddress(raw: unknown): { ok: true; value: AddressInput } | AddressBookFailure {
  const result = addressSchema.safeParse(raw ?? {})
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, codes: [...new Set(result.error.issues.map((issue) => issue.message))] }
}

export const ADDRESS_SELECT = {
  id: true,
  line1: true,
  city: true,
  zipCode: true,
  isDefault: true,
  createdAt: true,
} as const

/**
 * 🔴 THE DEFAULT IS EXCLUSIVE, and the guarantee is transactional: unset
 * every sibling and set the one row in a single transaction, so two
 * defaults can never coexist even across concurrent requests.
 *
 * The row lookup is IDOR-scoped inside the same transaction — a foreign
 * id updates nothing and reports notFound.
 */
export async function setDefaultAddress(
  prisma: PrismaClient,
  userId: string,
  addressId: string,
): Promise<'ok' | 'notFound'> {
  return prisma.$transaction(async (tx) => {
    const owned = await tx.address.findFirst({
      where: { id: addressId, userId },
      select: { id: true },
    })
    if (!owned) return 'notFound'
    /*
     * 🔴 UNSET SCANS EVERY ROW (`{ userId }`), not `isDefault: true` —
     * review finding: under ReadCommitted, a concurrent transaction's
     * just-set default is invisible to an `isDefault: true` predicate
     * snapshot, and two defaults could survive. Touching every row makes
     * this statement conflict with (and wait for) any concurrent default
     * write on the same book, which is what the exclusivity claim needs.
     * Five rows at most (the cap), so the full scan costs nothing.
     */
    await tx.address.updateMany({ where: { userId }, data: { isDefault: false } })
    await tx.address.update({ where: { id: addressId }, data: { isDefault: true } })
    return 'ok'
  })
}

/**
 * Add with the CAP and the first-row-defaults rule inside ONE transaction
 * (review finding: a route-level count-then-create let two concurrent
 * adds breach the cap — or both claim `isDefault: true` on an empty book).
 */
export async function addAddressRow(
  prisma: PrismaClient,
  userId: string,
  input: AddressInput,
): Promise<{ ok: true; address: { id: string; line1: string; city: string; zipCode: string | null; isDefault: boolean; createdAt: Date } } | { ok: false; reason: 'capReached' }> {
  /*
   * 🔴 SERIALIZABLE, with ONE retry on the serialization failure (P2034).
   * A plain transaction under ReadCommitted still lets two concurrent adds
   * both read count=4 (cap breach) or both read count=0 (two defaults) —
   * the count is a predicate read that row locks cannot cover. Serializable
   * makes one of the pair fail instead; the retry then sees the winner's
   * row and answers honestly (capReached, or a non-default second row).
   */
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const count = await tx.address.count({ where: { userId } })
          if (count >= ADDRESS_CAP) return { ok: false as const, reason: 'capReached' as const }
          const address = await tx.address.create({
            data: { userId, ...input, isDefault: count === 0 },
            select: ADDRESS_SELECT,
          })
          return { ok: true as const, address }
        },
        { isolationLevel: 'Serializable' },
      )
    } catch (error) {
      const code = (error as { code?: unknown }).code
      if (code === 'P2034' && attempt === 0) continue
      throw error
    }
  }
  // Unreachable: the loop returns or throws. Stated for the type checker.
  throw new Error('addAddressRow retry loop exited without a result')
}

/**
 * Hard-delete (DEC-090 O4). 🔴 DELETING THE DEFAULT PROMOTES THE NEWEST
 * REMAINING ROW in the same transaction — a book with rows but no default
 * would make the checkout prefill silently arbitrary.
 */
export async function deleteAddress(
  prisma: PrismaClient,
  userId: string,
  addressId: string,
): Promise<'ok' | 'notFound'> {
  return prisma.$transaction(async (tx) => {
    const owned = await tx.address.findFirst({
      where: { id: addressId, userId },
      select: { id: true, isDefault: true },
    })
    if (!owned) return 'notFound'
    await tx.address.delete({ where: { id: owned.id } })
    if (owned.isDefault) {
      const heir = await tx.address.findFirst({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      })
      if (heir) await tx.address.update({ where: { id: heir.id }, data: { isDefault: true } })
    }
    return 'ok'
  })
}
