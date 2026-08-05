import { describe, expect, it, vi } from 'vitest'
import type { CartItem, CartState } from '../types/cart'
import type { ProductCardModel } from '../types/product'
import { cartReducer, EMPTY_CART, getSubtotalMinor, getTotalQuantity } from './cartReducer'

/**
 * Hand-built state, deliberately bypassing the reducer — used for both
 * corrupt state (the selector guards are unreachable through `cartReducer`,
 * which is the point of them) and for valid near-boundary fixtures, where
 * reaching the boundary through real actions would take ~90,000 dispatches.
 */
function stateOf(...items: readonly Partial<CartItem>[]): CartState {
  return {
    items: items.map((overrides, index) => ({
      slug: `line-${index}`,
      name: 'שם',
      brandName: undefined,
      imageFile: null,
      packageQuantity: undefined,
      unitPriceMinor: 9490,
      stockQuantity: 60,
      lowStockThreshold: 5,
      quantity: 1,
      ...overrides,
    })),
  }
}

/**
 * Fixtures use the real DEC-032 verified catalogue values (slug, name,
 * brand, price, package quantity) from assets/products/products.csv.
 * Stock quantities are varied per test to exercise the ceiling — stock is
 * mutable operational data, not product content, so varying it invents
 * nothing.
 */
function product(overrides: Partial<ProductCardModel> = {}): ProductCardModel {
  return {
    slug: 'solgar-omega-3',
    name: 'אומגה 3',
    categoryNameHe: 'אומגה ושומנים',
    categoryName: 'אומגה ושומנים',
    price: '94.90',
    stockQuantity: 60,
    lowStockThreshold: 5,
    brandName: 'סולגאר',
    packageQuantity: 100,
    imageFile: 'אומגה 3 של חברת סולגאר.jpg',
    ...overrides,
  }
}

const VITAMIN_C = product({
  slug: 'solgar-vitamin-c-berry',
  name: 'ויטמין C בטעם פטל חמוציות',
  categoryNameHe: 'ויטמינים',
  categoryName: 'ויטמינים',
  price: '69.90',
  stockQuantity: 80,
  packageQuantity: 90,
  imageFile: 'ויטמין C בטעם פטל חמוציות של חברת סולגאר.jpg',
})

const MAGNESIUM = product({
  slug: 'superherb-magnesium-max-550',
  name: 'מגנזיום מקס 550',
  categoryNameHe: 'מינרלים',
  categoryName: 'מינרלים',
  price: '49.90',
  stockQuantity: 40,
  brandName: 'סופהרב',
  packageQuantity: 60,
  imageFile: 'מגנזיות מקס 550 של חברת סופרהרב.jpg',
})

/** The largest price `parsePriceToMinor` accepts: "999999999.99" in agorot. */
const MAX_PRICE_MINOR = 99_999_999_999

/**
 * The real per-line unit ceiling at that price — `MAX_PRICE_MINOR * 90071`
 * is the last safe integer product. Asserted, not assumed, below.
 */
const MAX_PRICE_SAFE_UNITS = 90_071

/** Applies a sequence of actions from the empty cart. */
function reduceAll(...actions: Parameters<typeof cartReducer>[1][]): CartState {
  return actions.reduce(cartReducer, EMPTY_CART)
}

