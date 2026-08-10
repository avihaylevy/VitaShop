// Unit coverage for findInvalidReferencedIdFields's own comparison logic and
// the exact Prisma `where` shape it sends, using a minimal fake Prisma
// client (stubbed .count calls only — not a general mocking pattern, and not
// used anywhere else in this codebase). This exists because the current
// vitashop_dev seed has ZERO inactive products (verified — see
// catalog.integration.test.ts), so "an id that exists but is used only by
// inactive products" cannot be constructed against live data today. The
// integration test proves the happy path (existing + active-used id
// accepted) and the plain-nonexistent-id path against the real database;
// this file proves the inactive-only-usage rejection and the exact
// active-usage `where` shape, matching catalogFacets.ts's semantics exactly.
import type { PrismaClient } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { findInvalidReferencedIdFields } from './catalogIdExistence.js'

function fakePrisma(counts: { brand?: number; activeIngredient?: number; healthGoal?: number }) {
  return {
    brand: { count: vi.fn().mockResolvedValue(counts.brand ?? 0) },
    activeIngredient: { count: vi.fn().mockResolvedValue(counts.activeIngredient ?? 0) },
    healthGoal: { count: vi.fn().mockResolvedValue(counts.healthGoal ?? 0) },
  } as unknown as PrismaClient
}

describe('findInvalidReferencedIdFields', () => {
  it('returns no invalid fields when nothing is supplied', async () => {
    const prisma = fakePrisma({})
    const result = await findInvalidReferencedIdFields(prisma, { brand: [], ingredient: [], healthGoal: [] })
    expect(result).toEqual([])
  })

  it('brand — existing id used by an active product is accepted (found count matches distinct count)', async () => {
    const prisma = fakePrisma({ brand: 1 })
    const result = await findInvalidReferencedIdFields(prisma, { brand: ['b1'], ingredient: [], healthGoal: [] })
    expect(result).toEqual([])
  })

  it('brand — an id that exists but is used ONLY by inactive products is rejected (active-usage count is 0, not 1)', async () => {
    // The fake DB "has" the brand row (a bare existence check would pass),
    // but the active-usage-filtered count is 0 — exactly what a real brand
    // whose only products are all soft-deleted would produce.
    const prisma = fakePrisma({ brand: 0 })
    const result = await findInvalidReferencedIdFields(prisma, { brand: ['b1'], ingredient: [], healthGoal: [] })
    expect(result).toEqual(['brand'])
  })

  it('brand — a genuinely nonexistent id is rejected the same way (count 0)', async () => {
    const prisma = fakePrisma({ brand: 0 })
    const result = await findInvalidReferencedIdFields(prisma, {
      brand: ['00000000-0000-4000-8000-000000000000'],
      ingredient: [],
      healthGoal: [],
    })
    expect(result).toEqual(['brand'])
  })

  it('ingredient — inactive-only usage is rejected', async () => {
    const prisma = fakePrisma({ activeIngredient: 0 })
    const result = await findInvalidReferencedIdFields(prisma, { brand: [], ingredient: ['i1'], healthGoal: [] })
    expect(result).toEqual(['ingredient'])
  })

  it('healthGoal — inactive-only usage is rejected', async () => {
    const prisma = fakePrisma({ healthGoal: 0 })
    const result = await findInvalidReferencedIdFields(prisma, { brand: [], ingredient: [], healthGoal: ['h1'] })
    expect(result).toEqual(['healthGoal'])
  })

  it('a mix of one valid and one inactive-only id in the same field still rejects the whole field (found count < distinct count)', async () => {
    // 2 distinct ids supplied, only 1 is active-usage-valid -> found=1 !== 2.
    const prisma = fakePrisma({ brand: 1 })
    const result = await findInvalidReferencedIdFields(prisma, {
      brand: ['b-active', 'b-inactive-only'],
      ingredient: [],
      healthGoal: [],
    })
    expect(result).toEqual(['brand'])
  })

  it('duplicate supplied ids do not mask an invalid one — comparison is against DISTINCT count', async () => {
    const prisma = fakePrisma({ brand: 0 })
    const result = await findInvalidReferencedIdFields(prisma, {
      brand: ['b1', 'b1', 'b1'],
      ingredient: [],
      healthGoal: [],
    })
    expect(result).toEqual(['brand'])
  })

  it('multiple invalid fields accumulate, in canonical §5 order (brand, ingredient, healthGoal)', async () => {
    const prisma = fakePrisma({ brand: 0, activeIngredient: 0, healthGoal: 0 })
    const result = await findInvalidReferencedIdFields(prisma, {
      brand: ['b1'],
      ingredient: ['i1'],
      healthGoal: ['h1'],
    })
    expect(result).toEqual(['brand', 'ingredient', 'healthGoal'])
  })

  it('a field with zero supplied ids is never queried and never reported', async () => {
    const prisma = fakePrisma({ brand: 1 })
    await findInvalidReferencedIdFields(prisma, { brand: ['b1'], ingredient: [], healthGoal: [] })
    expect((prisma.activeIngredient.count as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
    expect((prisma.healthGoal.count as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })

  it('brand — the where clause requires active usage, matching catalogFacets.ts\'s exact shape', async () => {
    const prisma = fakePrisma({ brand: 1 })
    await findInvalidReferencedIdFields(prisma, { brand: ['b1'], ingredient: [], healthGoal: [] })
    expect(prisma.brand.count).toHaveBeenCalledWith({
      where: { id: { in: ['b1'] }, products: { some: { isActive: true } } },
    })
  })

  it('ingredient — the where clause requires active usage through the product relation', async () => {
    const prisma = fakePrisma({ activeIngredient: 1 })
    await findInvalidReferencedIdFields(prisma, { brand: [], ingredient: ['i1'], healthGoal: [] })
    expect(prisma.activeIngredient.count).toHaveBeenCalledWith({
      where: { id: { in: ['i1'] }, products: { some: { product: { isActive: true } } } },
    })
  })

  it('healthGoal — the where clause requires active usage through the product relation', async () => {
    const prisma = fakePrisma({ healthGoal: 1 })
    await findInvalidReferencedIdFields(prisma, { brand: [], ingredient: [], healthGoal: ['h1'] })
    expect(prisma.healthGoal.count).toHaveBeenCalledWith({
      where: { id: { in: ['h1'] }, products: { some: { product: { isActive: true } } } },
    })
  })
})
