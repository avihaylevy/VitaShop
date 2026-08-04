import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { CatalogIntegrityError, mapProductToPublicCatalog, type ProductWithCatalogRelations } from './catalogMapper.js'

function buildProduct(overrides: Partial<ProductWithCatalogRelations> = {}): ProductWithCatalogRelations {
  return {
    id: 'p-1',
    slug: 'solgar-omega-3',
    nameHe: 'אומגה 3',
    nameEn: 'Omega 3',
    categoryId: 'cat-1',
    category: { id: 'cat-1', nameHe: 'אומגה ושומנים', nameEn: 'Omega & Fats' },
    brandId: 'brand-1',
    brand: { id: 'brand-1', name: 'סולגאר' },
    dosageForm: 'CAPSULE',
    packageQuantity: 100,
    usageInstructions: 'כמוסה אחת ביום',
    price: new Prisma.Decimal('94.9'),
    stockQuantity: 60,
    descriptionHe: 'תיאור',
    descriptionEn: 'Description',
    warningsAllergens: 'אין',
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
      dosageForm: 'CAPSULE',
      packageQuantity: 100,
      price: '94.90',
      stockQuantity: 60,
      lowStockThreshold: 5,
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

  it('never leaks internal fields (id, timestamps, description, ingredients, targetAudience)', () => {
    const result = mapProductToPublicCatalog(buildProduct())
    expect(result).not.toHaveProperty('id')
    expect(result).not.toHaveProperty('createdAt')
    expect(result).not.toHaveProperty('descriptionHe')
    expect(result).not.toHaveProperty('descriptionEn')
    expect(result).not.toHaveProperty('warningsAllergens')
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
