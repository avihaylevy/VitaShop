// MILESTONE-005 Checkpoint D — completes the §4b obligation Checkpoint C
// explicitly deferred: "the server validates every supplied ID exists AND is
// allowed for a public catalogue query." Checkpoint C validated well-formed
// UUID *shape* only (pure, no DB access); this module validates *existence
// AND allowedness* against the database, which requires a round trip C is
// not allowed to make.
//
// 🔴 Corrected 2026-08-10 (Codex review): "allowed" means the SAME thing here
// as it means at §9d's facets endpoint — usage-derived from ACTIVE products
// only (catalogFacets.ts). An id that exists in the database but is only
// referenced by inactive/soft-deleted products is NOT a valid public filter
// value: it is indistinguishable from a genuinely nonexistent id from the
// public catalogue's point of view, and accepting it would let the client
// discover/probe inactive products by filtering on them (an empty-but-200
// result would otherwise leak "this id exists, it's just never returned" —
// worse, an id used ONLY by inactive products previously passed a bare
// existence check and silently produced zero results instead of a 400,
// which is exactly the "matches nothing" outcome §4b forbids). This module
// and catalogFacets.ts now share one coherent public-value definition —
// there is no second, inconsistent notion of "allowed" anywhere in M-005.
//
// A well-formed but nonexistent-or-inactive-only id is never silently
// dropped and never "matches nothing" — it is a 400 INVALID_QUERY_PARAMETER
// naming the offending field, exactly like a malformed one. Duplicate IDs
// within the same repeated parameter do not count as distinct — comparing
// found-count against the count of DISTINCT supplied IDs keeps duplicates
// from masking a genuinely invalid one.

import type { PrismaClient } from '@prisma/client'

export interface ReferencedIdCheckInput {
  brand: string[]
  ingredient: string[]
  healthGoal: string[]
}

// Returns the §4b field names (in canonical §5 order: brand, ingredient,
// healthGoal) whose supplied IDs are not ALL valid — well-formed, existing,
// AND used by at least one active product. A field with zero supplied IDs is
// never checked and never reported — an absent filter is not an invalid one.
export async function findInvalidReferencedIdFields(
  prisma: PrismaClient,
  input: ReferencedIdCheckInput,
): Promise<string[]> {
  const invalid: string[] = []

  if (input.brand.length > 0) {
    const distinct = new Set(input.brand)
    const found = await prisma.brand.count({
      where: { id: { in: [...distinct] }, products: { some: { isActive: true } } },
    })
    if (found !== distinct.size) invalid.push('brand')
  }

  if (input.ingredient.length > 0) {
    const distinct = new Set(input.ingredient)
    const found = await prisma.activeIngredient.count({
      where: { id: { in: [...distinct] }, products: { some: { product: { isActive: true } } } },
    })
    if (found !== distinct.size) invalid.push('ingredient')
  }

  if (input.healthGoal.length > 0) {
    const distinct = new Set(input.healthGoal)
    const found = await prisma.healthGoal.count({
      where: { id: { in: [...distinct] }, products: { some: { product: { isActive: true } } } },
    })
    if (found !== distinct.size) invalid.push('healthGoal')
  }

  return invalid
}
