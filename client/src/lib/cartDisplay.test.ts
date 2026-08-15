import { describe, expect, it } from 'vitest'
import type { CartLine } from '../types/cart'
import { toCartLineDisplay } from './cartDisplay'

/**
 * ISSUE-080 — the row's unpurchasability signal.
 *
 * Until MILESTONE-008 Checkpoint F1 the only signal was `!isActive`, and
 * nothing rendered from `quantity > stockQuantity` — the condition the SERVER
 * blocks on. This file covers the discriminant that replaced it.
 */

function line(overrides: Partial<CartLine> = {}): CartLine {
  return {
    id: 'line-1',
    productId: 'product-1',
    slug: 'fixture-product',
    nameHe: 'מוצר',
    nameEn: 'Product',
    brandName: 'Brand',
    brandNameEn: null,
    packageQuantity: 60,
    imageFile: null,
    quantity: 1,
    unitPrice: '95.00',
    lineTotal: '95.00',
    isActive: true,
    stockQuantity: 10,
    lowStockThreshold: 3,
    ...overrides,
  } as CartLine
}

describe('DEC-085 — the brand reads Latin-first in BOTH languages (amends ISSUE-129)', () => {
  const bilingual = () => line({ brandName: 'סולגאר', brandNameEn: 'Solgar' })

  it('both UIs prefer the manufacturer-verified Latin form', () => {
    expect(toCartLineDisplay(bilingual(), 'en').brandName).toBe('Solgar')
    expect(toCartLineDisplay(bilingual(), 'he').brandName).toBe('Solgar')
  })

  it('both UIs fall back to the stored name when no Latin form is sourced', () => {
    const unsourced = () => line({ brandName: 'סולגאר', brandNameEn: null })
    expect(toCartLineDisplay(unsourced(), 'en').brandName).toBe('סולגאר')
    expect(toCartLineDisplay(unsourced(), 'he').brandName).toBe('סולגאר')
  })
})

describe('purchasability — the three unbuyable shapes and the buyable one', () => {
  it('a normal line is ok and counts toward the total', () => {
    const display = toCartLineDisplay(line(), 'en')
    expect(display.purchasability).toBe('ok')
    expect(display.countsTowardTotal).toBe(true)
  })

  it('an inactive product is `withdrawn`', () => {
    expect(toCartLineDisplay(line({ isActive: false }), 'en').purchasability).toBe('withdrawn')
  })

  it('an active product at zero stock is `soldOut`', () => {
    expect(toCartLineDisplay(line({ stockQuantity: 0 }), 'en').purchasability).toBe('soldOut')
  })

  it('🔴 ISSUE-080 EXACTLY — quantity 5 against stock 4 is `shortStock`', () => {
    // The reported case: lowStockThreshold 3, so `StockState` called this
    // "in stock" and rendered an empty box while checkout refused the order.
    const display = toCartLineDisplay(
      line({ quantity: 5, stockQuantity: 4, lowStockThreshold: 3 }),
      'en',
    )
    expect(display.purchasability).toBe('shortStock')
    expect(display.countsTowardTotal).toBe(false)
  })

  it('🔴 THE BOUNDARY — quantity EQUAL to stock is still buyable', () => {
    // The server's rule is `stockQuantity >= quantity`. A `>=` written as `>`
    // here would make every at-cap line unbuyable, and the at-cap note is a
    // normal, correct state.
    const display = toCartLineDisplay(line({ quantity: 4, stockQuantity: 4 }), 'en')
    expect(display.purchasability).toBe('ok')
    expect(display.atStockCap).toBe(true)
    expect(display.countsTowardTotal).toBe(true)
  })

  it('🔴 WITHDRAWN WINS over sold out when a line is both', () => {
    // DEC-059 requires the two to read differently — "no longer sold" vs
    // "sold out". A withdrawn product's stock is irrelevant, and reporting it
    // as sold out would tell a shopper to wait for a restock that is never
    // coming.
    const display = toCartLineDisplay(line({ isActive: false, stockQuantity: 0 }), 'en')
    expect(display.purchasability).toBe('withdrawn')
  })

  it('every unbuyable shape counts toward nothing, and only those', () => {
    const cases: [Partial<CartLine>, boolean][] = [
      [{}, true],
      [{ quantity: 4, stockQuantity: 4 }, true],
      [{ isActive: false }, false],
      [{ stockQuantity: 0 }, false],
      [{ quantity: 5, stockQuantity: 4 }, false],
    ]
    for (const [overrides, expected] of cases) {
      expect(toCartLineDisplay(line(overrides), 'en').countsTowardTotal).toBe(expected)
    }
  })
})
