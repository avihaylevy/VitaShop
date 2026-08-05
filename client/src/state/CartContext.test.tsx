import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { CartItem } from '../types/cart'
import { cartReducer, EMPTY_CART, getSubtotalMinor, getTotalQuantity } from '../lib/cartReducer'
import { CartProvider, useCart } from './CartContext'

/**
 * Context-contract tests. `renderToStaticMarkup` is used deliberately: it
 * runs without a DOM, so this file adds no jsdom and no Testing Library
 * (both would be dependencies requiring their own decision).
 *
 * 🔴 What this covers: the provider's initial derived values, the exact
 * public API surface, and the missing-provider guard.
 * 🔴 What it cannot cover: interaction. A static render has no state
 * updates, so dispatching and re-reading is out of reach here — that
 * behaviour is covered exhaustively by the pure `cartReducer` tests, and
 * end-to-end by the Checkpoint D browser pass.
 */

/** Captures the context value from inside a static render. */
function captureCartValue() {
  let captured: ReturnType<typeof useCart> | undefined

  function Probe() {
    captured = useCart()
    return null
  }

  renderToStaticMarkup(
    <CartProvider>
      <Probe />
    </CartProvider>,
  )

  if (!captured) {
    throw new Error('the probe never rendered')
  }
  return captured
}

describe('CartProvider', () => {
  it('starts empty, with both derived values at zero', () => {
    const cart = captureCartValue()

    expect(cart.items).toEqual([])
    expect(cart.totalQuantity).toBe(0)
    expect(cart.subtotalMinor).toBe(0)
  })

  it('exposes exactly the approved Slice 7b API — no more, no less', () => {
    // `count` is gone, with no deprecated alias. `restoreItem` was added
    // deliberately in Slice 7b for the one-item undo. `setQuantity`,
    // `clearCart` and any undo stack were deliberately NOT added: no
    // consumer needs them, and an unused public method is an untested one.
    expect(Object.keys(captureCartValue()).sort()).toEqual([
      'addItem',
      'decrementItem',
      'incrementItem',
      'items',
      'removeItem',
      'restoreItem',
      'subtotalMinor',
      'totalQuantity',
    ])
  })

  it('exposes the five mutators as functions', () => {
    const cart = captureCartValue()

    expect(cart.addItem).toBeTypeOf('function')
    expect(cart.incrementItem).toBeTypeOf('function')
    expect(cart.decrementItem).toBeTypeOf('function')
    expect(cart.removeItem).toBeTypeOf('function')
    expect(cart.restoreItem).toBeTypeOf('function')
  })

  it('takes (item, index) on restoreItem — the snapshot and its original position', () => {
    expect(captureCartValue().restoreItem).toHaveLength(2)
  })

  it('reads and writes no client storage', () => {
    // In-memory only, by decision — the accepted server-side session cart
    // stays the eventual single source of truth.
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() }
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('sessionStorage', storage)

    captureCartValue()

    expect(storage.getItem).not.toHaveBeenCalled()
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(storage.removeItem).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
  })
})

/**
 * 🔴 The provider derives `totalQuantity`/`subtotalMinor` by calling
 * `getTotalQuantity(state)`/`getSubtotalMinor(state)` on whatever
 * `cartReducer` returned — see CartContext.tsx. A static render cannot
 * dispatch, so the post-restore values are asserted over that exact
 * composition instead of through a mounted provider. This is the same code
 * path, not a re-implementation: the reducer and both selectors are the real
 * modules, and the browser pass covers the mounted behaviour end to end.
 */
describe('the values CartProvider derives, after a restore', () => {
  const ITEM: CartItem = {
    slug: 'solgar-omega-3',
    name: 'אומגה 3',
    brandName: 'סולגאר',
    imageFile: null,
    packageQuantity: 100,
    unitPriceMinor: 9490,
    stockQuantity: 60,
    lowStockThreshold: 5,
    quantity: 2,
  }

  it('returns the removed line to the totals it left', () => {
    const withItem = cartReducer(EMPTY_CART, { type: 'restore', item: ITEM, index: 0 })
    expect(getTotalQuantity(withItem)).toBe(2)
    expect(getSubtotalMinor(withItem)).toBe(18_980)

    const removed = cartReducer(withItem, { type: 'remove', slug: ITEM.slug })
    expect(getTotalQuantity(removed)).toBe(0)
    expect(getSubtotalMinor(removed)).toBe(0)

    const restored = cartReducer(removed, { type: 'restore', item: ITEM, index: 0 })
    expect(getTotalQuantity(restored)).toBe(2)
    expect(getSubtotalMinor(restored)).toBe(18_980)
  })

  it('leaves the totals untouched when the restore is refused', () => {
    const withItem = cartReducer(EMPTY_CART, { type: 'restore', item: ITEM, index: 0 })

    // Same slug already present — a stale undo.
    const refused = cartReducer(withItem, { type: 'restore', item: ITEM, index: 0 })

    expect(refused).toBe(withItem)
    expect(getTotalQuantity(refused)).toBe(2)
    expect(getSubtotalMinor(refused)).toBe(18_980)
  })
})

describe('useCart', () => {
  it('throws a named error when used outside a CartProvider', () => {
    function Orphan() {
      useCart()
      return null
    }

    // React logs the thrown error itself; silence it so the suite output
    // stays readable without swallowing the assertion.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => renderToStaticMarkup(<Orphan />)).toThrow('useCart must be used within a CartProvider')

    error.mockRestore()
  })
})
