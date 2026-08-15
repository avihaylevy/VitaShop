// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { toCartLineDisplay } from '../../lib/cartDisplay'
import type { CartLine } from '../../types/cart'
import { CartItemRow } from './CartItemRow'

/**
 * ISSUE-080 at the ROW — the model test next door proves the discriminant;
 * this proves the row actually renders from it.
 */

function line(overrides: Partial<CartLine> = {}): CartLine {
  return {
    id: 'line-1',
    productId: 'product-1',
    slug: 'fixture-product',
    nameHe: 'מוצר',
    nameEn: 'Product',
    brandName: 'Brand',
    packageQuantity: 60,
    imageFile: null,
    quantity: 1,
    unitPrice: '95.00',
    baseUnitPrice: '95.00',
    lineTotal: '95.00',
    isActive: true,
    stockQuantity: 10,
    lowStockThreshold: 3,
    ...overrides,
  } as CartLine
}

function renderRow(overrides: Partial<CartLine> = {}) {
  return render(
    <CartItemRow
      line={toCartLineDisplay(line(overrides), 'en')}
      busy={false}
      onIncrement={vi.fn()}
      onDecrement={vi.fn()}
      onRemove={vi.fn()}
    />,
  )
}

const SHORT_STOCK = { quantity: 5, stockQuantity: 4, lowStockThreshold: 3 }

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

describe('a SHORT-STOCK row — the case that said nothing at all', () => {
  it('names the action and the number, not just the state', () => {
    renderRow(SHORT_STOCK)
    // "Lower the quantity to 4" — a shopper who reads only this sentence knows
    // what to do. The earlier row offered no sentence at all.
    expect(screen.getByText(/lower the quantity to 4/i)).toBeTruthy()
  })

  it('🔴 SUPPRESSES the at-cap reassurance that contradicted the block', () => {
    renderRow(SHORT_STOCK)
    expect(screen.queryByText(/all the stock currently available/i)).toBeNull()
  })

  it('says the line is not in the subtotal — F1a made that true', () => {
    renderRow(SHORT_STOCK)
    expect(screen.getByText(/not included in the subtotal/i)).toBeTruthy()
  })

  it('keeps the line total visible — C3: the cart does not hide what was added', () => {
    renderRow(SHORT_STOCK)
    expect(screen.getAllByText(/95\.00|475\.00/).length).toBeGreaterThan(0)
  })
})

describe('🔴 THE CONTROL — an at-cap line that IS buyable', () => {
  it('still shows the at-cap note, and no unbuyable copy', () => {
    // Without this, "suppresses the reassurance" would pass just as well
    // against a row that deleted the note outright. The suppression has to be
    // conditional, and this is the condition it must NOT fire on.
    renderRow({ quantity: 4, stockQuantity: 4 })
    expect(screen.getByText(/all the stock currently available/i)).toBeTruthy()
    expect(screen.queryByText(/not included in the subtotal/i)).toBeNull()
    expect(screen.queryByText(/lower the quantity/i)).toBeNull()
  })
})

describe('the other two shapes read differently, as DEC-059 requires', () => {
  it('a withdrawn line says NO LONGER SOLD', () => {
    renderRow({ isActive: false })
    expect(screen.getByText(/no longer sold/i)).toBeTruthy()
    expect(screen.queryByText(/sold out/i)).toBeNull()
  })

  it('a sold-out line says SOLD OUT', () => {
    renderRow({ stockQuantity: 0 })
    expect(screen.getByText(/sold out/i)).toBeTruthy()
    expect(screen.queryByText(/no longer sold/i)).toBeNull()
  })

  it('both say the line is not in the subtotal', () => {
    renderRow({ isActive: false })
    expect(screen.getByText(/not included in the subtotal/i)).toBeTruthy()
    cleanup()
    renderRow({ stockQuantity: 0 })
    expect(screen.getByText(/not included in the subtotal/i)).toBeTruthy()
  })
})

describe('Hebrew renders the same three states', () => {
  it('short stock carries the number in Hebrew too', async () => {
    await i18n.changeLanguage('he')
    renderRow(SHORT_STOCK)
    // The digit is what a shopper acts on; asserting it rather than the whole
    // sentence keeps the test from breaking on a copy edit while still
    // proving the interpolation ran.
    expect(screen.getByText(/4/)).toBeTruthy()
    expect(screen.queryByText(/all the stock currently available/i)).toBeNull()
  })
})
