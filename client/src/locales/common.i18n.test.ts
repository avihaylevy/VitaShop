import { describe, expect, it } from 'vitest'
import commonHe from './he/common.json'
import commonEn from './en/common.json'
import { valueAt, validateNamespacePair, type LocaleTree } from './localeIntegrity'

/**
 * Namespace-integrity test for `common` — Slice 10 Checkpoint C. First
 * integrity coverage this namespace has ever had (UI_IMPLEMENTATION_PLAN.md
 * §13, tier 1: "i18n key symmetry between he and en").
 *
 * Pure JSON validation via the shared `localeIntegrity.ts` validator (the
 * full 9-rule contract). Generic rule-mechanism mutation proofs are owned
 * by `localeIntegrity.test.ts` — this file keeps only what is specific to
 * `common`: the real shipped pair is sound, its confirmed-live keys stay
 * present, and `common.nav.home` (ISSUE-030 — retained, NOT authorized for
 * deletion in this checkpoint) stays byte-present.
 *
 * `health.checking` / `health.connected` / `health.disconnected` were
 * deleted from both locales this checkpoint — see the Checkpoint C
 * pre-deletion audit in `technical/UI_SLICES.md` for the static and
 * dynamic/computed `t()` usage evidence. This file asserts they are gone.
 */

const HE = commonHe as unknown as LocaleTree
const EN = commonEn as unknown as LocaleTree

describe('common namespace — the shipped locale pair', () => {
  it('satisfies every rule under the shared 9-rule contract', () => {
    expect(validateNamespacePair(HE, EN)).toEqual([])
  })

  it('confirmed-live keys remain present and non-empty in both locales', () => {
    // app.name — HomePage.tsx: t('app.name', { ns: 'common' })
    // dialog.close — Modal.tsx: t('dialog.close') (useTranslation('common'))
    for (const path of ['app.name', 'dialog.close']) {
      const heValue = valueAt(HE, path)
      const enValue = valueAt(EN, path)
      expect(typeof heValue).toBe('string')
      expect(typeof enValue).toBe('string')
      expect((heValue as string).trim()).not.toBe('')
      expect((enValue as string).trim()).not.toBe('')
    }
  })

  it('nav.home remains present and untouched (ISSUE-030 — retained, not authorized for deletion in Slice 10)', () => {
    expect(valueAt(HE, 'nav.home')).toBe('בית')
    expect(valueAt(EN, 'nav.home')).toBe('Home')
  })

  it('the deleted HealthCheck keys are gone from both locales', () => {
    for (const path of ['health.checking', 'health.connected', 'health.disconnected']) {
      expect(valueAt(HE, path)).toBeUndefined()
      expect(valueAt(EN, path)).toBeUndefined()
    }
  })

  it('no other common key was added or removed beyond the approved HealthCheck deletion', () => {
    // Exactly app, nav, dialog remain at the top level — health is gone,
    // nothing new was introduced.
    expect(Object.keys(HE).sort()).toEqual(['app', 'dialog', 'nav'])
    expect(Object.keys(EN).sort()).toEqual(['app', 'dialog', 'nav'])
  })
})
