import { describe, expect, it } from 'vitest'
import { isValidQuantity, minorToPriceString, parsePriceToMinor } from './money'

// The six DEC-032 verified products' real prices, from
// assets/products/products.csv — the same set formatPrice.test.ts uses.
// No invented price appears anywhere in this file.
const VERIFIED_PRICES = ['94.90', '69.90', '49.90', '84.90', '64.90', '79.90'] as const

describe('parsePriceToMinor', () => {
  it.each([
    ['94.90', 9490],
    ['69.90', 6990],
    ['49.90', 4990],
    ['84.90', 8490],
    ['64.90', 6490],
    ['79.90', 7990],
  ])('converts the real price %s to %i agorot', (price, expected) => {
    expect(parsePriceToMinor(price)).toBe(expected)
  })

  it.each([
    ['100', 10000],
    ['0', 0],
    ['0.05', 5],
    ['0.5', 50],
    ['7.5', 750],
    ['12.34', 1234],
  ])('converts %s to %i agorot', (price, expected) => {
    expect(parsePriceToMinor(price)).toBe(expected)
  })

  it('treats a single fraction digit as tenths, not hundredths', () => {
    // "7.5" is 7 shekels and 50 agorot. A naive parse would say 705 or 75.
    expect(parsePriceToMinor('7.5')).toBe(750)
  })

  it.each([
    '',
    'abc',
    '-5',
    '-0.01',
    '1e3',
    '94.900',
    ' 94.90 ',
    '94.90 ',
    'NaN',
    'Infinity',
    '.',
    '.50',
    '94.',
    '1,000.00',
    '+5.00',
    '٩٤.٩٠',
  ])('rejects %o with null rather than guessing', (price) => {
    expect(parsePriceToMinor(price)).toBeNull()
  })

  it('rejects an integer part beyond the documented 9-digit bound', () => {
    expect(parsePriceToMinor('1234567890.00')).toBeNull()
    expect(parsePriceToMinor('999999999.99')).toBe(99999999999)
  })
})

describe('minorToPriceString', () => {
  it.each(VERIFIED_PRICES)('round-trips %s losslessly', (price) => {
    const minor = parsePriceToMinor(price)
    expect(minor).not.toBeNull()
    expect(minorToPriceString(minor as number)).toBe(price)
  })

  it.each([
    [9490, '94.90'],
    [5, '0.05'],
    [50, '0.50'],
    [0, '0.00'],
    [10000, '100.00'],
  ])('formats %i agorot as %s', (minor, expected) => {
    expect(minorToPriceString(minor)).toBe(expected)
  })

  it('never drops a trailing zero', () => {
    expect(minorToPriceString(9490)).toBe('94.90')
    expect(minorToPriceString(9400)).toBe('94.00')
  })

  it('throws on a negative or non-integer amount rather than emitting nonsense', () => {
    expect(() => minorToPriceString(-1)).toThrow(RangeError)
    expect(() => minorToPriceString(1.5)).toThrow(RangeError)
    expect(() => minorToPriceString(Number.NaN)).toThrow(RangeError)
    expect(() => minorToPriceString(Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })
})

describe('integer arithmetic is exact where floating point is not', () => {
  it('sums three 0.10 units to exactly 30 agorot', () => {
    // The canonical float failure: 0.1 + 0.1 + 0.1 === 0.30000000000000004.
    expect(0.1 + 0.1 + 0.1).not.toBe(0.3)

    const unit = parsePriceToMinor('0.10') as number
    expect(unit * 3).toBe(30)
    expect(minorToPriceString(unit * 3)).toBe('0.30')
  })

  it('sums 0.10 and 0.20 to exactly 30 agorot', () => {
    expect(0.1 + 0.2).not.toBe(0.3)

    const total = (parsePriceToMinor('0.10') as number) + (parsePriceToMinor('0.20') as number)
    expect(total).toBe(30)
  })

  it('multiplies a real price by a quantity without drift', () => {
    const unit = parsePriceToMinor('94.90') as number
    expect(unit * 7).toBe(66430)
    expect(minorToPriceString(unit * 7)).toBe('664.30')
  })
})

describe('isValidQuantity', () => {
  it.each([1, 2, 999])('accepts the positive integer %i', (quantity) => {
    expect(isValidQuantity(quantity)).toBe(true)
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects %o',
    (quantity) => {
      expect(isValidQuantity(quantity)).toBe(false)
    },
  )
})
