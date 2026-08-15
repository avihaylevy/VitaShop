import { describe, expect, it } from 'vitest'
import infoHe from './he/info.json'
import infoEn from './en/info.json'
import { validateNamespacePair, type LocaleTree } from './localeIntegrity'

/**
 * Namespace-integrity test for `info` (ISSUE-119 About + ISSUE-125 Contact,
 * 2026-08-15) — added WITH the namespace, so it never lives a day without
 * the 9-rule contract the other namespaces carry (review of this diff: a
 * he-only key would have rendered raw key text on the English page with
 * every suite green).
 *
 * No plural families and no placeholders in this namespace yet — the
 * validator's key-parity rule is the load-bearing one.
 */

const HE = infoHe as unknown as LocaleTree
const EN = infoEn as unknown as LocaleTree

describe('info namespace integrity', () => {
  it('the shipped he/en pair passes the full validator', () => {
    expect(validateNamespacePair(HE, EN)).toEqual([])
  })

  it('🔴 the control — a he-only key is caught', () => {
    const mutated = { ...HE, about: { ...(HE.about as LocaleTree), extraKey: 'ערך' } }
    expect(validateNamespacePair(mutated, EN)).not.toEqual([])
  })
})
