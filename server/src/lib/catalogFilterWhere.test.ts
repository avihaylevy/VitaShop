import type { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { buildProductWhere, type CatalogFilterInput } from './catalogFilterWhere.js'

function andClauses(where: Prisma.ProductWhereInput): Prisma.ProductWhereInput[] {
  return where.AND as Prisma.ProductWhereInput[]
}

const EMPTY: CatalogFilterInput = {
  q: undefined,
  brand: [],
  ingredient: [],
  healthGoal: [],
  dosageForm: [],
  minPrice: undefined,
  maxPrice: undefined,
  inStock: undefined,
  kosher: undefined,
  glutenFree: undefined,
  vegan: undefined,
}

describe('buildProductWhere', () => {
  it('always restricts to isActive products, even with no other filters', () => {
    const where = buildProductWhere(EMPTY, undefined)
    expect(where.AND).toContainEqual({ isActive: true })
  })

  it('is restricted to isActive products under every filter combination — no combination widens past it', () => {
    const combos: [CatalogFilterInput, string | undefined][] = [
      [{ ...EMPTY, brand: ['b1'] }, undefined],
      [{ ...EMPTY, ingredient: ['i1'] }, undefined],
      [{ ...EMPTY, healthGoal: ['h1'] }, undefined],
      [{ ...EMPTY, dosageForm: ['CAPSULE'] }, undefined],
      [{ ...EMPTY, minPrice: '10' }, undefined],
      [{ ...EMPTY, maxPrice: '10' }, undefined],
      [{ ...EMPTY, inStock: true }, undefined],
      [{ ...EMPTY, kosher: true }, undefined],
      [{ ...EMPTY, glutenFree: true }, undefined],
      [{ ...EMPTY, vegan: true }, undefined],
      [{ ...EMPTY, q: 'omega' }, undefined],
      [EMPTY, 'ויטמינים'],
      [
        { ...EMPTY, q: 'omega', brand: ['b1'], dosageForm: ['CAPSULE'], minPrice: '1', maxPrice: '2', inStock: true },
        'ויטמינים',
      ],
    ]
    for (const [filter, categoryNameHe] of combos) {
      const where = buildProductWhere(filter, categoryNameHe)
      expect(where.AND).toContainEqual({ isActive: true })
    }
  })

  it('adds no other clauses when nothing is supplied', () => {
    expect(buildProductWhere(EMPTY, undefined)).toEqual({ AND: [{ isActive: true }] })
  })

  it('adds a category clause by nameHe when a category is resolved', () => {
    const where = buildProductWhere(EMPTY, 'ויטמינים')
    expect(where.AND).toContainEqual({ category: { nameHe: 'ויטמינים' } })
  })

  it('adds no category clause when category is undefined', () => {
    const where = buildProductWhere(EMPTY, undefined)
    expect(andClauses(where).some((clause) => 'category' in clause)).toBe(false)
  })

  it('brand — OR-within via a single in: [...] clause, not one clause per id', () => {
    const where = buildProductWhere({ ...EMPTY, brand: ['b1', 'b2'] }, undefined)
    expect(where.AND).toContainEqual({ brandId: { in: ['b1', 'b2'] } })
  })

  it('adds no brand clause when brand is empty', () => {
    const where = buildProductWhere(EMPTY, undefined)
    expect(andClauses(where).some((clause) => 'brandId' in clause)).toBe(false)
  })

  it('ingredient — OR-within via the relation "some" filter with in: [...]', () => {
    const where = buildProductWhere({ ...EMPTY, ingredient: ['i1', 'i2'] }, undefined)
    expect(where.AND).toContainEqual({ ingredients: { some: { activeIngredientId: { in: ['i1', 'i2'] } } } })
  })

  it('healthGoal — OR-within via the relation "some" filter with in: [...]', () => {
    const where = buildProductWhere({ ...EMPTY, healthGoal: ['h1', 'h2'] }, undefined)
    expect(where.AND).toContainEqual({ healthGoals: { some: { healthGoalId: { in: ['h1', 'h2'] } } } })
  })

  it('dosageForm — OR-within via in: [...]', () => {
    const where = buildProductWhere({ ...EMPTY, dosageForm: ['CAPSULE', 'TABLET'] }, undefined)
    expect(where.AND).toContainEqual({ dosageForm: { in: ['CAPSULE', 'TABLET'] } })
  })

  it('minPrice — passed as the validated decimal string, never Number()/parseFloat()', () => {
    const where = buildProductWhere({ ...EMPTY, minPrice: '10.50' }, undefined)
    expect(where.AND).toContainEqual({ price: { gte: '10.50' } })
  })

  it('maxPrice — passed as the validated decimal string', () => {
    const where = buildProductWhere({ ...EMPTY, maxPrice: '99999.99' }, undefined)
    expect(where.AND).toContainEqual({ price: { lte: '99999.99' } })
  })

  it('min and max together produce both clauses', () => {
    const where = buildProductWhere({ ...EMPTY, minPrice: '10', maxPrice: '20' }, undefined)
    expect(where.AND).toContainEqual({ price: { gte: '10' } })
    expect(where.AND).toContainEqual({ price: { lte: '20' } })
  })

  it('inStock true — stockQuantity > 0', () => {
    const where = buildProductWhere({ ...EMPTY, inStock: true }, undefined)
    expect(where.AND).toContainEqual({ stockQuantity: { gt: 0 } })
  })

  it('inStock absent — no stock clause added', () => {
    const where = buildProductWhere(EMPTY, undefined)
    expect(andClauses(where).some((clause) => 'stockQuantity' in clause)).toBe(false)
  })

  it('kosher true — isKosher: true clause; null (unsourced) rows are excluded by equality', () => {
    const where = buildProductWhere({ ...EMPTY, kosher: true }, undefined)
    expect(andClauses(where)).toContainEqual({ isKosher: true })
  })

  it('glutenFree true — isGlutenFree: true clause', () => {
    const where = buildProductWhere({ ...EMPTY, glutenFree: true }, undefined)
    expect(andClauses(where)).toContainEqual({ isGlutenFree: true })
  })

  it('vegan true — isVegan: true clause', () => {
    const where = buildProductWhere({ ...EMPTY, vegan: true }, undefined)
    expect(andClauses(where)).toContainEqual({ isVegan: true })
  })

  it('dietary flags absent — no dietary clause added at all', () => {
    const clauses = andClauses(buildProductWhere(EMPTY, undefined))
    for (const clause of clauses) {
      expect(clause).not.toHaveProperty('isKosher')
      expect(clause).not.toHaveProperty('isGlutenFree')
      expect(clause).not.toHaveProperty('isVegan')
    }
  })

  it('AND-across-groups: every present group contributes its own top-level AND clause', () => {
    const where = buildProductWhere(
      { ...EMPTY, brand: ['b1'], dosageForm: ['CAPSULE'], inStock: true },
      'ויטמינים',
    )
    expect(where.AND).toEqual([
      { isActive: true },
      { category: { nameHe: 'ויטמינים' } },
      { brandId: { in: ['b1'] } },
      { dosageForm: { in: ['CAPSULE'] } },
      { stockQuantity: { gt: 0 } },
    ])
  })

  it('no q supplied — no search clause added at all', () => {
    const where = buildProductWhere(EMPTY, undefined)
    const serialized = JSON.stringify(where)
    expect(serialized).not.toContain('contains')
  })

  it('q — composed as its own AND-across-groups entry, itself an OR across searched fields (Checkpoint E)', () => {
    const where = buildProductWhere({ ...EMPTY, q: 'omega' }, undefined)
    expect(andClauses(where)).toContainEqual(
      expect.objectContaining({ OR: expect.arrayContaining([{ nameHe: { contains: 'omega', mode: 'insensitive' } }]) }),
    )
  })

  it('q AND category AND brand — search composes with every other group without weakening AND-across-groups', () => {
    const where = buildProductWhere({ ...EMPTY, q: 'omega', brand: ['b1'] }, 'ויטמינים')
    expect(where.AND).toEqual([
      { isActive: true },
      expect.objectContaining({ OR: expect.any(Array) }),
      { category: { nameHe: 'ויטמינים' } },
      { brandId: { in: ['b1'] } },
    ])
  })
})
