import { describe, expect, it } from 'vitest'
import agentHe from './he/agent.json'
import agentEn from './en/agent.json'
import { flatten, validateNamespacePair, type LocaleTree } from './localeIntegrity'

/**
 * Namespace-integrity test for `agent` — MILESTONE-011 Checkpoint C review
 * finding: `agent` was the only shipped namespace with NO integrity suite,
 * so its key symmetry was sound by fixture, not by contract. Same shape as
 * cart.i18n.test.ts: the shared 9-rule validator over the real shipped
 * pair (the rule-mechanism mutation proofs live in localeIntegrity.test.ts).
 */

const HE = agentHe as unknown as LocaleTree
const EN = agentEn as unknown as LocaleTree

describe('agent namespace locale integrity', () => {
  it('the shipped he/en pair reports zero violations', () => {
    expect(validateNamespacePair(HE, EN)).toEqual([])
  })

  it('the namespace is entirely plural-free (no key carries CLDR suffixes)', () => {
    // Every agent string is a fixed sentence; a plural sneaking in should
    // be a deliberate change to this pin, not an accident.
    const keys = [...Object.keys(flatten(HE)), ...Object.keys(flatten(EN))]
    expect(keys.some((key) => /_(one|two|many|other)$/.test(key))).toBe(false)
  })
})
