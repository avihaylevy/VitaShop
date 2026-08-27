import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import {
  CatalogIntegrityError,
  mapProductToPublicCatalog,
  mapProductToPublicDetail,
  type ProductWithCatalogRelations,
  type ProductWithDetailRelations,
} from './catalogMapper.js'

function buildProduct(overrides: Partial<ProductWithCatalogRelations> = {}): ProductWithCatalogRelations {
  return {
    id: 'p-1',
    slug: 'solgar-omega-3',
    nameHe: 'אומגה 3',
    nameEn: 'Omega 3',
    categoryId: 'cat-1',
    category: { id: 'cat-1', nameHe: 'אומגה ושומנים', nameEn: 'Omega & Fats' },
    brandId: 'brand-1',
    brand: { id: 'brand-1', name: 'סולגאר', nameEn: 'Solgar' },
    dosageForm: 'CAPSULE',
    packageQuantity: 100,
    usageInstructions: 'כמוסה אחת ביום',
    price: new Prisma.Decimal('94.9'),
    stockQuantity: 60,
    descriptionHe: 'תיאור',
    descriptionEn: 'Description',
    shortDescriptionHe: 'תקציר',
    shortDescriptionEn: 'Short description',
    warningsAllergens: 'אין',
    allergenInfoIncomplete: false,
    targetAudience: null,
    createdAt: new Date('2026-01-01'),
    isActive: true,
    lowStockThreshold: 5,
    images: [{ id: 'img-1', productId: 'p-1', url: 'assets/products/solgar-omega-3.jpg', sortOrder: 0 }],
    ...overrides,
  } as ProductWithCatalogRelations
}

