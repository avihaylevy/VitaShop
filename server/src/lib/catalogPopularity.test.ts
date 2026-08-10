import type { PrismaClient } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { resolvePopularityScores, sortByPopularity } from './catalogPopularity.js'

interface Fixture {
  id: string
  slug: string
  createdAt: Date
}

function product(id: string, slug: string, createdAt: string): Fixture {
  return { id, slug, createdAt: new Date(createdAt) }
}

describe('sortByPopularity', () => {
  it('sorts by score descending', () => {
    const a = product('a', 'a', '2026-01-01')
    const b = product('b', 'b', '2026-01-01')
    const c = product('c', 'c', '2026-01-01')
    const scores = new Map([
      ['a', 5],
      ['b', 10],
      ['c', 1],
    ])
    expect(sortByPopularity([a, b, c], scores).map((p) => p.id)).toEqual(['b', 'a', 'c'])
  })

  it('a product absent from the scores map is treated as score 0', () => {
    const scored = product('scored', 'scored', '2026-01-01')
    const unscored = product('unscored', 'unscored', '2026-01-01')
    const scores = new Map([['scored', 3]])
    expect(sortByPopularity([unscored, scored], scores).map((p) => p.id)).toEqual(['scored', 'unscored'])
  })

  it('tie-breaks equal scores by createdAt descending (newest first)', () => {
    const older = product('older', 'older', '2026-01-01')
    const newer = product('newer', 'newer', '2026-01-05')
    const scores = new Map([
      ['older', 5],
      ['newer', 5],
    ])
    expect(sortByPopularity([older, newer], scores).map((p) => p.id)).toEqual(['newer', 'older'])
  })

  it('tie-breaks equal scores AND equal createdAt by slug ascending', () => {
    const zebra = product('z-id', 'zebra', '2026-01-01')
    const apple = product('a-id', 'apple', '2026-01-01')
    const scores = new Map([
      ['z-id', 5],
      ['a-id', 5],
    ])
    expect(sortByPopularity([zebra, apple], scores).map((p) => p.slug)).toEqual(['apple', 'zebra'])
  })

  it('when order data is empty (all scores 0), the deterministic tie-break alone decides — stable and reproducible', () => {
    const products = [
      product('1', 'charlie', '2026-01-01'),
      product('2', 'alpha', '2026-01-03'),
      product('3', 'bravo', '2026-01-03'),
    ]
    const emptyScores = new Map<string, number>()
    const result = sortByPopularity(products, emptyScores)
    // Both alpha/bravo tie at score 0 and the same createdAt -> slug asc.
    // charlie is older -> createdAt desc puts it last.
    expect(result.map((p) => p.slug)).toEqual(['alpha', 'bravo', 'charlie'])
  })

  it('does not mutate the input array', () => {
    const products = [product('1', 'b', '2026-01-01'), product('2', 'a', '2026-01-01')]
    const original = [...products]
    sortByPopularity(products, new Map([['1', 1]]))
    expect(products).toEqual(original)
  })

  it('is stable and reproducible across repeated calls with the same input', () => {
    const products = [
      product('1', 'x', '2026-01-01'),
      product('2', 'y', '2026-01-01'),
      product('3', 'z', '2026-01-01'),
    ]
    const scores = new Map([
      ['1', 2],
      ['2', 2],
      ['3', 1],
    ])
    const first = sortByPopularity(products, scores).map((p) => p.id)
    const second = sortByPopularity(products, scores).map((p) => p.id)
    expect(first).toEqual(second)
  })
})

// The current vitashop_dev seed has zero orders/order items (verified
// read-only, see catalog.integration.test.ts), so the real
// SUM(OrderItem.quantity)/30-day-window/cancelled-exclusion query shape
// cannot be proven against live data without seeding — forbidden by this
// project's read-only integration-test rule. Proven here instead, the same
// fake-Prisma-stub pattern catalogIdExistence.test.ts already established
// (the only such stub in this codebase, narrowly scoped per module).
describe('resolvePopularityScores', () => {
  function fakePrisma(rows: { productId: string; _sum: { quantity: number | null } }[]) {
    return {
      orderItem: { groupBy: vi.fn().mockResolvedValue(rows) },
    } as unknown as PrismaClient
  }

  it('returns an empty map when no product ids are supplied — no query issued', async () => {
    const prisma = fakePrisma([])
    const scores = await resolvePopularityScores(prisma, [])
    expect(scores).toEqual(new Map())
    expect((prisma.orderItem.groupBy as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })

  it('maps each groupBy row\'s productId to its summed quantity', async () => {
    const prisma = fakePrisma([
      { productId: 'p1', _sum: { quantity: 12 } },
      { productId: 'p2', _sum: { quantity: 3 } },
    ])
    const scores = await resolvePopularityScores(prisma, ['p1', 'p2'])
    expect(scores).toEqual(
      new Map([
        ['p1', 12],
        ['p2', 3],
      ]),
    )
  })

  it('a null _sum.quantity (no matching rows for a grouped id) becomes 0, not null/NaN', async () => {
    const prisma = fakePrisma([{ productId: 'p1', _sum: { quantity: null } }])
    const scores = await resolvePopularityScores(prisma, ['p1'])
    expect(scores.get('p1')).toBe(0)
  })

  it('the groupBy call excludes cancelled orders and is bounded to the last 30 days', async () => {
    const prisma = fakePrisma([])
    await resolvePopularityScores(prisma, ['p1'])
    const call = (prisma.orderItem.groupBy as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(call.by).toEqual(['productId'])
    expect(call.where.productId).toEqual({ in: ['p1'] })
    expect(call.where.order.status).toEqual({ not: 'cancelled' })
    expect(call.where.order.createdAt.gte).toBeInstanceOf(Date)
    const daysAgo = (Date.now() - (call.where.order.createdAt.gte as Date).getTime()) / (24 * 60 * 60 * 1000)
    expect(daysAgo).toBeCloseTo(30, 0)
    expect(call._sum).toEqual({ quantity: true })
  })

  it('no stored column, no raw SQL — aggregates via Prisma groupBy only', async () => {
    const prisma = fakePrisma([])
    await resolvePopularityScores(prisma, ['p1'])
    expect(prisma.orderItem.groupBy).toHaveBeenCalledTimes(1)
  })
})
