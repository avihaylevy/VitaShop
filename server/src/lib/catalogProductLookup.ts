import type { PrismaClient } from '@prisma/client'
import type { ProductWithCatalogRelations, ProductWithDetailRelations } from './catalogMapper.js'

/**
 * The relation sets the catalogue reads. Defined once, here, so the list and
 * the detail cannot drift into including different things — the same reason
 * `PublicProductDetail` extends `PublicCatalogProduct` rather than
 * redeclaring it (§7).
 */
export const CATALOG_RELATIONS_INCLUDE = { category: true, brand: true, images: true } as const

/** The list's relations plus §7a fields 13 and 14, which only the detail carries. */
export const DETAIL_RELATIONS_INCLUDE = {
  ...CATALOG_RELATIONS_INCLUDE,
  ingredients: { include: { activeIngredient: true } },
  healthGoals: { include: { healthGoal: true } },
} as const

/**
 * MILESTONE-005 §7 — the Product Details lookup.
 *
 * 🔴 `isActive: true` is part of the WHERE CLAUSE, never a post-filter. That
 * is the whole security property behind §7's "an inactive product returns the
 * identical 404": an inactive product and a slug that never existed both
 * return `null` from this one query, so the route has a single not-found path
 * and no branch that could drift into leaking the difference.
 *
 * Extracted from the route at the Checkpoint J correction specifically so
 * that property is UNIT-TESTABLE. It previously lived inline in the handler,
 * where the only way to check it was to read the code — and the seed has zero
 * inactive products, so live data cannot exercise it either. Checkpoint D hit
 * exactly this situation with §4b's active-usage rule and the accepted
 * resolution was a narrowly-scoped fake-Prisma unit test
 * (`catalogIdExistence.test.ts`); this mirrors that precedent rather than
 * asking for a weaker standard.
 */
export async function findActiveProductBySlug(
  prisma: PrismaClient,
  slug: string,
): Promise<ProductWithDetailRelations | null> {
  return prisma.product.findFirst({
    where: { slug, isActive: true },
    include: DETAIL_RELATIONS_INCLUDE,
  })
}

// Re-exported so a caller needing the list-shaped payload type does not have
// to reach past this module for it.
export type { ProductWithCatalogRelations, ProductWithDetailRelations }