describe('mapProductToPublicCatalog', () => {
  it('maps every field to the approved public shape', () => {
    const result = mapProductToPublicCatalog(buildProduct())
    expect(result).toEqual({
      slug: 'solgar-omega-3',
      nameHe: 'אומגה 3',
      nameEn: 'Omega 3',
      categoryNameHe: 'אומגה ושומנים',
      categoryNameEn: 'Omega & Fats',
      categorySlug: 'omega-fats',
      brandName: 'סולגאר',
      brandNameEn: 'Solgar',
      dosageForm: 'CAPSULE',
      packageQuantity: 100,
      price: '94.90',
      stockQuantity: 60,
      lowStockThreshold: 5,
      shortDescriptionHe: 'תקציר',
      shortDescriptionEn: 'Short description',
      imageFile: 'solgar-omega-3.jpg',
    })
  })

  it('never returns a floating-point-derived price — serializes via Decimal.toFixed(2)', () => {
    const result = mapProductToPublicCatalog(buildProduct({ price: new Prisma.Decimal('9') }))
    expect(result.price).toBe('9.00')
  })

  it('returns imageFile as a basename only, never a path', () => {
    const result = mapProductToPublicCatalog(
      buildProduct({ images: [{ id: 'img-1', productId: 'p-1', url: 'assets/products/nested/dir/file.jpg', sortOrder: 0 }] }),
    )
    expect(result.imageFile).toBe('file.jpg')
  })

  it('returns imageFile null when the product has no images', () => {
    const result = mapProductToPublicCatalog(buildProduct({ images: [] }))
    expect(result.imageFile).toBeNull()
  })

  it('picks the first image by sortOrder, not array order', () => {
    const result = mapProductToPublicCatalog(
      buildProduct({
        images: [
          { id: 'img-b', productId: 'p-1', url: 'assets/products/second.jpg', sortOrder: 1 },
          { id: 'img-a', productId: 'p-1', url: 'assets/products/first.jpg', sortOrder: 0 },
        ],
      }),
    )
    expect(result.imageFile).toBe('first.jpg')
  })

  it('breaks a sortOrder tie by id ascending', () => {
    const result = mapProductToPublicCatalog(
      buildProduct({
        images: [
          { id: 'img-z', productId: 'p-1', url: 'assets/products/z.jpg', sortOrder: 0 },
          { id: 'img-a', productId: 'p-1', url: 'assets/products/a.jpg', sortOrder: 0 },
        ],
      }),
    )
    expect(result.imageFile).toBe('a.jpg')
  })

  it('never leaks internal fields (id, timestamps, warnings, ingredients, targetAudience)', () => {
    const result = mapProductToPublicCatalog(buildProduct())
    expect(result).not.toHaveProperty('id')
    expect(result).not.toHaveProperty('createdAt')
    // DEC-111: the FULL description stays excluded (detail-only); the
    // SHORT pair is the list's own field, asserted in the shape test.
    expect(result).not.toHaveProperty('descriptionHe')
    expect(result).not.toHaveProperty('descriptionEn')
    expect(result).not.toHaveProperty('warningsAllergens')
    // DEC-032 DECISION B — the flag is DETAIL-ONLY, like the field it
    // qualifies. Leaking it into the list DTO without the accompanying text
    // would be a provenance claim with nothing to attach to.
    expect(result).not.toHaveProperty('allergenInfoIncomplete')
    expect(result).not.toHaveProperty('targetAudience')
    expect(result).not.toHaveProperty('usageInstructions')
  })

  it('throws CatalogIntegrityError when the category is not one of the six canonical categories', () => {
    const product = buildProduct({ category: { id: 'cat-x', nameHe: 'קטגוריה לא קיימת', nameEn: 'Nonexistent' } })
    expect(() => mapProductToPublicCatalog(product)).toThrow(CatalogIntegrityError)
  })

  it('CatalogIntegrityError carries the offending product slug and category', () => {
    const product = buildProduct({
      slug: 'bad-product',
      category: { id: 'cat-x', nameHe: 'קטגוריה לא קיימת', nameEn: 'Nonexistent' },
    })
    try {
      mapProductToPublicCatalog(product)
      expect.unreachable('expected mapProductToPublicCatalog to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(CatalogIntegrityError)
      expect((error as CatalogIntegrityError).productSlug).toBe('bad-product')
      expect((error as CatalogIntegrityError).categoryNameHe).toBe('קטגוריה לא קיימת')
    }
  })
})

/**
 * MILESTONE-005 Checkpoint J — §7a's detail mapping. The live 16-field
 * contract assertion (TEST-002) runs against the real database in
 * `routes/catalog.integration.test.ts`; these unit tests pin the parts the
 * seed cannot exercise today — ordering, Decimal serialization, an empty
 * health-goal set, and integrity failure — deterministically.
 */
function buildDetailProduct(overrides: Partial<ProductWithDetailRelations> = {}): ProductWithDetailRelations {
  return {
    ...buildProduct(),
    ingredients: [
      {
        id: 'pi-1',
        productId: 'p-1',
        activeIngredientId: 'ai-1',
        activeIngredient: { id: 'ai-1', name: 'Vitamin D3' },
        amount: new Prisma.Decimal('1000'),
        unit: 'IU',
      },
      {
        id: 'pi-2',
        productId: 'p-1',
        activeIngredientId: 'ai-2',
        activeIngredient: { id: 'ai-2', name: 'EPA' },
        amount: new Prisma.Decimal('180.5'),
        unit: 'mg',
      },
    ],
    healthGoals: [
      { productId: 'p-1', healthGoalId: 'hg-1', healthGoal: { id: 'hg-1', nameHe: 'לב וכלי דם', nameEn: 'Heart' } },
      { productId: 'p-1', healthGoalId: 'hg-2', healthGoal: { id: 'hg-2', nameHe: 'אנרגיה', nameEn: 'Energy' } },
    ],
    ...overrides,
  } as ProductWithDetailRelations
}

describe('mapProductToPublicDetail — §7a', () => {
  it('carries field 01 as serialNumber, sourced from Product.id', () => {
    const result = mapProductToPublicDetail(buildDetailProduct())
    expect(result.serialNumber).toBe('p-1')
  })

  it('extends the list DTO rather than redeclaring it — shared fields are byte-identical', () => {
    const product = buildDetailProduct()
    const list = mapProductToPublicCatalog(product)
    const detail = mapProductToPublicDetail(product)

    // Every field the list defines appears in the detail with the same
    // value. This is what makes "extends, not a parallel definition"
    // (§7) checkable rather than merely stated.
    for (const [key, value] of Object.entries(list)) {
      expect(detail[key as keyof typeof list]).toEqual(value)
    }
  })

  it('orders images by sortOrder then id, and returns basenames only', () => {
    const result = mapProductToPublicDetail(
      buildDetailProduct({
        images: [
          { id: 'img-c', productId: 'p-1', url: 'assets/products/third.jpg', sortOrder: 2 },
          { id: 'img-b', productId: 'p-1', url: 'assets/products/nested/second.jpg', sortOrder: 1 },
          { id: 'img-a', productId: 'p-1', url: 'assets/products/first.jpg', sortOrder: 1 },
        ],
      } as Partial<ProductWithDetailRelations>),
    )
    // sortOrder first, then id as the tie-break: 1/img-a, 1/img-b, 2/img-c.
    expect(result.images).toEqual(['first.jpg', 'second.jpg', 'third.jpg'])
  })

  it('exposes the same first image the list DTO exposes', () => {
    const product = buildDetailProduct({
      images: [
        { id: 'img-b', productId: 'p-1', url: 'assets/products/second.jpg', sortOrder: 5 },
        { id: 'img-a', productId: 'p-1', url: 'assets/products/first.jpg', sortOrder: 1 },
      ],
    } as Partial<ProductWithDetailRelations>)

    expect(mapProductToPublicDetail(product).images[0]).toBe(mapProductToPublicCatalog(product).imageFile)
  })

  it('serializes ingredient amounts through Decimal.toFixed(2), never a float, sorted by name', () => {
    const result = mapProductToPublicDetail(buildDetailProduct())
    expect(result.ingredients).toEqual([
      { name: 'EPA', amount: '180.50', unit: 'mg' },
      { name: 'Vitamin D3', amount: '1000.00', unit: 'IU' },
    ])
  })

  it('returns health goals bilingually, sorted by nameHe', () => {
    const result = mapProductToPublicDetail(buildDetailProduct())
    expect(result.healthGoals).toEqual([
      { nameHe: 'אנרגיה', nameEn: 'Energy' },
      { nameHe: 'לב וכלי דם', nameEn: 'Heart' },
    ])
  })

  it('accepts zero health goals and zero ingredients — field 14 is "0 or more"', () => {
    const result = mapProductToPublicDetail(
      buildDetailProduct({ ingredients: [], healthGoals: [] } as Partial<ProductWithDetailRelations>),
    )
    expect(result.healthGoals).toEqual([])
    expect(result.ingredients).toEqual([])
  })

  it('keeps a null targetAudience as null — field 15 is nullable, not omitted', () => {
    const result = mapProductToPublicDetail(buildDetailProduct())
    expect(result.targetAudience).toBeNull()
    expect('targetAudience' in result).toBe(true)
  })

  it('serializes createdAt as an ISO string, never a Date instance', () => {
    const result = mapProductToPublicDetail(buildDetailProduct())
    expect(result.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(typeof result.createdAt).toBe('string')
  })

  it('fails closed on a non-canonical category, exactly like the list mapper', () => {
    expect(() =>
      mapProductToPublicDetail(
        buildDetailProduct({
          slug: 'bad-product',
          category: { id: 'cat-x', nameHe: 'קטגוריה לא קיימת', nameEn: 'Nope' },
        } as Partial<ProductWithDetailRelations>),
      ),
    ).toThrow(CatalogIntegrityError)
  })
})

// DEC-032 DECISION B — provenance, not absence.
describe('mapProductToPublicDetail — the allergen provenance flag', () => {
  it('carries the flag through unchanged, in BOTH directions', () => {
    expect(mapProductToPublicDetail(buildDetailProduct()).allergenInfoIncomplete).toBe(false)
    expect(
      mapProductToPublicDetail(buildDetailProduct({ allergenInfoIncomplete: true })).allergenInfoIncomplete,
    ).toBe(true)
  })

  it('does not derive the flag from the text — an empty declaration does NOT imply it', () => {
    const result = mapProductToPublicDetail(
      buildDetailProduct({ warningsAllergens: '', allergenInfoIncomplete: false }),
    )
    expect(result.warningsAllergens).toBe('')
    expect(result.allergenInfoIncomplete).toBe(false)
  })
})
