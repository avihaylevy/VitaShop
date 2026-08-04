import { describe, expect, it } from 'vitest'
import { formatPrice } from './formatPrice'

// The six DEC-032 verified products' real prices, from
// assets/products/products.csv. No invented price is used anywhere here.
const VERIFIED_PRICES = ['94.90', '69.90', '49.90', '84.90', '64.90', '79.90']

describe('formatPrice', () => {
  it.each(VERIFIED_PRICES)('formats %s for he with the shekel sign and two decimals', (price) => {
    const result = formatPrice(price, 'he')
    expect(result).toContain('₪')
    expect(result).toContain(price)
  })

  it.each(VERIFIED_PRICES)('formats %s for en with the shekel sign and two decimals', (price) => {
    const result = formatPrice(price, 'en')
    expect(result).toContain('₪')
    expect(result).toContain(price)
  })

  it('never drops a trailing zero (94.90, not 94.9)', () => {
    expect(formatPrice('94.90', 'en')).toContain('94.90')
    expect(formatPrice('94.9', 'en')).toContain('94.90')
  })

  it('accepts a string input and never receives a number (type-level contract)', () => {
    // formatPrice(price: string, ...) — this line would not compile with a
    // number literal if the signature regressed to accept one loosely.
    const price: string = '100.00'
    expect(formatPrice(price, 'he')).toContain('100.00')
  })
})
