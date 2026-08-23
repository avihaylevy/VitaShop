// MILESTONE-005 Checkpoint D — pure pagination arithmetic for
// `GET /api/products`. §4a: pageSize is server-fixed; the VALUE moved
// 24 → 12 on 2026-08-23 (DEC-107, the user: a 24-product page reads
// excessive) — a RECORDED DEVIATION from §4a's literal 24. Still
// server-fixed, never client-influenced; 12 fills whole rows at every
// grid width (4/3/2/1 columns). §4a's already-shipped totalPages
// convention (routes/catalog.ts's Math.ceil(totalItems / PAGE_SIZE)) is
// preserved verbatim, including the totalItems === 0 -> totalPages === 0
// case (Math.ceil(0/12) === 0, no special-casing needed).
//
// §4c: the API MAY return a past-the-end page (items: [], totalItems > 0,
// page > totalPages) — that is legal and honest at this layer. Canonicalizing
// away from it is a CLIENT concern (§5a), out of scope here and everywhere
// server-side.
//
// 🔴 Corrected 2026-08-10 (Codex review): Checkpoint C only guarantees `page`
// is a safe integer >= 1 — it never bounded `page` relative to `totalItems`,
// so (page - 1) * PAGE_SIZE can itself exceed Number.MAX_SAFE_INTEGER for a
// sufficiently large `page` value even though `page` alone is safe. The
// fix is NOT a new, unauthorized public page ceiling — nothing in the frozen
// §4 contract limits `page`'s magnitude. Instead: skip/take are computed
// ONLY when the requested page is actually within [1, totalPages]. A
// zero-result query or a past-the-end page never computes a skip and never
// needs one — the caller (routes/catalog.ts) must not call
// `prisma.product.findMany` at all in that case, returning `items: []`
// directly. This is provable behaviorally, not just arithmetically — see
// catalogPagination.test.ts and the route-level spy test in
// catalog.integration.test.ts.

export const PAGE_SIZE = 12

// Thrown only if a WITHIN-RANGE page's skip arithmetic would itself exceed
// Number.MAX_SAFE_INTEGER — requires totalItems to be far beyond anything a
// real Prisma count() could ever return (see catalogPagination.test.ts for
// the exact proof), never reachable with any real catalogue size. Not caught
// by the route — it propagates to Express's default error handler, exactly
// like the §3a Prisma-form stop condition: a developer-facing STOP, not a
// designed public API response. No new public error code is introduced for
// it.
export class UnsafePaginationOffsetError extends Error {
  constructor(page: number, totalItems: number) {
    super(
      `Computing a Prisma skip offset for page ${page} against totalItems ${totalItems} would exceed Number.MAX_SAFE_INTEGER. Refusing to send an unsafe offset to Prisma.`,
    )
    this.name = 'UnsafePaginationOffsetError'
  }
}

export interface CatalogPaginationPlan {
  totalPages: number
  // true only when the requested page has at least one row to return, i.e.
  // totalItems > 0 AND page <= totalPages. When false, the caller must
  // return items: [] WITHOUT calling findMany — skip/take are not computed.
  withinRange: boolean
  skip: number | undefined
  take: number
}

// `page` is the already-validated, safe-integer page number from Checkpoint
// C (>= 1, Number.isSafeInteger). `totalItems` is the count of rows matching
// the resolved filter (before pagination is applied) — always computed
// FIRST by the caller, per the frozen execution order.
export function computeCatalogPagination(page: number, totalItems: number): CatalogPaginationPlan {
  const totalPages = Math.ceil(totalItems / PAGE_SIZE)
  const withinRange = totalItems > 0 && page <= totalPages

  if (!withinRange) {
    return { totalPages, withinRange: false, skip: undefined, take: PAGE_SIZE }
  }

  const skip = (page - 1) * PAGE_SIZE
  if (!Number.isSafeInteger(skip)) {
    throw new UnsafePaginationOffsetError(page, totalItems)
  }

  return { totalPages, withinRange: true, skip, take: PAGE_SIZE }
}
