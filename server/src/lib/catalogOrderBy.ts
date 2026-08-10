// MILESTONE-005 Checkpoint D — pure Prisma `orderBy` builder for
// `GET /api/products`. §4: "every sort carries a deterministic tie-break
// (createdAt desc, slug asc) — total, reproducible ordering."
//
// 🔴 `sort=popularity` is NOT built here — Checkpoint D deliberately left it
// unhandled (this file previously threw a dedicated error for it), and
// Checkpoint F now implements its execution for real via
// catalogPopularity.ts's sortByPopularity, which sorts an already-fetched
// product list in application code (no native Prisma ORDER BY exists for a
// cross-table aggregate with no stored column). routes/catalog.ts branches
// on `sort === 'popularity'` BEFORE calling this function, so this
// function's input type excludes it — the compiler enforces that branch,
// not a runtime throw.

import type { Prisma } from '@prisma/client'
import type { SortValue } from './catalogQuery.js'

// Every sort this function can build an orderBy for — everything except
// popularity, which routes/catalog.ts executes separately (catalogPopularity.ts).
export type PrismaSortableSortValue = Exclude<SortValue, 'popularity'>

const TIE_BREAK: Prisma.ProductOrderByWithRelationInput[] = [{ createdAt: 'desc' }, { slug: 'asc' }]

export function buildOrderBy(sort: PrismaSortableSortValue): Prisma.ProductOrderByWithRelationInput[] {
  switch (sort) {
    case 'price_asc':
      return [{ price: 'asc' }, ...TIE_BREAK]
    case 'price_desc':
      return [{ price: 'desc' }, ...TIE_BREAK]
    case 'newest':
      return [...TIE_BREAK]
  }
}
