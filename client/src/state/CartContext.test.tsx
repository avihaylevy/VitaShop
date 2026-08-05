import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
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

  it('exposes exactly the approved Slice 7 API — no more, no less', () => {
    // `count` is gone, with no deprecated alias. `setQuantity` and
    // `clearCart` were deliberately not added: no Slice 7 consumer needs
    // them, and an unused public method is an untested one.
    expect(Object.keys(captureCartValue()).sort()).toEqual([
      'addItem',
      'decrementItem',
      'incrementItem',
      'items',
      'removeItem',
      'subtotalMinor',
      'totalQuantity',
    ])
  })

  it('exposes the four mutators as functions', () => {
    const cart = captureCartValue()

    expect(cart.addItem).toBeTypeOf('function')
    expect(cart.incrementItem).toBeTypeOf('function')
    expect(cart.decrementItem).toBeTypeOf('function')
    expect(cart.removeItem).toBeTypeOf('function')
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
