import { describe, expect, it } from 'vitest'
import accountHe from './he/account.json'
import accountEn from './en/account.json'
import { validateNamespacePair, type LocaleTree } from './localeIntegrity'

/**
 * Namespace-integrity test for `account` (MILESTONE-009, 2026-08-16) —
 * added WITH the namespace, per the drift-guard rule: a new namespace
 * never lives a day without the validator and its control.
 *
 * This namespace interpolates `{{cap}}` (addresses.intro, capReached) —
 * placeholder parity is load-bearing here, not just key parity.
 */

const HE = accountHe as unknown as LocaleTree
const EN = accountEn as unknown as LocaleTree

describe('account namespace integrity', () => {
  it('the shipped he/en pair passes the full validator', () => {
    expect(validateNamespacePair(HE, EN)).toEqual([])
  })

  it('🔴 the control — a he-only key is caught', () => {
    const mutated = { ...HE, details: { ...(HE.details as LocaleTree), extraKey: 'ערך' } }
    expect(validateNamespacePair(mutated, EN)).not.toEqual([])
  })
})
