import { describe, expect, it } from 'vitest'
import type { CartItem } from '../types/cart'
import { getCartLineCount, getCartLineDisplay, getCartLines, isCartEmpty } from './cartDisplay'

/**
 * Pure tests only — no DOM, no jsdom, no Testing Library.
 */

function item(overrides: Partial<CartItem> = {}): CartItem {
  return {
    slug: 'solgar-omega-3',
    name: 'אומגה 3',
    brandName: 'Solgar',
    imageFile: 'solgar-omega-3.jpg',
    packageQuantity: 100,
    unitPriceMinor: 9490,
    stockQuantity: 12,
    lowStockThreshold: 5,
    quantity: 2,
    ...overrides,
  }
}

describe('getCartLineDisplay', () => {
  it('carries every stored field through unchanged', () => {
    const line = getCartLineDisplay(item())

    expect(line.slug).toBe('solgar-omega-3')
    expect(line.name).toBe('אומגה 3')
    expect(line.brandName).toBe('Solgar')
    expect(line.packageQuantity).toBe(100)
    expect(line.imageFile).toBe('solgar-omega-3.jpg')
    expect(line.quantity).toBe(2)
    expect(line.maxQuantity).toBe(12)
    expect(line.lowStockThreshold).toBe(5)
  })

  it('reconstructs the canonical price string from integer agorot', () => {
    expect(getCartLineDisplay(item({ unitPriceMinor: 9490 })).unitPrice).toBe('94.90')
    expect(getCartLineDisplay(item({ unitPriceMinor: 5 })).unitPrice).toBe('0.05')
    expect(getCartLineDisplay(item({ unitPriceMinor: 10000 })).unitPrice).toBe('100.00')
  })

  it('produces no line total — the client never multiplies money for display', () => {
    const line = getCartLineDisplay(item({ unitPriceMinor: 9490, quantity: 3 }))

    // 9490 * 3 = 28470 must appear nowhere: DEC-045 as extended by the Slice 7b
    // plan permits exactly one displayed total, the reducer's own selector.
    expect(Object.keys(line)).not.toContain('lineTotal')
    expect(Object.values(line)).not.toContain('284.70')
  })

  it('omits optional fields that are absent instead of substituting a placeholder', () => {
    const line = getCartLineDisplay(item({ brandName: undefined, packageQuantity: undefined }))

    expect(line.brandName).toBeUndefined()
    expect(line.packageQuantity).toBeUndefined()
  })

  it('carries a null image through as null', () => {
    expect(getCartLineDisplay(item({ imageFile: null })).imageFile).toBeNull()
  })

  it('displays the stored name as-is, whatever language it was added in', () => {
    // D4: the snapshot is never retranslated and never replaced.
    expect(getCartLineDisplay(item({ name: 'Omega 3' })).name).toBe('Omega 3')
  })

  describe('stepper boundaries', () => {
    it('disables decrement at the minimum of 1', () => {
      const line = getCartLineDisplay(item({ quantity: 1, stockQuantity: 12 }))

      expect(line.canDecrement).toBe(false)
      expect(line.canIncrement).toBe(true)
      expect(line.atStockCap).toBe(false)
    })

    it('enables both controls between the minimum and the ceiling', () => {
      const line = getCartLineDisplay(item({ quantity: 2, stockQuantity: 12 }))

      expect(line.canDecrement).toBe(true)
      expect(line.canIncrement).toBe(true)
      expect(line.atStockCap).toBe(false)
    })

    it('disables increment at the snapshot stock ceiling', () => {
      const line = getCartLineDisplay(item({ quantity: 12, stockQuantity: 12 }))

      expect(line.canDecrement).toBe(true)
      expect(line.canIncrement).toBe(false)
      expect(line.atStockCap).toBe(true)
    })

    it('treats a single-unit stock as both the minimum and the ceiling', () => {
      const line = getCartLineDisplay(item({ quantity: 1, stockQuantity: 1 }))

      expect(line.canDecrement).toBe(false)
      expect(line.canIncrement).toBe(false)
      expect(line.atStockCap).toBe(true)
    })

    it('never invents a cap above the stored stock', () => {
      expect(getCartLineDisplay(item({ quantity: 1, stockQuantity: 3 })).maxQuantity).toBe(3)
      expect(getCartLineDisplay(item({ quantity: 1, stockQuantity: 900 })).maxQuantity).toBe(900)
    })
  })

  describe('corrupt data fails loudly instead of being repaired', () => {
    it('throws on a non-positive quantity', () => {
      expect(() => getCartLineDisplay(item({ quantity: 0 }))).toThrow(RangeError)
      expect(() => getCartLineDisplay(item({ quantity: -1 }))).toThrow(RangeError)
    })

    it('throws on a fractional quantity', () => {
      expect(() => getCartLineDisplay(item({ quantity: 1.5 }))).toThrow(RangeError)
    })

    it('throws on a non-positive or fractional stock quantity', () => {
      expect(() => getCartLineDisplay(item({ stockQuantity: 0 }))).toThrow(RangeError)
      expect(() => getCartLineDisplay(item({ stockQuantity: 2.5 }))).toThrow(RangeError)
    })

    it('throws when quantity exceeds stock, even though both values are individually valid', () => {
      // DEC-044's invariant: quantity <= stockQuantity. Corrupt state must not
      // be rendered as an at-stock-cap line.
      expect(() => getCartLineDisplay(item({ quantity: 5, stockQuantity: 3 }))).toThrow(RangeError)
      expect(() => getCartLineDisplay(item({ quantity: 2, stockQuantity: 1 }))).toThrow(RangeError)
      expect(() => getCartLineDisplay(item({ quantity: 5, stockQuantity: 3 }))).toThrow(/stock quantity/)
    })

    it('accepts the boundary where quantity equals stock, and anything below it', () => {
      expect(getCartLineDisplay(item({ quantity: 3, stockQuantity: 3 })).atStockCap).toBe(true)
      expect(getCartLineDisplay(item({ quantity: 2, stockQuantity: 3 })).atStockCap).toBe(false)
    })

    it('throws on an invalid unit price rather than formatting one', () => {
      expect(() => getCartLineDisplay(item({ unitPriceMinor: -1 }))).toThrow(RangeError)
      expect(() => getCartLineDisplay(item({ unitPriceMinor: 12.5 }))).toThrow(RangeError)
      expect(() => getCartLineDisplay(item({ unitPriceMinor: Number.NaN }))).toThrow(RangeError)
    })

    it('names only the slug in the message, never a price or a quantity', () => {
      expect(() => getCartLineDisplay(item({ slug: 'x', quantity: 0 }))).toThrow(/"x"/)
      expect(() => getCartLineDisplay(item({ slug: 'x', quantity: 0 }))).toThrow(/quantity/)
    })
  })
})

describe('getCartLines', () => {
  it('preserves order and maps every line', () => {
    const lines = getCartLines([item({ slug: 'a' }), item({ slug: 'b' }), item({ slug: 'c' })])

    expect(lines.map((line) => line.slug)).toEqual(['a', 'b', 'c'])
  })

  it('returns an empty array for an empty cart', () => {
    expect(getCartLines([])).toEqual([])
  })

  it('rejects the whole mapping when any line is corrupt', () => {
    expect(() => getCartLines([item({ slug: 'a' }), item({ slug: 'b', quantity: 0 })])).toThrow(RangeError)
  })
})

describe('isCartEmpty / getCartLineCount', () => {
  it('reports an empty cart', () => {
    expect(isCartEmpty([])).toBe(true)
    expect(getCartLineCount([])).toBe(0)
  })

  it('counts distinct lines, not units', () => {
    const items = [item({ slug: 'a', quantity: 5 }), item({ slug: 'b', quantity: 7 })]

    expect(isCartEmpty(items)).toBe(false)
    expect(getCartLineCount(items)).toBe(2)
  })
})
