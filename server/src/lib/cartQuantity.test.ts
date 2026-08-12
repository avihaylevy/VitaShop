import { describe, expect, it } from 'vitest'
import {
  CART_LINE_MAX,
  clampAddition,
  clampCartQuantity,
  parseRequestedQuantity,
} from './cartQuantity.js'

/**
 * 🔴 THE CLAMP IS WHERE THE BUG LIVES, so both bounds are tested SEPARATELY and
 * then TOGETHER. A one-sided clamp passes a test suite that only ever exercises
 * one of them — the shape that produced this project's ratio test which passed
 * while the timing was backwards, and its join test which passed with the join
 * deleted.
 */

describe('clampCartQuantity — both bounds, independently and together', () => {
  it('the CAP binds: 11 against stock 50 -> 10', () => {
    const result = clampCartQuantity(11, 50)
    expect(result).toEqual({ ok: true, quantity: 10, clampedByCap: true, clampedByStock: false })
  })

  it('STOCK binds: 5 against stock 3 -> 3 (probiotic-intense is seeded at 3)', () => {
    const result = clampCartQuantity(5, 3)
    expect(result).toEqual({ ok: true, quantity: 3, clampedByCap: false, clampedByStock: true })
  })

  it('🔴 BOTH bind at once: 11 against stock 3 -> 3 — the case a one-sided clamp passes', () => {
    const result = clampCartQuantity(11, 3)
    expect(result).toEqual({ ok: true, quantity: 3, clampedByCap: true, clampedByStock: true })
  })

  it('neither binds: 2 against stock 50 -> 2, and nothing claims to have clamped', () => {
    expect(clampCartQuantity(2, 50)).toEqual({
      ok: true, quantity: 2, clampedByCap: false, clampedByStock: false,
    })
  })

  it('the boundaries themselves do not clamp — 10 against 50, and 4 against 4 (biotin)', () => {
    const atCap = clampCartQuantity(CART_LINE_MAX, 50)
    expect(atCap.ok && atCap.quantity).toBe(10)
    expect(clampCartQuantity(4, 4)).toEqual({
      ok: true, quantity: 4, clampedByCap: false, clampedByStock: false,
    })
  })

  it('OUT OF STOCK is REJECTED, not added at 0 (altman-fenugreek-chromium-90 is seeded at 0)', () => {
    expect(clampCartQuantity(1, 0)).toEqual({ ok: false, reason: 'OUT_OF_STOCK' })
    expect(clampCartQuantity(1, -1)).toEqual({ ok: false, reason: 'OUT_OF_STOCK' })
  })

  it('the cap is 10 — pinned, because C2 chose a number and code should say which', () => {
    expect(CART_LINE_MAX).toBe(10)
  })
})

describe('parseRequestedQuantity — rejects, never coerces', () => {
  it('accepts a positive integer', () => {
    expect(parseRequestedQuantity(3)).toBe(3)
  })

  it('rejects 0, negatives and fractions', () => {
    expect(parseRequestedQuantity(0)).toBe('NOT_POSITIVE')
    expect(parseRequestedQuantity(-2)).toBe('NOT_POSITIVE')
    expect(parseRequestedQuantity(1.5)).toBe('NOT_AN_INTEGER')
  })

  it('🔴 rejects a STRING rather than coercing it — "3" means a broken client', () => {
    expect(parseRequestedQuantity('3')).toBe('NOT_AN_INTEGER')
    expect(parseRequestedQuantity('')).toBe('NOT_AN_INTEGER')
  })

  it('rejects absent, null, NaN, Infinity and objects', () => {
    for (const bad of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY, {}, []]) {
      expect(parseRequestedQuantity(bad)).toBe('NOT_AN_INTEGER')
    }
  })
})

describe('clampAddition — the SUM clamps, not just the request', () => {
  it('adding the same product twice SUMS', () => {
    const summed = clampAddition(2, 3, 50)
    expect(summed.ok && summed.quantity).toBe(5)
  })

  it('🔴 a cap enforced per-REQUEST is not a cap: 9 + 5 against stock 50 -> 10', () => {
    const result = clampAddition(9, 5, 50)
    expect(result).toEqual({ ok: true, quantity: 10, clampedByCap: true, clampedByStock: false })
  })

  it('🔴 ten one-unit adds against stock 3 land on 3, not 10', () => {
    let quantity = 0
    for (let i = 0; i < 10; i += 1) {
      const result = clampAddition(quantity, 1, 3)
      if (result.ok) quantity = result.quantity
    }
    expect(quantity).toBe(3)
  })
})
