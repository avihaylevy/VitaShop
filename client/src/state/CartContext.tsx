import { createContext, useContext, useMemo, useReducer, type ReactNode } from 'react'

/**
 * Count-only interim state for the header cart badge
 * (UI_IMPLEMENTATION_PLAN.md §4 lists `CartProvider` as the eventual home
 * of full cart contents/reducer — that lands with the cart page itself,
 * build order step 7). Nothing here computes a price or a stock decision;
 * §4's rule that the server is the source of truth for those is not
 * touched by this slice, since there is no server cart integration yet.
 */

type CartState = { count: number }

type CartAction = { type: 'add'; quantity?: number } | { type: 'remove'; quantity?: number } | { type: 'set'; count: number }

function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'add':
      return { count: state.count + (action.quantity ?? 1) }
    case 'remove':
      return { count: Math.max(0, state.count - (action.quantity ?? 1)) }
    case 'set':
      return { count: Math.max(0, action.count) }
  }
}

type CartContextValue = {
  count: number
  addItem: (quantity?: number) => void
  removeItem: (quantity?: number) => void
}

const CartContext = createContext<CartContextValue | null>(null)

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(cartReducer, { count: 0 })

  const value = useMemo<CartContextValue>(
    () => ({
      count: state.count,
      addItem: (quantity) => dispatch({ type: 'add', quantity }),
      removeItem: (quantity) => dispatch({ type: 'remove', quantity }),
    }),
    [state.count],
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
