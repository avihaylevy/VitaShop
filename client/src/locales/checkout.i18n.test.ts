import { describe, expect, it } from 'vitest'
import checkoutHe from './he/checkout.json'
import checkoutEn from './en/checkout.json'
import { flatten, validateNamespacePair, type LocaleTree } from './localeIntegrity'
import { DELIVERY_METHOD_NAMES, UNPURCHASABLE_REASONS } from '../types/checkout'

/**
 * Namespace integrity for `checkout`, plus the two key sets this namespace
 * must cover COMPLETELY: every delivery method, and every reason a line can be
 * blocked. A missing one renders the raw key to a shopper mid-payment.
 */

const HE = checkoutHe as unknown as LocaleTree
const EN = checkoutEn as unknown as LocaleTree

describe('checkout namespace — the shipped locale pair', () => {
  it('satisfies every rule under the shared 9-rule contract', () => {
    expect(validateNamespacePair(HE, EN)).toEqual([])
  })

  it('defines keys at all', () => {
    expect(flatten(HE).length).toBeGreaterThan(0)
  })
})

describe('coverage of the two closed sets', () => {
  it.each(DELIVERY_METHOD_NAMES)('names %s in both languages', (method) => {
    expect(typeof (checkoutHe.delivery as Record<string, unknown>)[method]).toBe('string')
    expect(typeof (checkoutEn.delivery as Record<string, unknown>)[method]).toBe('string')
  })

  /**
   * 🔴 THE RIGHT INSTINCT, THE WRONG LIST — and that is the lesson. This
   * hardcoded INACTIVE / OUT_OF_STOCK / SHORT_STOCK, names the server never
   * emits, so it confirmed the JSON matched a fiction and went green against a
   * checkout screen that rendered an empty blocked list.
   *
   * It now iterates `UNPURCHASABLE_REASONS`, which `checkoutApi.test.ts` holds
   * against the server's own source with a `?raw` read. Not `Object.keys` of
   * the locale file — iterating the file to check the file proves nothing.
   */
  it.each([...UNPURCHASABLE_REASONS])('explains a %s line', (reason) => {
    expect(typeof (checkoutHe.blocked as Record<string, unknown>)[reason]).toBe('string')
    expect(typeof (checkoutEn.blocked as Record<string, unknown>)[reason]).toBe('string')
  })

  it('SHORT_STOCK interpolates the number in both languages', () => {
    expect(String((checkoutHe.blocked as Record<string, string>).SHORT_STOCK)).toContain('{{available}}')
    expect(String((checkoutEn.blocked as Record<string, string>).SHORT_STOCK)).toContain('{{available}}')
  })
})
