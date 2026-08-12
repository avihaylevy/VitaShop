import { describe, expect, it } from 'vitest'
import {
  computeShipping,
  toAgorot,
  FREE_SHIPPING_THRESHOLD_AGOROT,
  SHIPPING_FLAT_RATE_AGOROT,
} from './shipping.js'

/**
 * DEC-058 — ₪30 flat, free at ₪249 or more.
 *
 * 🔴 THESE TEST THE EDGES, NOT THE MIDDLE. A cart of ₪100 proves nothing
 * interesting; the boundary is where an off-by-one lives, and "nothing to
 * ship" is where a rule about numbers gets mistaken for a rule about
 * deliveries.
 */

const THRESHOLD = FREE_SHIPPING_THRESHOLD_AGOROT // 24_900
const FLAT = SHIPPING_FLAT_RATE_AGOROT // 3_000

describe('🔴 the ₪249 boundary', () => {
  it('one agora BELOW the threshold is charged', () => {
    const result = computeShipping(THRESHOLD - 1, true)
    expect(result.isFree).toBe(false)
    expect(result.cost).toBe('30.00')
    expect(result.remainingForFree).toBe('0.01')
  })

  it('🔴 EXACTLY ₪249 is FREE — "₪249 or more", so the boundary is inclusive', () => {
    const result = computeShipping(THRESHOLD, true)
    expect(result.isFree).toBe(true)
    expect(result.cost).toBe('0.00')
    expect(result.remainingForFree).toBe('0.00')
    expect(result.basis).toBe('249.00')
  })

  it('one agora ABOVE the threshold is free', () => {
    expect(computeShipping(THRESHOLD + 1, true).isFree).toBe(true)
  })

  it('the threshold is REPORTED, so the UI states the rule without hardcoding it', () => {
    expect(computeShipping(1000, true).threshold).toBe('249.00')
  })
})

describe('🔴 nothing to ship means no charge — not ₪30, not "free"', () => {
  it('an EMPTY cart', () => {
    const result = computeShipping(0, false)
    expect(result.cost).toBe('0.00')
    expect(result.hasShippableLines).toBe(false)
    // 🔴 NOT free either. Free shipping is a promise about an ORDER, and there
    // is no order for one to be about.
    expect(result.isFree).toBe(false)
    expect(result.remainingForFree).toBe('0.00')
  })

  it('🔴 a cart whose every line is WITHDRAWN — basis 0 even though the subtotal is not', () => {
    // The displayed subtotal still shows those lines (C3, unchanged). The
    // shipping basis does not, which is the whole point of the distinction.
    const result = computeShipping(0, false)
    expect(result.basis).toBe('0.00')
    expect(result.cost).toBe('0.00')
    expect(result.hasShippableLines).toBe(false)
  })

  it('a cart with ONE agora of active goods IS shippable, and charged', () => {
    // The boundary between "nothing to ship" and "something to ship" is
    // existence, never amount.
    const result = computeShipping(1, true)
    expect(result.hasShippableLines).toBe(true)
    expect(result.cost).toBe('30.00')
  })
})

describe('🔴 the free-shipping promise never appears on an unplaceable order', () => {
  it('₪260 of goods of which only ₪200 is active is NOT free', () => {
    // 20000 is the ACTIVE total; the 6000 withdrawn line is excluded by the
    // caller. If this ever reports free, the shopper is promised something on
    // a cart that cannot check out — and the promise REVERSES the moment they
    // remove the blocked line, taking ₪260 to ₪200 and free to ₪30.
    const result = computeShipping(20_000, true)
    expect(result.isFree).toBe(false)
    expect(result.cost).toBe('30.00')
    expect(result.basis).toBe('200.00')
    expect(result.remainingForFree).toBe('49.00')
  })
})

describe('remainingForFree — the figure the UI would otherwise compute itself', () => {
  it('is the exact gap, so no client subtracts money', () => {
    expect(computeShipping(20_000, true).remainingForFree).toBe('49.00')
    expect(computeShipping(24_899, true).remainingForFree).toBe('0.01')
  })

  it('is 0.00 once free, never negative', () => {
    expect(computeShipping(50_000, true).remainingForFree).toBe('0.00')
  })
})

describe('🔴 agorot, not floats — the boundary must not ride on 0.1 + 0.2', () => {
  it('toAgorot survives the values that break naive multiplication', () => {
    expect(toAgorot('249.00')).toBe(24_900)
    expect(toAgorot('94.90')).toBe(9_490)
    expect(toAgorot('0.29')).toBe(29)
    // 🔴 0.29 and 1.15 are the classic float casualties: `0.29 * 100` is
    // 28.999999999999996 and `1.15 * 100` is 114.99999999999999. Truncating
    // would lose an agora on each; rounding is what makes them exact.
    expect(toAgorot('1.15')).toBe(115)
  })

  it('🔴 EVERY two-decimal value round-trips exactly — swept, not sampled', () => {
    // ⚠️ An earlier version of this test asserted `toAgorot('1.005') === 101`.
    // That was the TEST being wrong, not the code: `1.005 * 100` is
    // 100.49999999999999, so it rounds to 100. The assertion was also
    // meaningless — a THREE-decimal money string cannot occur here. Every
    // money value in this system is produced by `toFixed(2)` and validated by
    // `/^\d+\.\d{2}$/`. So the real invariant is the two-decimal domain,
    // and it is swept rather than spot-checked.
    for (let agorot = 0; agorot <= 30_000; agorot += 1) {
      const money = (agorot / 100).toFixed(2)
      if (toAgorot(money) !== agorot) {
        throw new Error(`round-trip lost a value: ${money} -> ${toAgorot(money)}, expected ${agorot}`)
      }
    }
    expect(true).toBe(true)
  })

  it('a basis summed from awkward line totals still lands exactly on the boundary', () => {
    // 3 x 83.00 = 249.00 exactly. Under float arithmetic this is the kind of
    // sum that arrives as 248.99999999999997 and silently loses free shipping.
    const basis = ['83.00', '83.00', '83.00'].reduce((sum, m) => sum + toAgorot(m), 0)
    expect(basis).toBe(24_900)
    expect(computeShipping(basis, true).isFree).toBe(true)
  })
})

describe('the two numbers have ONE definition', () => {
  it('DEC-058 exactly: ₪30 and ₪249', () => {
    // If MILESTONE-008 ever retypes these, this is the test that should have
    // stopped it — the constants are exported for checkout to import.
    expect(FLAT).toBe(3_000)
    expect(THRESHOLD).toBe(24_900)
  })
})
