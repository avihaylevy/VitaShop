// MILESTONE-005 Checkpoint F — §6a popularity. `SUM(OrderItem.quantity)`
// over qualifying orders in the last 30 days, via the EXISTING
// `@@index([productId])` on OrderItem — no stored column, no materialised
// view, no migration, no new index. Cancelled orders are excluded.
//
// Not invented: favourites score, add-to-cart/funnel score, seeded
// popularity score, stored popularity column — any of those would
// contradict REQ-F-012's Approved text ("units sold in the last 30 days").
//
// Empty order data (true until M-008 ships real orders): every product
// scores 0 and all products tie; the deterministic tie-break (createdAt
// desc, slug asc) resolves the order — stable and reproducible today,
// stable once real orders arrive.

import type { PrismaClient } from '@prisma/client'

const POPULARITY_WINDOW_DAYS = 30

// Aggregates OrderItem.quantity per product, restricted to the supplied
// candidate ids (already filtered/searched — never the whole table), orders
// in the last 30 days, cancelled orders excluded. Products with no
// qualifying order rows are simply absent from the returned map — callers
// must treat a missing entry as score 0 (see sortByPopularity).
export async function resolvePopularityScores(
  prisma: PrismaClient,
  productIds: string[],
): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map()

  const since = new Date(Date.now() - POPULARITY_WINDOW_DAYS * 24 * 60 * 60 * 1000)

  const grouped = await prisma.orderItem.groupBy({
    by: ['productId'],
    where: {
      productId: { in: productIds },
      order: {
        status: { not: 'cancelled' },
        createdAt: { gte: since },
      },
    },
    _sum: { quantity: true },
  })

  return new Map(grouped.map((row) => [row.productId, row._sum.quantity ?? 0]))
}

// Pure — sorts an already-fetched product list by popularity score
// descending, then the frozen deterministic tie-break (createdAt desc, slug
// asc), identical to every other sort's tie-break (catalogOrderBy.ts). A
// product absent from `scores` is treated as score 0, exactly like every
// other unscored product — this is what produces the documented all-tie
// behaviour when order data is empty.
export function sortByPopularity<T extends { id: string; createdAt: Date; slug: string }>(
  products: readonly T[],
  scores: ReadonlyMap<string, number>,
): T[] {
  return [...products].sort((a, b) => {
    const scoreDiff = (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0)
    if (scoreDiff !== 0) return scoreDiff
    const createdAtDiff = b.createdAt.getTime() - a.createdAt.getTime()
    if (createdAtDiff !== 0) return createdAtDiff
    return a.slug.localeCompare(b.slug)
  })
}