describe('add', () => {
  it('creates one line at quantity 1 with the snapshot fields', () => {
    const state = cartReducer(EMPTY_CART, { type: 'add', product: product() })

    expect(state.items).toHaveLength(1)
    expect(state.items[0]).toEqual({
      slug: 'solgar-omega-3',
      name: 'אומגה 3',
      brandName: 'סולגאר',
      imageFile: 'אומגה 3 של חברת סולגאר.jpg',
      packageQuantity: 100,
      unitPriceMinor: 9490,
      stockQuantity: 60,
      lowStockThreshold: 5,
      quantity: 1,
    })
  })

  it('stores no category, dosage form or medical content', () => {
    const state = cartReducer(EMPTY_CART, { type: 'add', product: product({ dosageForm: 'כמוסות' }) })
    const keys = Object.keys(state.items[0])

    expect(keys).not.toContain('categoryName')
    expect(keys).not.toContain('categoryNameHe')
    expect(keys).not.toContain('dosageForm')
  })

  it('increments the existing line on a duplicate add — never a second line', () => {
    const state = reduceAll(
      { type: 'add', product: product() },
      { type: 'add', product: product() },
      { type: 'add', product: product() },
    )

    expect(state.items).toHaveLength(1)
    expect(state.items[0].quantity).toBe(3)
  })

  it('keeps distinct products on distinct lines, in insertion order', () => {
    const state = reduceAll(
      { type: 'add', product: product() },
      { type: 'add', product: VITAMIN_C },
      { type: 'add', product: MAGNESIUM },
    )

    expect(state.items.map((item) => item.slug)).toEqual([
      'solgar-omega-3',
      'solgar-vitamin-c-berry',
      'superherb-magnesium-max-550',
    ])
  })

  it('clamps a duplicate add at the stock ceiling instead of exceeding it', () => {
    const scarce = product({ stockQuantity: 2 })
    const state = reduceAll(
      { type: 'add', product: scarce },
      { type: 'add', product: scarce },
      { type: 'add', product: scarce },
    )

    expect(state.items[0].quantity).toBe(2)
  })

  it('refuses a zero-stock product and leaves state untouched', () => {
    const state = cartReducer(EMPTY_CART, { type: 'add', product: product({ stockQuantity: 0 }) })
    expect(state).toBe(EMPTY_CART)
  })

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('refuses a product whose stockQuantity is %o', (stockQuantity) => {
    const state = cartReducer(EMPTY_CART, { type: 'add', product: product({ stockQuantity }) })
    expect(state).toBe(EMPTY_CART)
  })

  it.each(['', 'abc', '-5', '1e3', '94.900', ' 94.90 ', 'NaN', 'Infinity'])(
    'refuses an invalid price %o without creating a zero-price line',
    (price) => {
      const state = cartReducer(EMPTY_CART, { type: 'add', product: product({ price }) })

      expect(state).toBe(EMPTY_CART)
      expect(state.items).toHaveLength(0)
      expect(getSubtotalMinor(state)).toBe(0)
    },
  )

  it('refuses an invalid price on a duplicate add, leaving the existing line intact', () => {
    const withLine = cartReducer(EMPTY_CART, { type: 'add', product: product() })
    const state = cartReducer(withLine, { type: 'add', product: product({ price: 'abc' }) })

    expect(state).toBe(withLine)
    expect(state.items[0].quantity).toBe(1)
    expect(state.items[0].unitPriceMinor).toBe(9490)
  })

  it('refreshes the stock snapshot from the newest catalogue data and re-clamps', () => {
    const plentiful = reduceAll(
      { type: 'add', product: product({ stockQuantity: 60 }) },
      { type: 'add', product: product({ stockQuantity: 60 }) },
      { type: 'add', product: product({ stockQuantity: 60 }) },
    )
    expect(plentiful.items[0].quantity).toBe(3)

    // The catalogue refetches and stock has dropped below the held quantity.
    const restocked = cartReducer(plentiful, { type: 'add', product: product({ stockQuantity: 2 }) })

    expect(restocked.items[0].stockQuantity).toBe(2)
    expect(restocked.items[0].quantity).toBe(2)
  })

  it('warns in dev but does not throw when a transition is refused', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(() => cartReducer(EMPTY_CART, { type: 'add', product: product({ price: 'abc' }) })).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('solgar-omega-3')

    warn.mockRestore()
  })
})

describe('increment', () => {
  it('adds exactly one unit', () => {
    const state = reduceAll({ type: 'add', product: product() }, { type: 'increment', slug: 'solgar-omega-3' })
    expect(state.items[0].quantity).toBe(2)
  })

  it('is a no-op at the stock ceiling', () => {
    const atCeiling = reduceAll(
      { type: 'add', product: product({ stockQuantity: 1 }) },
      { type: 'increment', slug: 'solgar-omega-3' },
    )

    expect(atCeiling.items[0].quantity).toBe(1)
  })

  it('is a no-op for an unknown slug and returns the same state object', () => {
    const withLine = cartReducer(EMPTY_CART, { type: 'add', product: product() })
    expect(cartReducer(withLine, { type: 'increment', slug: 'does-not-exist' })).toBe(withLine)
  })
})

describe('decrement', () => {
  it('subtracts exactly one unit above the minimum', () => {
    const state = reduceAll(
      { type: 'add', product: product() },
      { type: 'add', product: product() },
      { type: 'decrement', slug: 'solgar-omega-3' },
    )

    expect(state.items[0].quantity).toBe(1)
  })

  it('is a no-op at quantity 1 and never removes the line', () => {
    const withLine = cartReducer(EMPTY_CART, { type: 'add', product: product() })
    const state = cartReducer(withLine, { type: 'decrement', slug: 'solgar-omega-3' })

    expect(state).toBe(withLine)
    expect(state.items).toHaveLength(1)
    expect(state.items[0].quantity).toBe(1)
  })

  it('never produces a quantity of 0, however many times it is pressed', () => {
    let state = cartReducer(EMPTY_CART, { type: 'add', product: product() })
    for (let i = 0; i < 5; i += 1) {
      state = cartReducer(state, { type: 'decrement', slug: 'solgar-omega-3' })
    }

    expect(state.items).toHaveLength(1)
    expect(state.items[0].quantity).toBe(1)
  })

  it('leaves totalQuantity and subtotalMinor untouched when blocked', () => {
    const withLine = cartReducer(EMPTY_CART, { type: 'add', product: product() })
    const blocked = cartReducer(withLine, { type: 'decrement', slug: 'solgar-omega-3' })

    expect(getTotalQuantity(blocked)).toBe(getTotalQuantity(withLine))
    expect(getSubtotalMinor(blocked)).toBe(getSubtotalMinor(withLine))
  })

  it('is a no-op for an unknown slug', () => {
    const withLine = cartReducer(EMPTY_CART, { type: 'add', product: product() })
    expect(cartReducer(withLine, { type: 'decrement', slug: 'does-not-exist' })).toBe(withLine)
  })
})

