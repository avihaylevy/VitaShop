import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Cart, CartFailure, CartMutationOutcome, CartResult } from '../types/cart'
import { EMPTY_CART } from '../types/cart'
import { addCartItem, fetchCart, removeCartLine, setCartLineQuantity } from '../lib/cartApi'

/**
 * The cart — MILESTONE-007 Checkpoint G.
 *
 * 🔴 THE SERVER IS THE CART. This file replaced a `useReducer` prototype that
 * held slugs, names, stock snapshots and PRICES in browser memory (DEC-044/045).
 * Under §3.4 a browser holding prices is a client asserting money, so the
 * prototype was never the target — §7.1 says it is REPLACED, not extended, and
 * its state layer is deleted rather than left beside this one. Two sources of
 * cart truth is the exact defect class the six server checkpoints removed.
 *
 * What that means concretely, and none of it is optional:
 *
 *   · every quantity on screen is one the server RETURNED, including one it
 *     clamped to less than the shopper asked for
 *   · no mutation patches local state. The whole cart is replaced from the
 *     response, so the client cannot hold a quantity the server did not just
 *     state
 *   · `outcome` carries what the server CHANGED — clampedByCap,
 *     clampedByStock, alreadyAtMaximum, removed, unchanged. §7.16: these exist
 *     so the UI can SAY what happened, and dropping them re-creates the silent
 *     loss the server work removed
 *   · three states the prototype never had to handle, because memory never
 *     fails: LOADING, EMPTY and FAILED
 *
 * 🔴 NO STORAGE. No localStorage, sessionStorage, IndexedDB or client-written
 * cookie. Cart identity is the HttpOnly session cookie, which this code cannot
 * read — which is also why a second tab shows the SAME cart rather than
 * resurrecting a stale copy of its own.
 */

export type CartStatus = 'loading' | 'ready' | 'error'

type CartContextValue = {
  status: CartStatus
  cart: Cart
  /** The last failure, from the load or from a mutation. Never invented. */
  failure: CartFailure | null
  /** 🔴 What the server last changed that the shopper did not ask for. */
  outcome: CartMutationOutcome | null
  /** True while a mutation is in flight, so controls can be disabled honestly. */
  pending: boolean
  /**
   * 🔴 Returns the SERVER's answer, not a boolean success flag. The caller
   * needs the settled quantity and the resulting cart to say what happened —
   * `null` means the request failed and nothing changed.
   */
  addItem: (slug: string, quantity?: number, subject?: string) => Promise<MutationResult | null>
  setLineQuantity: (lineId: string, subject: string, quantity: number) => Promise<MutationResult | null>
  removeLine: (lineId: string, subject: string) => Promise<MutationResult | null>
  refresh: () => Promise<void>
  /** Clears the last outcome once the UI has said it. */
  dismissOutcome: () => void
}

type MutationResult = { cart: Cart; outcome: CartMutationOutcome }

const CartContext = createContext<CartContextValue | null>(null)

export function CartProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<CartStatus>('loading')
  const [cart, setCart] = useState<Cart>(EMPTY_CART)
  const [failure, setFailure] = useState<CartFailure | null>(null)
  const [outcome, setOutcome] = useState<CartMutationOutcome | null>(null)
  const [pending, setPending] = useState(false)

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  /**
   * 🔴 Mutations are SERIALIZED, and this is not defensive habit. Two adds in
   * flight at once return two whole carts; whichever settles last wins, and
   * under the network that is not necessarily the one issued last. The prototype
   * needed a FIFO attempt queue for the same reason and could only guess at
   * success by comparing totals before and after. Here the server ANSWERS, so
   * the chain is all that is required — one request at a time, in click order.
   */
  const chainRef = useRef<Promise<unknown>>(Promise.resolve())

  const runExclusive = useCallback(<T,>(work: () => Promise<T>): Promise<T> => {
    const next = chainRef.current.then(work, work)
    chainRef.current = next.catch(() => undefined)
    return next
  }, [])

  const refresh = useCallback(async () => {
    const result = await runExclusive(fetchCart)
    if (!mountedRef.current) return
    if (result.ok) {
      setCart(result.value)
      setFailure(null)
      setStatus('ready')
    } else {
      // 🔴 The cart is NOT emptied on a failed load. An empty cart and an
      // unreachable one look identical on screen otherwise, and "your cart is
      // empty" is a claim the client has no standing to make here.
      setFailure(result.failure)
      setStatus('error')
    }
  }, [runExclusive])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /** One shape for all three mutations: run, replace the cart, record what changed. */
  const applyMutation = useCallback(
    async (work: () => Promise<CartResult<MutationResult>>): Promise<MutationResult | null> => {
      setPending(true)
      const result = await runExclusive(work)
      if (!mountedRef.current) return null
      setPending(false)

      if (!result.ok) {
        setFailure(result.failure)
        // 🔴 The last known cart STAYS on screen. A failed mutation changed
        // nothing server-side, so blanking the cart would report a loss that
        // did not happen. `status` stays 'ready' when a cart was already loaded.
        setOutcome(null)
        return null
      }

      setCart(result.value.cart)
      setOutcome(result.value.outcome)
      setFailure(null)
      setStatus('ready')
      return result.value
    },
    [runExclusive],
  )

  const addItem = useCallback(
    // 🔴 `subject` is what a message CALLS the product. The browser pass caught
    // an undo reporting "altman-probiotic-intense-30 ... 1 in stock": the line
    // had just been removed, so no name was resolvable from the cart, and the
    // caller is the only place that still holds one.
    (slug: string, quantity = 1, subject?: string) =>
      applyMutation(() => addCartItem(slug, quantity, subject ?? slug)),
    [applyMutation],
  )

  const setLineQuantity = useCallback(
    (lineId: string, subject: string, quantity: number) =>
      applyMutation(() => setCartLineQuantity(lineId, subject, quantity)),
    [applyMutation],
  )

  const removeLine = useCallback(
    (lineId: string, subject: string) => applyMutation(() => removeCartLine(lineId, subject)),
    [applyMutation],
  )

  const dismissOutcome = useCallback(() => setOutcome(null), [])

  const value = useMemo<CartContextValue>(
    () => ({
      status,
      cart,
      failure,
      outcome,
      pending,
      addItem,
      setLineQuantity,
      removeLine,
      refresh,
      dismissOutcome,
    }),
    [status, cart, failure, outcome, pending, addItem, setLineQuantity, removeLine, refresh, dismissOutcome],
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
