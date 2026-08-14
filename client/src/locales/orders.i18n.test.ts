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

  it('🔴 no STATUS label carries a plural or a placeholder — it is a fixed noun phrase', () => {
    /*
     * ⚠️ SCOPED TO `status.*` AT CHECKPOINT G2, and the narrowing is the point
     * rather than a loosening. This assertion swept the WHOLE namespace when
     * the namespace held nothing but the six §4.5.7 labels, so "every key" and
     * "every status label" were the same set. G2 added `history.*`, which
     * legitimately interpolates a date and an order number and legitimately
     * pluralises a unit count — and the sweep went red.
     *
     * 🔴 THE RULE IT ENCODES IS ABOUT STATUS LABELS: §4.5.7 names them as fixed
     * noun phrases, and a label that interpolates is a label whose wording
     * depends on data the status does not carry. That still holds, and is still
     * checked — over exactly the keys it was written about.
     */
    for (const tree of [HE, EN]) {
      const statuses = flatten(tree).filter(([key]) => key.startsWith('status.'))
      // The control: a filter that matched nothing would assert nothing.
      expect(statuses.length).toBeGreaterThan(0)
      for (const [key, value] of statuses) {
        expect(key).not.toMatch(/_(zero|one|two|few|many|other)$/)
        expect(String(value)).not.toContain('{{')
      }
    }
  })

  it('the history keys DO interpolate, which is why the sweep above is scoped', () => {
    // Stated as a positive so the scoping cannot quietly become vacuous: if
    // `history.*` ever stops interpolating, this fails and the narrower sweep
    // above should be widened back.
    const placeholders = flatten(EN).filter(
      ([key, value]) => key.startsWith('history.') && String(value).includes('{{'),
    )
    expect(placeholders.length).toBeGreaterThan(0)
  })
})