describe('remove', () => {
  it('drops the whole line regardless of its quantity', () => {
    const state = reduceAll(
      { type: 'add', product: product() },
      { type: 'add', product: product() },
      { type: 'add', product: VITAMIN_C },
      { type: 'remove', slug: 'solgar-omega-3' },
    )

    expect(state.items.map((item) => item.slug)).toEqual(['solgar-vitamin-c-berry'])
    expect(getTotalQuantity(state)).toBe(1)
  })

  it('is a no-op for an unknown slug and returns the same state object', () => {
    const withLine = cartReducer(EMPTY_CART, { type: 'add', product: product() })
    expect(cartReducer(withLine, { type: 'remove', slug: 'does-not-exist' })).toBe(withLine)
  })
})

describe('restore', () => {
  /** A removed snapshot, exactly as `remove` left it. */
  function removedItem(overrides: Partial<CartItem> = {}): CartItem {
    return stateOf({ slug: 'solgar-omega-3', ...overrides }).items[0]
  }

  /** Three lines, so an index can be genuinely first, middle or last. */
  function threeLines(): CartState {
    return reduceAll(
      { type: 'add', product: product() },
      { type: 'add', product: VITAMIN_C },
      { type: 'add', product: MAGNESIUM },
    )
  }

  it('restores a removed line at index 0, ahead of everything else', () => {
    const full = threeLines()
    const removed = full.items[0]
    const without = cartReducer(full, { type: 'remove', slug: removed.slug })

    const restored = cartReducer(without, { type: 'restore', item: removed, index: 0 })

    expect(restored.items.map((item) => item.slug)).toEqual(full.items.map((item) => item.slug))
    expect(restored.items[0]).toEqual(removed)
  })

  it('restores a removed line in the middle, preserving the order of the others', () => {
    const full = threeLines()
    const removed = full.items[1]
    const without = cartReducer(full, { type: 'remove', slug: removed.slug })

    const restored = cartReducer(without, { type: 'restore', item: removed, index: 1 })

    expect(restored.items.map((item) => item.slug)).toEqual(full.items.map((item) => item.slug))
  })

  it('restores a removed line at the end, where index equals the current length', () => {
    const full = threeLines()
    const removed = full.items[2]
    const without = cartReducer(full, { type: 'remove', slug: removed.slug })

    const restored = cartReducer(without, { type: 'restore', item: removed, index: without.items.length })

    expect(restored.items.map((item) => item.slug)).toEqual(full.items.map((item) => item.slug))
  })

  it('restores the snapshot verbatim — no refreshed price, stock or name', () => {
    const removed = removedItem({ quantity: 3, unitPriceMinor: 1234, stockQuantity: 9, name: 'שם ישן' })

    const restored = cartReducer(EMPTY_CART, { type: 'restore', item: removed, index: 0 })

    expect(restored.items[0]).toEqual(removed)
  })

  it('produces a state every selector accepts', () => {
    const removed = removedItem({ quantity: 2, unitPriceMinor: 9490 })

    const restored = cartReducer(EMPTY_CART, { type: 'restore', item: removed, index: 0 })

    expect(getTotalQuantity(restored)).toBe(2)
    expect(getSubtotalMinor(restored)).toBe(18_980)
  })

  describe('refuses the transition and returns the SAME state object', () => {
    const populated = reduceAll({ type: 'add', product: product() }, { type: 'add', product: VITAMIN_C })

    it.each([
      ['a negative index', { item: removedItem({ slug: 'other' }), index: -1 }],
      ['a fractional index', { item: removedItem({ slug: 'other' }), index: 1.5 }],
      ['an index past the end', { item: removedItem({ slug: 'other' }), index: 3 }],
      ['a duplicate slug', { item: removedItem({ slug: 'solgar-omega-3' }), index: 0 }],
      ['a zero quantity', { item: removedItem({ slug: 'other', quantity: 0 }), index: 0 }],
      ['a fractional quantity', { item: removedItem({ slug: 'other', quantity: 1.5 }), index: 0 }],
      ['a negative quantity', { item: removedItem({ slug: 'other', quantity: -2 }), index: 0 }],
      ['a zero stock quantity', { item: removedItem({ slug: 'other', stockQuantity: 0 }), index: 0 }],
      ['a fractional stock quantity', { item: removedItem({ slug: 'other', stockQuantity: 2.5 }), index: 0 }],
      ['a quantity above stock', { item: removedItem({ slug: 'other', quantity: 5, stockQuantity: 3 }), index: 0 }],
      ['a negative unit price', { item: removedItem({ slug: 'other', unitPriceMinor: -1 }), index: 0 }],
      ['a fractional unit price', { item: removedItem({ slug: 'other', unitPriceMinor: 12.5 }), index: 0 }],
      ['a NaN unit price', { item: removedItem({ slug: 'other', unitPriceMinor: Number.NaN }), index: 0 }],
    ])('%s', (_label, { item, index }) => {
      expect(cartReducer(populated, { type: 'restore', item, index })).toBe(populated)
    })

    it('never merges a duplicate slug into the existing line', () => {
      const before = populated.items.find((item) => item.slug === 'solgar-omega-3')!

      const after = cartReducer(populated, {
        type: 'restore',
        item: removedItem({ slug: 'solgar-omega-3', quantity: 4 }),
        index: 0,
      })

      expect(after.items.filter((item) => item.slug === 'solgar-omega-3')).toHaveLength(1)
      expect(after.items.find((item) => item.slug === 'solgar-omega-3')).toBe(before)
    })

    it('a resulting total quantity outside the safe range', () => {
      // Priced at 0 agorot on purpose, so the SUBTOTAL stays safe and this
      // test isolates the total-quantity guard rather than passing for the
      // wrong reason. The incoming state is itself valid.
      const huge = stateOf({ slug: 'huge', quantity: 2 ** 52, stockQuantity: 2 ** 52, unitPriceMinor: 0 })
      expect(getTotalQuantity(huge)).toBe(2 ** 52)
      expect(getSubtotalMinor(huge)).toBe(0)

      expect(
        cartReducer(huge, {
          type: 'restore',
          item: removedItem({ slug: 'other', quantity: 2 ** 52, stockQuantity: 2 ** 52, unitPriceMinor: 0 }),
          index: 0,
        }),
      ).toBe(huge)
    })

    it('a resulting subtotal outside the safe range', () => {
      const priced = stateOf({ slug: 'priced', quantity: 1, unitPriceMinor: MAX_PRICE_MINOR })
      const overflowing = removedItem({
        slug: 'other',
        quantity: MAX_PRICE_SAFE_UNITS + 1,
        stockQuantity: MAX_PRICE_SAFE_UNITS + 1,
        unitPriceMinor: MAX_PRICE_MINOR,
      })

      expect(cartReducer(priced, { type: 'restore', item: overflowing, index: 0 })).toBe(priced)
    })
  })

  it('warns in development on a refused restore, and only in development', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      cartReducer(EMPTY_CART, { type: 'restore', item: removedItem({ quantity: 0 }), index: 0 })
      expect(warn).toHaveBeenCalledTimes(import.meta.env.DEV ? 1 : 0)
    } finally {
      warn.mockRestore()
    }
  })
})

