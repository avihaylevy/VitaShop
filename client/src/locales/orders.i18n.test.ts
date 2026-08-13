import { describe, expect, it } from 'vitest'
import ordersHe from './he/orders.json'
import ordersEn from './en/orders.json'
import { flatten, validateNamespacePair, type LocaleTree } from './localeIntegrity'

/**
 * Namespace-integrity test for `orders` — the same tier-1 check every other
 * namespace carries (UI_IMPLEMENTATION_PLAN.md §13). The 9-rule mechanism is
 * proven by mutation in `localeIntegrity.test.ts` against a synthetic fixture;
 * this file only asserts the shipped `orders` pair is sound.
 *
 * ⚠️ Label WORDING is not checked here — that belongs with the status set it
 * describes, in `lib/orderStatus.test.ts`.
 */

const HE = ordersHe as unknown as LocaleTree
const EN = ordersEn as unknown as LocaleTree

describe('orders namespace — the shipped locale pair', () => {
  it('satisfies every rule under the shared 9-rule contract', () => {
    expect(validateNamespacePair(HE, EN)).toEqual([])
  })

  it('defines keys at all', () => {
    expect(flatten(HE).length).toBeGreaterThan(0)
    expect(flatten(EN).length).toBeGreaterThan(0)
  })

  it('carries no plurals and no placeholders — a status label is a fixed noun phrase', () => {
    for (const tree of [HE, EN]) {
      for (const [key, value] of flatten(tree)) {
        expect(key).not.toMatch(/_(zero|one|two|few|many|other)$/)
        expect(String(value)).not.toContain('{{')
      }
    }
  })
})
