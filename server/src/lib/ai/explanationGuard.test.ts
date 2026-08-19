// MILESTONE-011 Checkpoint A — Stage 3 guard tests (AI_SAFETY_RULES layer 4).

import { describe, expect, it } from 'vitest'
import type { PublicCatalogProduct } from '../catalogMapper.js'
import { guardExplanations, MAX_EXPLANATION_LENGTH } from './explanationGuard.js'

function product(overrides: Partial<PublicCatalogProduct>): PublicCatalogProduct {
  return {
    slug: 'p',
    nameHe: 'מוצר לדוגמה',
    nameEn: 'Example Product',
    categoryNameHe: 'מינרלים',
    categoryNameEn: 'Minerals',
    categorySlug: 'minerals',
    brandName: 'אלטמן',
    brandNameEn: 'Altman',
    dosageForm: 'CAPSULE',
    packageQuantity: 60,
    price: '50.00',
    stockQuantity: 10,
    lowStockThreshold: 5,
    imageFile: null,
    ...overrides,
  }
}

const retrieved = product({ nameHe: 'מגנזיום ציטראט', nameEn: 'Magnesium Citrate' })
const absentFromResults = { nameHe: 'אומגה 3 מרוכז', nameEn: 'Concentrated Omega 3' }

describe('guardExplanations', () => {
  it('passes an honest explanation through unchanged', () => {
    const result = guardExplanations({
      products: [retrieved],
      explanations: ['מגנזיום ציטראט מתאים לבקשה שלך.'],
      catalogueNames: [
        { nameHe: retrieved.nameHe, nameEn: retrieved.nameEn },
        absentFromResults,
      ],
    })
    expect(result).toEqual(['מגנזיום ציטראט מתאים לבקשה שלך.'])
  })

  it('🔴 rejects a mention of a catalogue product absent from the retrieved list', () => {
    const result = guardExplanations({
      products: [retrieved],
      explanations: ['עדיף לקנות דווקא את אומגה 3 מרוכז.'],
      catalogueNames: [
        { nameHe: retrieved.nameHe, nameEn: retrieved.nameEn },
        absentFromResults,
      ],
    })
    expect(result).toEqual([''])
  })

  it('rejects the whole batch on a count mismatch — a shifted pairing is worse than silence', () => {
    const result = guardExplanations({
      products: [retrieved, product({ slug: 'q' })],
      explanations: ['only one string'],
      catalogueNames: [],
    })
    expect(result).toEqual(['', ''])
  })

  it('truncates a runaway explanation at a word boundary with an ellipsis', () => {
    const long = 'word '.repeat(200).trim()
    const [result] = guardExplanations({
      products: [retrieved],
      explanations: [long],
      catalogueNames: [],
    })
    expect(result!.length).toBeLessThanOrEqual(MAX_EXPLANATION_LENGTH + 1)
    expect(result!.endsWith('…')).toBe(true)
  })

  it('🔴 a shorter sibling name inside a retrieved name does not blank honest prose (real-catalogue shape)', () => {
    // The live seed holds both "מגנזיום ציטראט" and "מגנזיום ציטראט 200 מ״ג".
    // Mentioning the RETRIEVED long name must not count as a mention of the
    // absent short sibling (review finding: raw includes() blanked the
    // catalogue's most common query).
    const retrievedLong = product({
      nameHe: 'מגנזיום ציטראט 200 מ"ג',
      nameEn: 'Magnesium Citrate 200 mg',
    })
    const [result] = guardExplanations({
      products: [retrievedLong],
      explanations: ['מגנזיום ציטראט 200 מ"ג מבית אלטמן, בקטגוריית מינרלים.'],
      catalogueNames: [
        { nameHe: retrievedLong.nameHe, nameEn: retrievedLong.nameEn },
        { nameHe: 'מגנזיום ציטראט', nameEn: 'Magnesium Citrate' },
      ],
    })
    expect(result).toBe('מגנזיום ציטראט 200 מ"ג מבית אלטמן, בקטגוריית מינרלים.')
  })

  it('the screen is case-insensitive on English names', () => {
    const [result] = guardExplanations({
      products: [retrieved],
      explanations: ['You should really buy CONCENTRATED OMEGA 3 instead.'],
      catalogueNames: [
        { nameHe: retrieved.nameHe, nameEn: retrieved.nameEn },
        absentFromResults,
      ],
    })
    expect(result).toBe('')
  })

  it('does not screen on names shorter than 4 characters (no accidental rejection on "C")', () => {
    const [result] = guardExplanations({
      products: [retrieved],
      explanations: ['מכיל ויטמין C לספיגה.'],
      catalogueNames: [{ nameHe: 'ב12', nameEn: 'C' }],
    })
    expect(result).toBe('מכיל ויטמין C לספיגה.')
  })
})
