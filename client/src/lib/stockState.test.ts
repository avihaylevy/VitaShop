import { describe, expect, it } from 'vitest'
import { getStockState } from './stockState'

describe('getStockState', () => {
  it('returns "out" at zero stock', () => {
    expect(getStockState(0, 5)).toBe('out')
  })

  it('returns "out" below zero (defensive — should never happen upstream)', () => {
    expect(getStockState(-1, 5)).toBe('out')
  })

  it('returns "low" for 1 through the threshold', () => {
    expect(getStockState(1, 5)).toBe('low')
    expect(getStockState(5, 5)).toBe('low')
  })

  it('returns "in" one above the threshold', () => {
    expect(getStockState(6, 5)).toBe('in')
  })

  it('returns "in" for all six DEC-032 verified products (stock 50-100, threshold 5)', () => {
    const verifiedStockLevels = [60, 80, 100, 50, 70, 65]
    for (const stock of verifiedStockLevels) {
      expect(getStockState(stock, 5)).toBe('in')
    }
  })
})
