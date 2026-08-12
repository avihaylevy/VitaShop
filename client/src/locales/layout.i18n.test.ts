import { describe, expect, it } from 'vitest'
import layoutHe from './he/layout.json'
import layoutEn from './en/layout.json'
import { indexKeys, valueAt, validateNamespacePair, type LocaleTree } from './localeIntegrity'
import { NAV_ITEMS } from '../components/layout/navItems'

/**
 * Namespace-integrity test for `layout` — Slice 10 Checkpoint C. First
 * integrity coverage this namespace has ever had.
 *
 * Pure JSON validation via the shared `localeIntegrity.ts` validator (the
 * full 9-rule contract). Generic rule-mechanism mutation proofs are owned
 * by `localeIntegrity.test.ts` — this file keeps only what is specific to
 * `layout`: the real shipped pair is sound, its plural contracts, and the
 * keys reached only through DYNAMIC/COMPUTED `t()` calls — which a static
 * "is this key referenced" grep would call unused and a future prune could
 * delete on that false reading:
 *
 *   client/src/components/layout/UtilityCluster.tsx:36 —
 *     t(`language.${next}` as const)
 *   client/src/components/layout/MobileMenu.tsx:94 —
 *     t(`language.${next}` as const)
 *   client/src/components/layout/Header.tsx:47 — t(`nav.${item.key}`)
 *   client/src/components/layout/MobileMenu.tsx:81 — t(`nav.${item.key}`)
 *
 * `next` is a language code ('he'/'en'); `item.key` iterates `navItems.ts`.
 * Asserted present below, not just by the validator's key-parity check (which
 * cannot know these particular keys are load-bearing).
 *
 * 🔴 THE NAV KEYS ARE DERIVED FROM `NAV_ITEMS`, NOT RETYPED. This file used to
 * hardcode `['home','catalog','sales','about','contact']` — a second copy of a
 * list that already existed, and therefore a list that could disagree with it.
 * ISSUE-066 made the disagreement real: three of those items pointed at routes
 * that did not exist, and when they were deleted this test still demanded their
 * translations, so the orphaned keys would have been kept to satisfy it.
 * Importing the real list means adding or removing a nav item updates this
 * assertion by construction.
 */

const HE = layoutHe as unknown as LocaleTree
const EN = layoutEn as unknown as LocaleTree

describe('layout namespace — the shipped locale pair', () => {
  it('satisfies every rule under the shared 9-rule contract', () => {
    expect(validateNamespacePair(HE, EN)).toEqual([])
  })

  it('the dynamically-referenced language.he / language.en keys remain present (UtilityCluster.tsx, MobileMenu.tsx)', () => {
    for (const path of ['language.he', 'language.en']) {
      const heValue = valueAt(HE, path)
      const enValue = valueAt(EN, path)
      expect(typeof heValue).toBe('string')
      expect(typeof enValue).toBe('string')
      expect((heValue as string).trim()).not.toBe('')
      expect((enValue as string).trim()).not.toBe('')
    }
  })

  it('every nav.* key reachable via t(`nav.${item.key}`) (Header.tsx, MobileMenu.tsx) remains present, matching navItems.ts', () => {
    // Derived from the SAME array the components iterate — see the header note.
    expect(NAV_ITEMS.length).toBeGreaterThan(0)
    for (const key of NAV_ITEMS.map((item) => item.key)) {
      const path = `nav.${key}`
      const heValue = valueAt(HE, path)
      const enValue = valueAt(EN, path)
      expect(typeof heValue).toBe('string')
      expect(typeof enValue).toBe('string')
      expect((heValue as string).trim()).not.toBe('')
      expect((enValue as string).trim()).not.toBe('')
    }
  })

  it('favourites.ariaLabelWithCount is a legitimately non-plural key on both sides (UtilityCluster.tsx interpolates {{count}} without CLDR pluralisation)', () => {
    const he = indexKeys(HE).get('favourites.ariaLabelWithCount')!
    const en = indexKeys(EN).get('favourites.ariaLabelWithCount')!
    expect(he.hasBareKey).toBe(true)
    expect(he.categories.size).toBe(0)
    expect(en.hasBareKey).toBe(true)
    expect(en.categories.size).toBe(0)
  })

  it('cart.ariaLabelWithCount requires exactly the four Hebrew and two English plural categories', () => {
    const he = indexKeys(HE).get('cart.ariaLabelWithCount')!
    const en = indexKeys(EN).get('cart.ariaLabelWithCount')!

    expect([...he.categories].sort()).toEqual(['many', 'one', 'other', 'two'])
    expect([...en.categories].sort()).toEqual(['one', 'other'])
    expect(he.hasBareKey).toBe(false)
    expect(en.hasBareKey).toBe(false)
  })
})
