import { describe, expect, it } from 'vitest'
import { buildOrderBy } from './catalogOrderBy.js'

describe('buildOrderBy', () => {
  it('price_asc — price ascending, then the deterministic tie-break', () => {
    expect(buildOrderBy('price_asc')).toEqual([{ price: 'asc' }, { createdAt: 'desc' }, { slug: 'asc' }])
  })

  it('price_desc — price descending, then the deterministic tie-break', () => {
    expect(buildOrderBy('price_desc')).toEqual([{ price: 'desc' }, { createdAt: 'desc' }, { slug: 'asc' }])
  })

  it('newest — the deterministic tie-break alone (createdAt desc, slug asc)', () => {
    expect(buildOrderBy('newest')).toEqual([{ createdAt: 'desc' }, { slug: 'asc' }])
  })

  it('every sort ends with the identical tie-break clause set', () => {
    for (const sort of ['price_asc', 'price_desc', 'newest'] as const) {
      const orderBy = buildOrderBy(sort)
      expect(orderBy.at(-2)).toEqual({ createdAt: 'desc' })
      expect(orderBy.at(-1)).toEqual({ slug: 'asc' })
    }
  })

  // 🔴 `buildOrderBy('popularity')` is now a TS compile error — its
  // parameter type (PrismaSortableSortValue) excludes 'popularity' entirely.
  // Checkpoint F's real popularity execution lives in catalogPopularity.ts
  // (sortByPopularity) and is exercised by routes/catalog.ts's dedicated
  // branch — see catalogPopularity.test.ts and catalog.integration.test.ts.
})
