import { describe, expect, it } from 'vitest'
import cartHe from './he/cart.json'
import cartEn from './en/cart.json'
import { flatten, indexKeys, validateNamespacePair, type LocaleTree } from './localeIntegrity'

/**
 * Namespace-integrity test for `cart` — UI_IMPLEMENTATION_PLAN.md §13, tier 1:
 * "i18n key symmetry between he and en — catches the classic drift".
 *
 * Pure JSON validation via the shared `localeIntegrity.ts` validator (the
 * full 9-rule contract, Slice 10 Checkpoint B). The generic rule-mechanism
 * mutation proofs now live in `localeIntegrity.test.ts`, proven against a
 * synthetic fixture — this file keeps only what is specific to the `cart`
 * namespace: that the real shipped pair is sound, and cart's own plural/
 * category shape.
 */

const HE = cartHe as unknown as LocaleTree
const EN = cartEn as unknown as LocaleTree

describe('cart namespace — the shipped locale pair', () => {
  it('satisfies every rule under the shared 9-rule contract', () => {
    expect(validateNamespacePair(HE, EN)).toEqual([])
  })

  it('defines keys at all', () => {
    expect(flatten(HE).length).toBeGreaterThan(0)
    expect(flatten(EN).length).toBeGreaterThan(0)
  })

  it('requires exactly the four Hebrew and two English plural categories for page.summary', () => {
    const he = indexKeys(HE).get('page.summary')!
    const en = indexKeys(EN).get('page.summary')!

    expect([...he.categories].sort()).toEqual(['many', 'one', 'other', 'two'])
    expect([...en.categories].sort()).toEqual(['one', 'other'])
    expect(he.hasBareKey).toBe(false)
    expect(en.hasBareKey).toBe(false)
  })
})