describe('getTotalQuantity', () => {
  it('is 0 for an empty cart', () => {
    expect(getTotalQuantity(EMPTY_CART)).toBe(0)
  })

  it('is 1 for one product added once', () => {
    expect(getTotalQuantity(cartReducer(EMPTY_CART, { type: 'add', product: product() }))).toBe(1)
  })

  it('counts units, not lines, when the same product is added twice', () => {
    const state = reduceAll({ type: 'add', product: product() }, { type: 'add', product: product() })

    expect(state.items).toHaveLength(1)
    expect(getTotalQuantity(state)).toBe(2)
  })

  it('sums across distinct products at mixed quantities', () => {
    const state = reduceAll(
      { type: 'add', product: product() },
      { type: 'add', product: product() },
      { type: 'add', product: VITAMIN_C },
      { type: 'add', product: MAGNESIUM },
      { type: 'add', product: MAGNESIUM },
      { type: 'add', product: MAGNESIUM },
    )

    expect(getTotalQuantity(state)).toBe(6)
  })

  it('never diverges from the sum of the item quantities across a long sequence', () => {
    const state = reduceAll(
      { type: 'add', product: product() },
      { type: 'add', product: VITAMIN_C },
      { type: 'add', product: VITAMIN_C },
      { type: 'increment', slug: 'solgar-omega-3' },
      { type: 'decrement', slug: 'solgar-vitamin-c-berry' },
      { type: 'add', product: MAGNESIUM },
      { type: 'remove', slug: 'solgar-vitamin-c-berry' },
    )

    const summed = state.items.reduce((total, item) => total + item.quantity, 0)
    expect(getTotalQuantity(state)).toBe(summed)
    expect(getTotalQuantity(state)).toBe(3)
  })
})

