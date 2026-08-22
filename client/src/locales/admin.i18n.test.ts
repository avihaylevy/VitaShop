import { describe, expect, it } from 'vitest'
import adminHe from './he/admin.json'
import adminEn from './en/admin.json'
import { validateNamespacePair, type LocaleTree } from './localeIntegrity'

/**
 * Namespace-integrity test for `admin` — added in the hundred-fifth pass
 * review, closing a standing gap: every other namespace carried the
 * validator, and this one had been growing keys (the whole product editor,
 * now `packageQuantityHint`) with no drift guard at all. An edit touching
 * one language's admin.json used to render raw keys with nothing failing.
 */

const HE = adminHe as unknown as LocaleTree
const EN = adminEn as unknown as LocaleTree

describe('admin namespace integrity', () => {
  it('the shipped he/en pair passes the full validator', () => {
    expect(validateNamespacePair(HE, EN)).toEqual([])
  })

  it('🔴 the control — a he-only key is caught', () => {
    const mutated = { ...HE, products: { ...(HE.products as LocaleTree), extraKey: 'ערך' } }
    expect(validateNamespacePair(mutated, EN)).not.toEqual([])
  })
})
