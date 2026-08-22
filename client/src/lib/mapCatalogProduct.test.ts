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
    brandNameEn: 'Solgar',
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

  it("the user's follow-up — SYRUP is volume too, POWDER is weight (גרם / g)", () => {
    expect(mapCatalogProduct(buildDto({ dosageForm: 'SYRUP' }), 'he').packageUnit).toBe('מ"ל')
    expect(mapCatalogProduct(buildDto({ dosageForm: 'SYRUP' }), 'en').packageUnit).toBe('ml')
    expect(mapCatalogProduct(buildDto({ dosageForm: 'POWDER' }), 'he').packageUnit).toBe('גרם')
    expect(mapCatalogProduct(buildDto({ dosageForm: 'POWDER' }), 'en').packageUnit).toBe('g')
  })

  it("the thirteenth list — DROPS carry a VOLUME unit (מ״ל / ml)", () => {
    const he = mapCatalogProduct(buildDto({ dosageForm: 'DROPS', packageQuantity: 250 }), 'he')
    expect(he.packageUnit).toBe('מ"ל')
    const en = mapCatalogProduct(buildDto({ dosageForm: 'DROPS', packageQuantity: 250 }), 'en')
    expect(en.packageUnit).toBe('ml')
  })

  it('🔴 the unit map covers the WHOLE enum — a new form must be classified on purpose', () => {
    /*
     * PACKAGE_UNIT_LABELS is deliberately partial: absence = countable. This
     * pin enumerates the classification for EVERY dosage form the server
     * knows, so adding a form (OIL, GEL…) without deciding its unit turns
     * this red instead of silently rendering "100 שמן" — the exact defect
     * class the thirteenth list fixed.
     */
    const expected: Record<string, string | undefined> = {
      CAPSULE: undefined,
      TABLET: undefined,
      DROPS: 'מ"ל',
      SYRUP: 'מ"ל',
      POWDER: 'גרם',
    }
    for (const [form, unit] of Object.entries(expected)) {
      expect(mapCatalogProduct(buildDto({ dosageForm: form as never }), 'he').packageUnit).toBe(unit)
    }
  })

  it('⚠️ THE CONTROL — a countable form has NO package unit', () => {
    // Without this, "drops get a unit" is satisfied by every form getting one.
    expect(mapCatalogProduct(buildDto(), 'he').packageUnit).toBeUndefined()
    expect(mapCatalogProduct(buildDto({ dosageForm: 'TABLET' }), 'en').packageUnit).toBeUndefined()
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

  it('passes packageQuantity through unchanged', () => {
    const result = mapCatalogProduct(buildDto({ brandName: 'סופהרב', brandNameEn: null, packageQuantity: 60 }), 'he')
    expect(result.packageQuantity).toBe(60)
  })

  // DEC-085 (user, 2026-08-15, amends ISSUE-127a) — the brand reads in its
  // manufacturer-verified Latin form in BOTH languages; a brand without a
  // sourced Latin form falls back rather than inventing one.
  it('picks brandNameEn in BOTH languages', () => {
    const dto = buildDto({ brandName: 'סולגאר', brandNameEn: 'Solgar' })
    expect(mapCatalogProduct(dto, 'en').brandName).toBe('Solgar')
    expect(mapCatalogProduct(dto, 'he').brandName).toBe('Solgar')
  })

  it('falls back to the stored brand name in both languages when no Latin form is sourced', () => {
    const dto = buildDto({ brandName: 'סולגאר', brandNameEn: null })
    expect(mapCatalogProduct(dto, 'en').brandName).toBe('סולגאר')
    expect(mapCatalogProduct(dto, 'he').brandName).toBe('סולגאר')
  })
})
