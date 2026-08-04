import { describe, expect, it } from 'vitest'
import { mapCatalogProduct } from './mapCatalogProduct.js'
import type { CatalogProductDto } from '../types/catalog.js'

function buildDto(overrides: Partial<CatalogProductDto> = {}): CatalogProductDto {
  return {
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
    ...overrides,
  }
}

describe('mapCatalogProduct', () => {
  it('maps to Hebrew display text when language is "he"', () => {
    const result = mapCatalogProduct(buildDto(), 'he')
    expect(result.name).toBe('אומגה 3')
    expect(result.categoryName).toBe('אומגה ושומנים')
    expect(result.categoryNameHe).toBe('אומגה ושומנים')
    expect(result.dosageForm).toBe('כמוסות')
  })

  it('maps to English display text when language is "en"', () => {
    const result = mapCatalogProduct(buildDto(), 'en')
    expect(result.name).toBe('Omega 3')
    expect(result.categoryName).toBe('Omega & Fats')
    expect(result.dosageForm).toBe('Capsules')
  })

  it('always keeps categoryNameHe as the Hebrew tone key, regardless of display language', () => {
    const result = mapCatalogProduct(buildDto(), 'en')
    expect(result.categoryNameHe).toBe('אומגה ושומנים')
  })

  it.each([
    ['CAPSULE', 'כמוסות', 'Capsules'],
    ['TABLET', 'טבליות', 'Tablets'],
    ['DROPS', 'טיפות', 'Drops'],
    ['POWDER', 'אבקה', 'Powder'],
    ['SYRUP', 'סירופ', 'Syrup'],
  ] as const)('translates dosageForm %s to Hebrew "%s" and English "%s"', (key, he, en) => {
    expect(mapCatalogProduct(buildDto({ dosageForm: key }), 'he').dosageForm).toBe(he)
    expect(mapCatalogProduct(buildDto({ dosageForm: key }), 'en').dosageForm).toBe(en)
  })

  it('never invents a fallback label for an unrecognised dosage-form key', () => {
    const dto = buildDto({ dosageForm: 'UNKNOWN_FORM' as CatalogProductDto['dosageForm'] })
    expect(mapCatalogProduct(dto, 'he').dosageForm).toBeUndefined()
  })

  it('preserves price as a string, never converting to a number', () => {
    const result = mapCatalogProduct(buildDto({ price: '9.00' }), 'he')
    expect(result.price).toBe('9.00')
    expect(typeof result.price).toBe('string')
  })

  it('preserves a null imageFile rather than inventing a placeholder', () => {
    const result = mapCatalogProduct(buildDto({ imageFile: null }), 'he')
    expect(result.imageFile).toBeNull()
  })

  it('passes brandName and packageQuantity through unchanged', () => {
    const result = mapCatalogProduct(buildDto({ brandName: 'סופהרב', packageQuantity: 60 }), 'he')
    expect(result.brandName).toBe('סופהרב')
    expect(result.packageQuantity).toBe(60)
  })
})
