import { describe, expect, it } from 'vitest'
import clubHe from './he/club.json'
import clubEn from './en/club.json'
import { validateNamespacePair, type LocaleTree } from './localeIntegrity'

/**
 * Namespace-integrity test for `club` (MILESTONE-012 Checkpoint B,
 * 2026-08-15) — added WITH the namespace, per the drift-guard rule: a new
 * namespace never lives a day without the validator and its control.
 *
 * No plural families; no placeholders yet — key parity is the load-bearing
 * rule.
 */

const HE = clubHe as unknown as LocaleTree
const EN = clubEn as unknown as LocaleTree

describe('club namespace integrity', () => {
  it('the shipped he/en pair passes the full validator', () => {
    expect(validateNamespacePair(HE, EN)).toEqual([])
  })

  it('🔴 the control — a he-only key is caught', () => {
    const mutated = { ...HE, page: { ...(HE.page as LocaleTree), extraKey: 'ערך' } }
    expect(validateNamespacePair(mutated, EN)).not.toEqual([])
  })
})
