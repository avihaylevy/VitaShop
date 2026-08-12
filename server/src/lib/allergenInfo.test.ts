import { describe, expect, it } from 'vitest'
import { parseAllergenInfoIncomplete, validateAllergenFields } from './allergenInfo.js'

/**
 * DEC-032 DECISION B. These tests exist because the flag is a MEDICAL
 * provenance claim: if it silently defaults to false, a row whose allergen
 * data was never published renders identically to one whose data is complete.
 *
 * 🔴 Both controls, per `.claude/rules/browser-verification.md`: every legal
 * combination is asserted to PASS and every illegal one to THROW. A test that
 * only checked the rejections would pass against a function that rejects
 * everything.
 */
describe('parseAllergenInfoIncomplete', () => {
  it('accepts the three legal spellings, case-insensitively', () => {
    expect(parseAllergenInfoIncomplete('', 'x')).toBe(false)
    expect(parseAllergenInfoIncomplete(undefined, 'x')).toBe(false)
    expect(parseAllergenInfoIncomplete('no', 'x')).toBe(false)
    expect(parseAllergenInfoIncomplete(' NO ', 'x')).toBe(false)
    expect(parseAllergenInfoIncomplete('yes', 'x')).toBe(true)
    expect(parseAllergenInfoIncomplete(' YES ', 'x')).toBe(true)
  })

  it('🔴 throws on anything else rather than coercing it to false', () => {
    for (const bad of ['true', '1', 'y', 'כן', 'maybe', 'YES!', 'no ']) {
      // 'no ' is legal after trim, so it is excluded from the throwing set
      if (bad.trim().toLowerCase() === 'no') continue
      expect(() => parseAllergenInfoIncomplete(bad, 'some-slug')).toThrow(/allergen_info_incomplete/)
    }
  })

  it('names the offending row, so a seed failure points at one slug', () => {
    expect(() => parseAllergenInfoIncomplete('true', 'salus-multi-syrup')).toThrow(/salus-multi-syrup/)
  })
})

describe('validateAllergenFields — the four (flag, text) states', () => {
  it('false + text: a declaration. Accepted, text trimmed', () => {
    expect(validateAllergenFields({ warnings_allergens: '  מכיל דגים  ' }, 'x')).toEqual({
      warningsAllergens: 'מכיל דגים',
      allergenInfoIncomplete: false,
    })
  })

  it('🔴 false + empty: REJECTED — this is the pre-existing confirm-or-omit rule, unchanged', () => {
    expect(() => validateAllergenFields({ warnings_allergens: '' }, 'x')).toThrow(/warnings_allergens" is empty/)
    expect(() => validateAllergenFields({ warnings_allergens: '   ' }, 'x')).toThrow(/warnings_allergens" is empty/)
  })

  it('true + empty: accepted — the manufacturer publishes nothing, and that was CHECKED', () => {
    expect(
      validateAllergenFields({ warnings_allergens: '', allergen_info_incomplete: 'yes' }, 'x'),
    ).toEqual({ warningsAllergens: '', allergenInfoIncomplete: true })
  })

  it('true + text: accepted — partial, and that is all there is (the salus-multi-syrup shape)', () => {
    expect(
      validateAllergenFields(
        {
          warnings_allergens: 'המוצר ללא גלוטן וללא אלכוהול.',
          allergen_info_incomplete: 'yes',
        },
        'salus-multi-syrup',
      ),
    ).toEqual({
      warningsAllergens: 'המוצר ללא גלוטן וללא אלכוהול.',
      allergenInfoIncomplete: true,
    })
  })

  it('🔴 the flag is the ONLY thing that makes an empty field legal', () => {
    const empty = { warnings_allergens: '' }
    expect(() => validateAllergenFields(empty, 'x')).toThrow()
    expect(() => validateAllergenFields({ ...empty, allergen_info_incomplete: 'no' }, 'x')).toThrow()
    expect(validateAllergenFields({ ...empty, allergen_info_incomplete: 'yes' }, 'x').allergenInfoIncomplete).toBe(true)
  })

  it('the empty-field error tells the reader what the flag actually means', () => {
    expect(() => validateAllergenFields({ warnings_allergens: '' }, 'x')).toThrow(/CHECKED and publishes none/)
  })
})
