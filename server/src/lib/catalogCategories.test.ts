import { describe, expect, it } from 'vitest'
import { CANONICAL_CATEGORIES, findCanonicalCategoryByNameHe } from './catalogCategories.js'

describe('CANONICAL_CATEGORIES', () => {
  it('has exactly the six REQ-F-001 categories, in spec order', () => {
    expect(CANONICAL_CATEGORIES.map((c) => c.nameHe)).toEqual([
      'ויטמינים',
      'מינרלים',
      'אומגה ושומנים',
      'חלבונים ואבקות',
      'פרוביוטיקה',
      'צמחי מרפא',
    ])
  })

  it('has a unique, non-empty slug for every category', () => {
    const slugs = CANONICAL_CATEGORIES.map((c) => c.slug)
    expect(slugs.every((slug) => slug.length > 0)).toBe(true)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('has a non-empty nameEn for every category', () => {
    expect(CANONICAL_CATEGORIES.every((c) => c.nameEn.length > 0)).toBe(true)
  })
})

describe('findCanonicalCategoryByNameHe', () => {
  it('returns the matching entry for a known nameHe', () => {
    const result = findCanonicalCategoryByNameHe('אומגה ושומנים')
    expect(result).toEqual({ nameHe: 'אומגה ושומנים', nameEn: 'Omega & Fats', slug: 'omega-fats' })
  })

  it('returns undefined for an unknown nameHe', () => {
    expect(findCanonicalCategoryByNameHe('קטגוריה לא קיימת')).toBeUndefined()
  })

  it('returns undefined for an empty string', () => {
    expect(findCanonicalCategoryByNameHe('')).toBeUndefined()
  })
})