describe('getSubtotalMinor', () => {
  it('is 0 for an empty cart', () => {
    expect(getSubtotalMinor(EMPTY_CART)).toBe(0)
  })

  it('multiplies and sums in integer agorot with no floating-point drift', () => {
    const state = reduceAll(
      { type: 'add', product: product() }, // 94.90 x 2
      { type: 'add', product: product() },
      { type: 'add', product: VITAMIN_C }, // 69.90 x 1
      { type: 'add', product: MAGNESIUM }, // 49.90 x 3
      { type: 'add', product: MAGNESIUM },
      { type: 'add', product: MAGNESIUM },
    )

    // 9490*2 + 6990 + 4990*3 = 18980 + 6990 + 14970 = 40940 agorot.
    expect(getSubtotalMinor(state)).toBe(40940)
    expect(Number.isSafeInteger(getSubtotalMinor(state))).toBe(true)
  })

  it('tracks quantity changes exactly', () => {
    const state = reduceAll(
      { type: 'add', product: product() },
      { type: 'increment', slug: 'solgar-omega-3' },
      { type: 'increment', slug: 'solgar-omega-3' },
      { type: 'decrement', slug: 'solgar-omega-3' },
    )

    expect(getSubtotalMinor(state)).toBe(18980)
  })

  it('drops a removed line from the total entirely', () => {
    const state = reduceAll(
      { type: 'add', product: product() },
      { type: 'add', product: VITAMIN_C },
      { type: 'remove', slug: 'solgar-omega-3' },
    )

    expect(getSubtotalMinor(state)).toBe(6990)
  })
})

/**
 * Selector integrity guards — Codex review, Checkpoint B. Every case here
 * builds corrupt state by hand; none of it is reachable through the reducer.
 */
describe('getSubtotalMinor integrity', () => {
  it('throws RangeError when a single line total overflows the safe range', () => {
    const state = stateOf({ unitPriceMinor: 1e15, quantity: 100, stockQuantity: 100 })

    expect(() => getSubtotalMinor(state)).toThrow(RangeError)
    expect(() => getSubtotalMinor(state)).toThrow(/exceeded the safe integer range/)
  })

  it('throws when the accumulated subtotal overflows even though every line total is safe', () => {
    const half = 5_000_000_000_000_000 // 5e15 — safe alone, 1e16 together
    const state = stateOf(
      { slug: 'line-a', unitPriceMinor: half, quantity: 1 },
      { slug: 'line-b', unitPriceMinor: half, quantity: 1 },
    )

    expect(Number.isSafeInteger(half)).toBe(true)
    expect(Number.isSafeInteger(half + half)).toBe(false)
    expect(() => getSubtotalMinor(state)).toThrow(RangeError)
    expect(() => getSubtotalMinor(state)).toThrow(/subtotal exceeded the safe integer range/)
  })

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'throws on an invalid unitPriceMinor of %o already in state',
    (unitPriceMinor) => {
      expect(() => getSubtotalMinor(stateOf({ unitPriceMinor }))).toThrow(RangeError)
    },
  )

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'throws on an invalid quantity of %o already in state',
    (quantity) => {
      expect(() => getSubtotalMinor(stateOf({ quantity }))).toThrow(RangeError)
    },
  )

  it('returns nothing at all on overflow — no zero, no clamp, no partial sum, no unsafe integer', () => {
    const state = stateOf(
      { slug: 'line-a', unitPriceMinor: 9490, quantity: 2 }, // a perfectly good line first
      { slug: 'line-b', unitPriceMinor: 1e15, quantity: 100 },
    )

    let returned: number | undefined
    try {
      returned = getSubtotalMinor(state)
    } catch (error) {
      expect(error).toBeInstanceOf(RangeError)
    }

    // Not 0, not the partial 18980 accumulated before the bad line, not
    // MAX_SAFE_INTEGER, not an unsafe float — nothing was returned.
    expect(returned).toBeUndefined()
  })

  it('names only the slug, never a price or a quantity', () => {
    const state = stateOf({ slug: 'solgar-omega-3', unitPriceMinor: 1e15, quantity: 100 })

    expect(() => getSubtotalMinor(state)).toThrow(/solgar-omega-3/)
    expect(() => getSubtotalMinor(state)).not.toThrow(/1e\+15|1000000000000000|100\b/)
  })

  it('is deterministic — the same corrupt state throws the same message every time', () => {
    const state = stateOf({ unitPriceMinor: -1 })
    const first = (() => {
      try {
        getSubtotalMinor(state)
      } catch (error) {
        return (error as RangeError).message
      }
    })()

    expect(() => getSubtotalMinor(state)).toThrow(first)
  })

  it('still returns the exact subtotal for ordinary catalogue values', () => {
    const state = reduceAll(
      { type: 'add', product: product() },
      { type: 'add', product: product() },
      { type: 'add', product: VITAMIN_C },
      { type: 'add', product: MAGNESIUM },
      { type: 'add', product: MAGNESIUM },
      { type: 'add', product: MAGNESIUM },
    )

    expect(getSubtotalMinor(state)).toBe(40940)
  })
})

