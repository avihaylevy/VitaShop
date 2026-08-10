// Unit coverage for the EXACT Prisma `where` shape the Product Details
// lookup sends, using a minimal fake Prisma client (a stubbed
// `product.findFirst` only — not a general mocking pattern; the only other
// stub of this kind in the codebase is catalogIdExistence.test.ts).
//
// Why this file exists: §7's "an inactive product returns the identical 404"
// carries an explicit security rationale — soft-deleted products must not be
// probeable for existence. The guarantee is that `isActive: true` sits in the
// WHERE CLAUSE rather than in a post-filter. That cannot be exercised against
// live data, because vitashop_dev currently has ZERO inactive products
// (asserted in catalog.integration.test.ts), and it cannot be proven by the
// mapper either — the mapper only ever runs on a product that was already
// found.
//
// 🔴 Checkpoint D already adjudicated this exact situation: §4b's
// active-usage rule was unprovable live for the same reason, and
// "it's structural, read the code" was NOT accepted — the resolution was a
// narrowly-scoped fake-Prisma test asserting the where shape. This file
// applies that same standard instead of claiming an exception.
import type { PrismaClient } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { DETAIL_RELATIONS_INCLUDE, findActiveProductBySlug } from './catalogProductLookup.js'

function fakePrisma(result: unknown = null) {
  const findFirst = vi.fn().mockResolvedValue(result)
  return { prisma: { product: { findFirst } } as unknown as PrismaClient, findFirst }
}

describe('findActiveProductBySlug — the §7 not-found guarantee', () => {
  it('🔴 filters isActive in the WHERE clause, together with the slug — never as a post-filter', async () => {
    const { prisma, findFirst } = fakePrisma()

    await findActiveProductBySlug(prisma, 'solgar-omega-3')

    expect(findFirst).toHaveBeenCalledTimes(1)
    const [args] = findFirst.mock.calls[0] as [{ where: unknown }]
    // Asserted as an exact object, not with objectContaining: an extra or
    // renamed key in `where` is precisely the kind of drift this guards.
    expect(args.where).toEqual({ slug: 'solgar-omega-3', isActive: true })
  })

  it('sends no second query and applies no filtering after the fact', async () => {
    // If `isActive` were ever moved out of the query into a post-filter, the
    // most likely shape would be a broader lookup followed by a check. The
    // call count plus the exact `where` above pin that shut from both sides.
    const { prisma, findFirst } = fakePrisma({ id: 'p-1', isActive: false })

    const result = await findActiveProductBySlug(prisma, 'any-slug')

    expect(findFirst).toHaveBeenCalledTimes(1)
    // Whatever the (fake) database returns is returned verbatim — this
    // function's ONLY filtering is the where clause it sends.
    expect(result).toMatchObject({ id: 'p-1' })
  })

  it('an inactive product and a nonexistent slug are indistinguishable at this boundary', async () => {
    // Both cases produce `null` from the same single query, which is what
    // gives the route one not-found path rather than two that could drift
    // apart. This is the unit-level statement of §7's identical-404 rule.
    const inactive = fakePrisma(null)
    const absent = fakePrisma(null)

    const inactiveResult = await findActiveProductBySlug(inactive.prisma, 'soft-deleted-product')
    const absentResult = await findActiveProductBySlug(absent.prisma, 'never-existed')

    expect(inactiveResult).toBeNull()
    expect(absentResult).toBeNull()

    const [inactiveArgs] = inactive.findFirst.mock.calls[0] as [{ where: unknown; include: unknown }]
    const [absentArgs] = absent.findFirst.mock.calls[0] as [{ where: unknown; include: unknown }]
    // Same query shape for both — only the slug differs.
    expect(inactiveArgs.include).toEqual(absentArgs.include)
    expect(Object.keys(inactiveArgs.where as object).sort()).toEqual(Object.keys(absentArgs.where as object).sort())
  })

  it('requests exactly the relations §7a fields 10, 13 and 14 need', async () => {
    const { prisma, findFirst } = fakePrisma()

    await findActiveProductBySlug(prisma, 'x')

    const [args] = findFirst.mock.calls[0] as [{ include: unknown }]
    expect(args.include).toEqual(DETAIL_RELATIONS_INCLUDE)
    expect(args.include).toEqual({
      category: true,
      brand: true,
      images: true,
      ingredients: { include: { activeIngredient: true } },
      healthGoals: { include: { healthGoal: true } },
    })
  })

  it('passes the slug through verbatim — no normalisation, no case folding', async () => {
    const { prisma, findFirst } = fakePrisma()

    await findActiveProductBySlug(prisma, 'Solgar-Omega-3')

    const [args] = findFirst.mock.calls[0] as [{ where: { slug: string } }]
    // `slug` is a stable business key (DEC-033); silently rewriting it here
    // would make two different URLs resolve to one product.
    expect(args.where.slug).toBe('Solgar-Omega-3')
  })
})
