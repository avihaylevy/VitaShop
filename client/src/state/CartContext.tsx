import { createContext, useCallback, useContext, useMemo, useReducer, type ReactNode } from 'react'
import type { CartItem } from '../types/cart'
import type { ProductCardModel } from '../types/product'
import { cartReducer, EMPTY_CART, getSubtotalMinor, getTotalQuantity } from '../lib/cartReducer'

/**
 * Real cart state — Slice 7 (UI_IMPLEMENTATION_PLAN.md §4, build-order
 * step 7, partial: context only; CartItemRow, QuantityStepper and the full
 * cart page are not in this slice, and CartDrawer is Slice 8).
 *
 * This file is deliberately thin. Every rule — identity, the stock ceiling,
 * the minimum of 1, duplicate handling, price validation, the safe-integer
 * guards — lives in `lib/cartReducer.ts`, where it is covered by pure tests
 * that need no renderer. What remains here is wiring.
 *
 * 🔴 The client is not a source of truth (CLAUDE.md rule 1 / spec §3.4).
 * The stock ceiling enforced below is a UI affordance, re-validated
 * server-side once a cart API exists (REQ-F-022). `subtotalMinor` is
 * exposed but rendered nowhere in Slice 7, by decision.
 *
 * 🔴 In-memory only, by decision. No localStorage, sessionStorage,
 * IndexedDB or cookie is read or written here — the cart resets on a full
 * reload, and the accepted server-side session cart (DEC-018/DEC-019)
 * remains the eventual single source of truth.
 */

type CartContextValue = {
  items: readonly CartItem[]
  addItem: (product: ProductCardModel) => void
  incrementItem: (slug: string) => void
  decrementItem: (slug: string) => void
  removeItem: (slug: string) => void
  /** Total units across every line — derived, never stored separately. */
  totalQuantity: number
  /** Integer agorot. Derived. Not rendered anywhere in Slice 7. */
  subtotalMinor: number
}

const CartContext = createContext<CartContextValue | null>(null)

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(cartReducer, EMPTY_CART)

  const addItem = useCallback((product: ProductCardModel) => dispatch({ type: 'add', product }), [])
  const incrementItem = useCallback((slug: string) => dispatch({ type: 'increment', slug }), [])
  const decrementItem = useCallback((slug: string) => dispatch({ type: 'decrement', slug }), [])
  const removeItem = useCallback((slug: string) => dispatch({ type: 'remove', slug }), [])

  const value = useMemo<CartContextValue>(
    () => ({
      items: state.items,
      addItem,
      incrementItem,
      decrementItem,
      removeItem,
      // Recomputed from the items on every state change rather than tracked
      // alongside them, so the badge cannot drift from the cart it counts.
      totalQuantity: getTotalQuantity(state),
      subtotalMinor: getSubtotalMinor(state),
    }),
    [state, addItem, incrementItem, decrementItem, removeItem],
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext)
  if (!context) {
    throw new Error('useCart must be used within a CartProvider')
  }
  return context
}
