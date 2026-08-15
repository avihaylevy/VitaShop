import { describe, expect, it } from 'vitest'
import { CLUB_DISCOUNT_PERCENT, effectiveUnitPrice } from './clubPricing.js'

const price = (value: string) => ({ toFixed: () => value })

describe('effectiveUnitPrice — DEC-086, the one club-pricing rule', () => {
  it('a non-member pays the stored price byte-for-byte', () => {
    expect(effectiveUnitPrice(price('94.90'), false)).toBe('94.90')
    expect(effectiveUnitPrice(price('0.05'), false)).toBe('0.05')
  })

  it('a member pays 10% less, rounded to the agora half-up', () => {
    // 94.90 -> 9490 agorot -> 8541 -> 85.41
    expect(effectiveUnitPrice(price('94.90'), true)).toBe('85.41')
    // 68.03 -> 6803 -> 6122.7 -> 6123 -> 61.23
    expect(effectiveUnitPrice(price('68.03'), true)).toBe('61.23')
    // A round figure stays clean: 150.00 -> 135.00
    expect(effectiveUnitPrice(price('150.00'), true)).toBe('135.00')
  })

  it('the output is always a canonical two-decimal string', () => {
    expect(effectiveUnitPrice(price('10.00'), true)).toBe('9.00')
    expect(effectiveUnitPrice(price('0.05'), true)).toBe('0.05') // 5 -> 4.5 -> 5 (half-up)
  })

  it('🔴 the rate constant is what the arithmetic actually uses — not a stale label', () => {
    // Mutation guard: change CLUB_DISCOUNT_PERCENT and this recomputes; change
    // only the arithmetic and this goes red.
    const agorot = 10_000
    const expected = ((Math.round((agorot * (100 - CLUB_DISCOUNT_PERCENT)) / 100)) / 100).toFixed(2)
    expect(effectiveUnitPrice(price('100.00'), true)).toBe(expected)
  })
})