describe('getTotalQuantity integrity', () => {
  it('throws when two individually valid quantities sum past MAX_SAFE_INTEGER', () => {
    const half = 5_000_000_000_000_000
    const state = stateOf(
      { slug: 'line-a', quantity: half, stockQuantity: half },
      { slug: 'line-b', quantity: half, stockQuantity: half },
    )

    expect(() => getTotalQuantity(state)).toThrow(RangeError)
    expect(() => getTotalQuantity(state)).toThrow(/total quantity exceeded the safe integer range/)
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'throws on an invalid quantity of %o already in state',
    (quantity) => {
      expect(() => getTotalQuantity(stateOf({ quantity }))).toThrow(RangeError)
    },
  )

  it('does not clamp, fall back to zero, or return the previous count', () => {
    const state = stateOf({ slug: 'line-a', quantity: 3 }, { slug: 'line-b', quantity: Number.NaN })

    let returned: number | undefined
    try {
      returned = getTotalQuantity(state)
    } catch (error) {
      expect(error).toBeInstanceOf(RangeError)
    }

    expect(returned).toBeUndefined()
  })

  it('still returns the expected total for ordinary quantities', () => {
    const state = reduceAll(
      { type: 'add', product: product() },
      { type: 'add', product: product() },
      { type: 'add', product: VITAMIN_C },
    )

    expect(getTotalQuantity(state)).toBe(3)
  })
})

describe('reducer-produced states never trip the selector guards', () => {
  it('survives a long mixed sequence including every refused transition', () => {
    const state = reduceAll(
      { type: 'add', product: product() },
      { type: 'add', product: product({ price: 'abc' }) },
      { type: 'add', product: product({ stockQuantity: 0 }) },
      { type: 'add', product: VITAMIN_C },
      { type: 'increment', slug: 'solgar-omega-3' },
      { type: 'decrement', slug: 'solgar-vitamin-c-berry' },
      { type: 'decrement', slug: 'does-not-exist' },
      { type: 'add', product: MAGNESIUM },
      { type: 'remove', slug: 'nope' },
      { type: 'remove', slug: 'solgar-vitamin-c-berry' },
    )

    expect(() => getTotalQuantity(state)).not.toThrow()
    expect(() => getSubtotalMinor(state)).not.toThrow()
    expect(getTotalQuantity(state)).toBe(3)
    expect(getSubtotalMinor(state)).toBe(23970)
  })

  it('stays valid across 20 increments at the largest price the parser accepts', () => {
    // Renamed and rescoped: the previous title claimed to reach the stock
    // ceiling, but 21 units is nowhere near it. The real ceiling for this
    // price is exercised in `MAX_PRICE_SAFE_UNITS` below, from a directly
    // constructed fixture rather than ~90,000 dispatches.
    const extreme = product({ price: '999999999.99', stockQuantity: 9000 })
    let state = cartReducer(EMPTY_CART, { type: 'add', product: extreme })
    for (let i = 0; i < 20; i += 1) {
      state = cartReducer(state, { type: 'increment', slug: extreme.slug })
    }

    expect(state.items[0].quantity).toBe(21)
    expect(getSubtotalMinor(state)).toBe(MAX_PRICE_MINOR * 21)
    expect(Number.isSafeInteger(getSubtotalMinor(state))).toBe(true)
  })
})

/**
 * Prospective-state validation — Codex review round 2. The reducer must
 * never emit a state its own selectors would reject, so a transition that
 * would overflow is discarded whole and the ORIGINAL state object comes
 * back. Fixtures are built directly: reaching these boundaries through real
 * actions would take tens of thousands of dispatches.
 */
describe('the reducer never emits a state its selectors reject', () => {
  it('confirms the documented safe ceiling for the largest parseable price', () => {
    expect(Number.isSafeInteger(MAX_PRICE_MINOR * MAX_PRICE_SAFE_UNITS)).toBe(true)
    expect(Number.isSafeInteger(MAX_PRICE_MINOR * (MAX_PRICE_SAFE_UNITS + 1))).toBe(false)
    expect(MAX_PRICE_SAFE_UNITS).toBe(90071)
  })

  it('rejects an increment that would push a line total past the safe range', () => {
    const before = stateOf({
      slug: 'solgar-omega-3',
      unitPriceMinor: MAX_PRICE_MINOR,
      quantity: MAX_PRICE_SAFE_UNITS,
      stockQuantity: 200_000,
    })
    const safeSubtotal = getSubtotalMinor(before)

    const after = cartReducer(before, { type: 'increment', slug: 'solgar-omega-3' })

    expect(after).toBe(before)
    expect(after.items[0].quantity).toBe(MAX_PRICE_SAFE_UNITS)
    expect(getSubtotalMinor(after)).toBe(safeSubtotal)
  })

  it('rejects a duplicate add at the same line-total boundary', () => {
    const before = stateOf({
      slug: 'solgar-omega-3',
      unitPriceMinor: MAX_PRICE_MINOR,
      quantity: MAX_PRICE_SAFE_UNITS,
      stockQuantity: 200_000,
    })

    const after = cartReducer(before, {
      type: 'add',
      product: product({ price: '999999999.99', stockQuantity: 200_000 }),
    })

    expect(after).toBe(before)
    expect(after.items).toHaveLength(1)
    expect(after.items[0].quantity).toBe(MAX_PRICE_SAFE_UNITS)
  })

  it('rejects a new line whose own total is safe but which overflows the accumulated subtotal', () => {
    const before = stateOf({ slug: 'existing-line', unitPriceMinor: 9_007_100_000_000_000, quantity: 1 })
    const safeSubtotal = getSubtotalMinor(before)

    // The new line alone is safe (99999999999 x 1), the sum is not.
    expect(Number.isSafeInteger(MAX_PRICE_MINOR)).toBe(true)
    expect(Number.isSafeInteger(safeSubtotal + MAX_PRICE_MINOR)).toBe(false)

    const after = cartReducer(before, {
      type: 'add',
      product: product({ slug: 'solgar-omega-3', price: '999999999.99' }),
    })

    expect(after).toBe(before)
    expect(after.items).toHaveLength(1)
  })

  it('rejects an increment that overflows the accumulated subtotal while its line total stays safe', () => {
    const half = 4_000_000_000_000_000
    const before = stateOf(
      { slug: 'line-a', unitPriceMinor: half, quantity: 1 },
      { slug: 'line-b', unitPriceMinor: half, quantity: 1, stockQuantity: 10 },
    )

    expect(Number.isSafeInteger(half * 2)).toBe(true) // line-b's own total after the increment
    expect(Number.isSafeInteger(half + half * 2)).toBe(false) // the subtotal is not

    expect(cartReducer(before, { type: 'increment', slug: 'line-b' })).toBe(before)
  })

  it('rejects an increment that would overflow the total unit count', () => {
    // Zero-priced lines keep the subtotal safe, isolating the quantity guard.
    const before = stateOf(
      { slug: 'line-a', unitPriceMinor: 0, quantity: 4_503_599_627_370_495, stockQuantity: Number.MAX_SAFE_INTEGER },
      { slug: 'line-b', unitPriceMinor: 0, quantity: 4_503_599_627_370_496, stockQuantity: Number.MAX_SAFE_INTEGER },
    )

    expect(getTotalQuantity(before)).toBe(Number.MAX_SAFE_INTEGER)

    const after = cartReducer(before, { type: 'increment', slug: 'line-a' })

    expect(after).toBe(before)
    expect(getTotalQuantity(after)).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('rejects a new line that would overflow the total unit count', () => {
    const before = stateOf({
      slug: 'line-a',
      unitPriceMinor: 0,
      quantity: Number.MAX_SAFE_INTEGER,
      stockQuantity: Number.MAX_SAFE_INTEGER,
    })

    expect(cartReducer(before, { type: 'add', product: product() })).toBe(before)
  })

  it('rejects a stale-stock refresh that would break the invariants, leaving the snapshot untouched', () => {
    const before = stateOf(
      { slug: 'bulky-line', unitPriceMinor: 9_007_000_000_000_000, quantity: 1 },
      {
        slug: 'solgar-omega-3',
        name: 'אומגה 3',
        unitPriceMinor: 9490,
        quantity: 1,
        stockQuantity: 60,
        lowStockThreshold: 5,
      },
    )

    // The refresh would raise this line's unit price to the parser maximum
    // and its quantity to 2 — safe on its own, fatal for the subtotal.
    const after = cartReducer(before, {
      type: 'add',
      product: product({ price: '999999999.99', stockQuantity: 200_000, lowStockThreshold: 999 }),
    })

    expect(after).toBe(before)
    expect(after.items[1]).toEqual(before.items[1])
    expect(after.items[1].unitPriceMinor).toBe(9490)
    expect(after.items[1].quantity).toBe(1)
    expect(after.items[1].stockQuantity).toBe(60)
    expect(after.items[1].lowStockThreshold).toBe(5)
  })

  it('does not block valid reductions — decrement still works at the boundary', () => {
    const before = stateOf({
      slug: 'solgar-omega-3',
      unitPriceMinor: MAX_PRICE_MINOR,
      quantity: MAX_PRICE_SAFE_UNITS,
      stockQuantity: 200_000,
    })

    const after = cartReducer(before, { type: 'decrement', slug: 'solgar-omega-3' })

    expect(after).not.toBe(before)
    expect(after.items[0].quantity).toBe(MAX_PRICE_SAFE_UNITS - 1)
  })

  it('does not block valid reductions — remove still works at the boundary', () => {
    const before = stateOf(
      { slug: 'solgar-omega-3', unitPriceMinor: MAX_PRICE_MINOR, quantity: MAX_PRICE_SAFE_UNITS },
      { slug: 'solgar-vitamin-c-berry', unitPriceMinor: 6990, quantity: 1 },
    )

    const after = cartReducer(before, { type: 'remove', slug: 'solgar-omega-3' })

    expect(after).not.toBe(before)
    expect(after.items.map((item) => item.slug)).toEqual(['solgar-vitamin-c-berry'])
    expect(getSubtotalMinor(after)).toBe(6990)
  })

  it('warns in dev on a rejected overflow transition without throwing', () => {
    const before = stateOf({
      slug: 'solgar-omega-3',
      unitPriceMinor: MAX_PRICE_MINOR,
      quantity: MAX_PRICE_SAFE_UNITS,
      stockQuantity: 200_000,
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(() => cartReducer(before, { type: 'increment', slug: 'solgar-omega-3' })).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('safe integer range')

    warn.mockRestore()
  })
})

/**
 * 🔴 Incoming-state validation — Codex final review.
 *
 * EVERY action fails loudly on corrupt incoming state, including the paths
 * that used to early-return before any validation ran. These tests replace
 * two earlier ones that approved exactly the behaviour now forbidden: a
 * non-throwing decrement-at-1 on corrupt state, and a duplicate add that
 * "refreshed" a corrupt line back to valid data (i.e. laundered it).
 */
describe('corrupt incoming state fails loudly, for every action', () => {
  const CORRUPT_PRICE = stateOf(
    { slug: 'bad-line', unitPriceMinor: Number.NaN, quantity: 1 },
    { slug: 'solgar-omega-3', unitPriceMinor: 9490, quantity: 1, stockQuantity: 60 },
  )
  const CORRUPT_QUANTITY = stateOf(
    { slug: 'bad-line', unitPriceMinor: 9490, quantity: 0 },
    { slug: 'solgar-omega-3', unitPriceMinor: 9490, quantity: 1, stockQuantity: 60 },
  )

  const ACTIONS = [
    ['add new line', { type: 'add', product: VITAMIN_C }],
    ['duplicate add', { type: 'add', product: product() }],
    ['increment', { type: 'increment', slug: 'solgar-omega-3' }],
    ['decrement at quantity 1', { type: 'decrement', slug: 'solgar-omega-3' }],
    ['unknown-slug increment', { type: 'increment', slug: 'does-not-exist' }],
    ['unknown-slug decrement', { type: 'decrement', slug: 'does-not-exist' }],
    ['unknown-slug remove', { type: 'remove', slug: 'does-not-exist' }],
    ['remove', { type: 'remove', slug: 'solgar-omega-3' }],
    [
      'restore',
      { type: 'restore', item: stateOf({ slug: 'restored-line' }).items[0], index: 0 },
    ],
    [
      'refused restore',
      { type: 'restore', item: stateOf({ slug: 'restored-line', quantity: 0 }).items[0], index: 0 },
    ],
  ] as const satisfies readonly (readonly [string, Parameters<typeof cartReducer>[1]])[]

  it.each(ACTIONS)('throws RangeError on %s when a unit price is corrupt', (_label, action) => {
    expect(() => cartReducer(CORRUPT_PRICE, action)).toThrow(RangeError)
  })

  it.each(ACTIONS)('throws RangeError on %s when a quantity is corrupt', (_label, action) => {
    expect(() => cartReducer(CORRUPT_QUANTITY, action)).toThrow(RangeError)
  })

  it('🔴 a duplicate add cannot repair a corrupt price by overwriting the snapshot', () => {
    const corrupt = stateOf({ slug: 'solgar-omega-3', unitPriceMinor: Number.NaN, quantity: 1, stockQuantity: 60 })

    // Previously this returned a "repaired" state with unitPriceMinor 9490.
    expect(() => cartReducer(corrupt, { type: 'add', product: product() })).toThrow(RangeError)
  })

  it('🔴 a duplicate add cannot repair a corrupt quantity either', () => {
    const corrupt = stateOf({ slug: 'solgar-omega-3', unitPriceMinor: 9490, quantity: 1.5, stockQuantity: 60 })

    expect(() => cartReducer(corrupt, { type: 'add', product: product() })).toThrow(RangeError)
  })

  it('does not convert an incoming-state RangeError into a silent no-op', () => {
    const corrupt = stateOf({ slug: 'bad-line', unitPriceMinor: -1, quantity: 1 })
    let returned: CartState | undefined

    try {
      returned = cartReducer(corrupt, { type: 'decrement', slug: 'bad-line' })
    } catch (error) {
      expect(error).toBeInstanceOf(RangeError)
    }

    // Not the original object, not a clamped copy — nothing came back at all.
    expect(returned).toBeUndefined()
  })

  it('leaves ordinary valid no-op behaviour unchanged', () => {
    const valid = cartReducer(EMPTY_CART, { type: 'add', product: product() })

    expect(cartReducer(valid, { type: 'decrement', slug: 'solgar-omega-3' })).toBe(valid)
    expect(cartReducer(valid, { type: 'increment', slug: 'does-not-exist' })).toBe(valid)
    expect(cartReducer(valid, { type: 'remove', slug: 'does-not-exist' })).toBe(valid)
  })

  it('still returns the ORIGINAL state object when valid state meets a rejected overflow', () => {
    const before = stateOf({
      slug: 'solgar-omega-3',
      unitPriceMinor: MAX_PRICE_MINOR,
      quantity: MAX_PRICE_SAFE_UNITS,
      stockQuantity: 200_000,
    })

    expect(cartReducer(before, { type: 'increment', slug: 'solgar-omega-3' })).toBe(before)
  })
})
