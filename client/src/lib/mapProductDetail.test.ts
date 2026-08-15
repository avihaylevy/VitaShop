import { describe, expect, it } from 'vitest'
import { mapCatalogProduct } from './mapCatalogProduct'
import { mapProductDetail } from './mapProductDetail'
import type { ProductDetailDto } from '../types/catalog'

/**
 * MILESTONE-005 Checkpoint J — §7a's client mapping. The point of these
 * tests is the "extends, not parallel" guarantee: the detail model must
 * agree with the card model field-for-field on everything they share.
 */

function detailDto(overrides: Partial<ProductDetailDto> = {}): ProductDetailDto {
  return {
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
    imageFile: 'omega.jpg',
    serialNumber: 'uuid-1',
    usageInstructions: 'כמוסה אחת ביום',
    images: ['omega.jpg', 'omega-back.jpg'],
    descriptionHe: 'תיאור בעברית',
    descriptionEn: 'English description',
    warningsAllergens: 'מכיל דגים',
    allergenInfoIncomplete: false,
    ingredients: [{ name: 'EPA', amount: '180.00', unit: 'mg' }],
    healthGoals: [{ nameHe: 'לב וכלי דם', nameEn: 'Heart' }],
    targetAudience: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('mapProductDetail', () => {
  it('agrees with mapCatalogProduct on every shared field, in both languages', () => {
    const dto = detailDto()
    for (const language of ['he', 'en'] as const) {
      const card = mapCatalogProduct(dto, language)
      const detail = mapProductDetail(dto, language)
      for (const [key, value] of Object.entries(card)) {
        expect(detail[key as keyof typeof card]).toEqual(value)
      }
    }
  })

  it('resolves the description and health goals by language', () => {
    expect(mapProductDetail(detailDto(), 'he').description).toBe('תיאור בעברית')
    expect(mapProductDetail(detailDto(), 'en').description).toBe('English description')
    expect(mapProductDetail(detailDto(), 'he').healthGoals).toEqual(['לב וכלי דם'])
    expect(mapProductDetail(detailDto(), 'en').healthGoals).toEqual(['Heart'])
  })

  it('passes the Hebrew-only manufacturer texts through unchanged in both languages', () => {
    // The schema stores ONE language for usageInstructions and
    // warningsAllergens (field 07 / field 12). The mapper must not fabricate
    // an English variant that does not exist.
    for (const language of ['he', 'en'] as const) {
      const detail = mapProductDetail(detailDto(), language)
      expect(detail.usageInstructions).toBe('כמוסה אחת ביום')
      expect(detail.warningsAllergens).toBe('מכיל דגים')
    }
  })

  it('carries serialNumber, images, ingredients and createdAt verbatim', () => {
    const detail = mapProductDetail(detailDto(), 'he')
    expect(detail.serialNumber).toBe('uuid-1')
    expect(detail.images).toEqual(['omega.jpg', 'omega-back.jpg'])
    expect(detail.ingredients).toEqual([{ name: 'EPA', amount: '180.00', unit: 'mg' }])
    // Not reformatted here — how a date is displayed is the view's decision.
    expect(detail.createdAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('keeps the amount as the server string — never parsed into a number', () => {
    const detail = mapProductDetail(detailDto({ ingredients: [{ name: 'D3', amount: '1000.00', unit: 'IU' }] }), 'he')
    expect(detail.ingredients[0].amount).toBe('1000.00')
    expect(typeof detail.ingredients[0].amount).toBe('string')
  })

  it('preserves a null targetAudience and an empty health-goal set', () => {
    const detail = mapProductDetail(detailDto({ targetAudience: null, healthGoals: [] }), 'he')
    expect(detail.targetAudience).toBeNull()
    expect(detail.healthGoals).toEqual([])
  })

  it('keeps a present targetAudience as-is', () => {
    expect(mapProductDetail(detailDto({ targetAudience: 'מבוגרים' }), 'he').targetAudience).toBe('מבוגרים')
  })

  it('the first image matches the card model imageFile', () => {
    const dto = detailDto()
    expect(mapProductDetail(dto, 'he').images[0]).toBe(mapCatalogProduct(dto, 'he').imageFile)
  })
})
