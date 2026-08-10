import { describe, expect, it } from 'vitest'
import { computeCatalogPagination, PAGE_SIZE, UnsafePaginationOffsetError } from './catalogPagination.js'

describe('PAGE_SIZE', () => {
  it('is fixed at 24', () => {
    expect(PAGE_SIZE).toBe(24)
  })
})

describe('computeCatalogPagination', () => {
  it('page 1 of a small result set: withinRange, skip 0, take 24', () => {
    expect(computeCatalogPagination(1, 6)).toEqual({ totalPages: 1, withinRange: true, skip: 0, take: 24 })
  })

  it('a later, in-range page skips by (page - 1) * 24', () => {
    expect(computeCatalogPagination(3, 100)).toEqual({ totalPages: 5, withinRange: true, skip: 48, take: 24 })
  })

  it('totalItems === 0 -> totalPages === 0, not withinRange, no skip computed', () => {
    const plan = computeCatalogPagination(1, 0)
    expect(plan.totalPages).toBe(0)
    expect(plan.withinRange).toBe(false)
    expect(plan.skip).toBeUndefined()
  })

  it('a past-the-end page is not withinRange and computes no skip', () => {
    // 6 total items, pageSize 24 -> totalPages 1; page 2 is past-the-end.
    const plan = computeCatalogPagination(2, 6)
    expect(plan.totalPages).toBe(1)
    expect(plan.withinRange).toBe(false)
    expect(plan.skip).toBeUndefined()
    expect(plan.take).toBe(24)
  })

  it('a page exactly equal to totalPages IS withinRange', () => {
    // 25 items -> totalPages 2. Page 2 is the real, final page.
    const plan = computeCatalogPagination(2, 25)
    expect(plan.withinRange).toBe(true)
    expect(plan.skip).toBe(24)
  })

  it('totalPages rounds up for a partial final page', () => {
    expect(computeCatalogPagination(1, 25).totalPages).toBe(2)
    expect(computeCatalogPagination(1, 24).totalPages).toBe(1)
    expect(computeCatalogPagination(1, 48).totalPages).toBe(2)
    expect(computeCatalogPagination(1, 49).totalPages).toBe(3)
  })

  it('take is always exactly PAGE_SIZE — pageSize is never client-influenced', () => {
    expect(computeCatalogPagination(1, 6).take).toBe(24)
    expect(computeCatalogPagination(5, 1000).take).toBe(24)
    expect(computeCatalogPagination(999, 6).take).toBe(24)
  })

  describe('unsafe offset guard (Codex correction)', () => {
    it('page = Number.MAX_SAFE_INTEGER with a tiny totalItems is past-the-end — no skip computed, no throw', () => {
      // Realistic shape: an absurd page against a small real catalogue is
      // simply past-the-end, handled by the withinRange branch, never
      // reaching the arithmetic that could overflow.
      const plan = computeCatalogPagination(Number.MAX_SAFE_INTEGER, 6)
      expect(plan.withinRange).toBe(false)
      expect(plan.skip).toBeUndefined()
    })

    it('a within-range page whose skip arithmetic would exceed MAX_SAFE_INTEGER throws, rather than returning an unsafe offset', () => {
      // Not reachable via any real catalogue (a real Prisma count() could
      // never approach this magnitude) — a defensive guard, proven directly
      // with a deliberately absurd totalItems far beyond MAX_SAFE_INTEGER,
      // whose final in-range page's skip genuinely overflows.
      const totalItems = Number.MAX_SAFE_INTEGER * 100
      const totalPages = Math.ceil(totalItems / PAGE_SIZE)
      expect(() => computeCatalogPagination(totalPages, totalItems)).toThrow(UnsafePaginationOffsetError)
    })

    it('the guard never fires for any page/totalItems combination reachable via a real catalogue (<= a few million rows)', () => {
      for (const totalItems of [0, 1, 6, 24, 25, 1000, 1_000_000]) {
        const totalPages = Math.ceil(totalItems / PAGE_SIZE) || 1
        for (const page of [1, totalPages, totalPages + 1]) {
          expect(() => computeCatalogPagination(page, totalItems)).not.toThrow()
        }
      }
    })
  })
})
