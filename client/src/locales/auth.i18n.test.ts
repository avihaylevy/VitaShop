import { describe, expect, it } from 'vitest'
import authHe from './he/auth.json'
import authEn from './en/auth.json'
import { validateNamespacePair, type LocaleTree } from './localeIntegrity'

/**
 * Namespace-integrity test for `auth` — added 2026-08-25 (the login
 * redesign review): auth was the ONE shipped namespace without the shared
 * 9-rule validator, and that same pass hand-added six keys to both locales
 * with nothing guarding them. Same shape as every sibling suite: the real
 * pair must pass, and a control proves the check can go red.
 *
 * No plural families; no placeholders — key parity is the load-bearing
 * rule.
 */

const HE = authHe as unknown as LocaleTree
const EN = authEn as unknown as LocaleTree

describe('auth namespace integrity', () => {
  it('the shipped he/en pair passes the full validator', () => {
    expect(validateNamespacePair(HE, EN)).toEqual([])
  })

  it('🔴 the control — a he-only key is caught', () => {
    const mutated = { ...HE, login: { ...(HE.login as LocaleTree), extraKey: 'ערך' } }
    expect(validateNamespacePair(mutated, EN)).not.toEqual([])
  })

  it('the login redesign keys the page renders all exist', () => {
    for (const tree of [HE, EN]) {
      const login = tree.login as Record<string, unknown>
      for (const key of ['welcomeTitle', 'welcomeBody', 'bullet1', 'bullet2', 'bullet3', 'orDivider']) {
        expect(typeof login[key], `login.${key}`).toBe('string')
      }
    }
  })
})
