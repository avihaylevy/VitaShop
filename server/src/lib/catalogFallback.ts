// MILESTONE-005 Checkpoint F — §6b fallback, REQ-F-014. The primary query
// stays truthful; fallback is a SEPARATE object, never substituted into
// `items`/`totalItems`/`totalPages`. Computed ONLY when a validated,
// successful query yields totalItems === 0.

import type { PrismaClient } from '@prisma/client'
import { mapProductToPublicCatalog, type PublicCatalogProduct } from './catalogMapper.js'
import { resolvePopularityScores, sortByPopularity } from './catalogPopularity.js'

export const FALLBACK_LIMIT = 8

export interface CatalogFallback {
  kind: 'category' | 'popular'
  items: PublicCatalogProduct[]
  limit: number
}

// `categoryNameHe` — the resolved, already-validated category filter from
// the ORIGINAL query (undefined if none was supplied). Every other
// narrowing filter (q, brand, dosageForm, ingredient, healthGoal, price,
// inStock) is deliberately IGNORED here — §6b: "with every other narrowing
// filter relaxed." `isActive` is never relaxed.
//
// Returns `null` when the active catalogue itself is empty (nothing to
// suggest, regardless of kind) — callers must only invoke this when the
// PRIMARY query's totalItems is already 0; this function does not check
// that itself.
export async function resolveCatalogFallback(
  prisma: PrismaClient,
  params: { categoryNameHe: string | undefined },
): Promise<CatalogFallback | null> {
  const catalogueSize = await prisma.product.count({ where: { isActive: true } })
  if (catalogueSize === 0) return null

  const where =
    params.categoryNameHe !== undefined
      ? { isActive: true, category: { nameHe: params.categoryNameHe } }
      : { isActive: true }

  const candidates = await prisma.product.findMany({
    where,
    include: { category: true, brand: true, images: true },
  })

  const scores = await resolvePopularityScores(prisma, candidates.map((product) => product.id))
  const ordered = sortByPopularity(candidates, scores).slice(0, FALLBACK_LIMIT)

  // May throw CatalogIntegrityError (fail-closed, §4.7.1) — deliberately not
  // caught here. The caller (routes/catalog.ts) wraps this call in the same
  // try/catch it already uses for the primary query's mapping, so a
  // data-integrity failure anywhere in the response produces one consistent
  // 500 CATALOG_DATA_INTEGRITY, never a partial/inconsistent payload.
  const items: PublicCatalogProduct[] = ordered.map(mapProductToPublicCatalog)

  return {
    kind: params.categoryNameHe !== undefined ? 'category' : 'popular',
    items,
    limit: FALLBACK_LIMIT,
  }
}
