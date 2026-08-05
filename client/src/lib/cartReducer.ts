import type { CartItem, CartState } from '../types/cart'
import type { ProductCardModel } from '../types/product'
import { isValidQuantity, parsePriceToMinor } from './money'

/**
 * Pure cart reducer and selectors — Slice 7.
 *
 * 🔴 Scope constraint (CLAUDE.md rule 1 / spec §3.4 /
 * UI_IMPLEMENTATION_PLAN.md §4): the server remains the source of truth for
 * price, stock and totals. The stock ceiling enforced here is a UI
 * affordance, not a stock decision — it is re-validated server-side the
 * moment a cart API exists (REQ-F-022), and `subtotalMinor` is rendered
 * nowhere in Slice 7. This is an interim client-domain layer, not an
 * override of §3.4.
 *
 * Every invalid transition returns the *existing* state object unchanged,
 * so a rejected action is both referentially detectable and incapable of
 * letting corrupt data into the cart. Nothing is coerced, defaulted or
 * repaired.
 */

export const EMPTY_CART: CartState = { items: [] }

export type CartAction =
  | { type: 'add'; product: ProductCardModel }
  | { type: 'increment'; slug: string }
  | { type: 'decrement'; slug: string }
  | { type: 'remove'; slug: string }

/**
 * Dev-only diagnostics. Production stays silent: a rejected transition is
 * already a no-op, and a shopper has nothing to act on.
 */
function warnInDev(message: string) {
  if (import.meta.env.DEV) {
    console.warn(`[cart] ${message}`)
  }
}

/**
 * 🔴 Prospective-state validation (Codex review round 2, Checkpoint B).
 *
 * Every state-changing path routes its candidate through here, so the
 * reducer can never produce a state its own derived selectors would reject.
 * A candidate that fails is discarded whole: the ORIGINAL state object is
 * returned, referentially unchanged. Nothing is partially applied, clamped,
 * repaired, or written back with a reduced quantity or stock.
 *
 * Only `RangeError` — the selectors' own integrity signal — is caught. Any
 * other error is a programmer error and propagates untouched.
 *
 * 🔴 If `previous` is itself invalid, the corruption did not come from this
 * transition. Re-running the selectors over it rethrows, so externally
 * constructed corrupt state still fails loudly instead of being laundered
 * into a "successful" no-op.
 *
 * Private by design: the selectors remain the public fail-loud boundary.
 */
function acceptCandidateState(previous: CartState, candidate: CartState): CartState {
  try {
    getTotalQuantity(candidate)
    getSubtotalMinor(candidate)
    return candidate
  } catch (error) {
    if (!(error instanceof RangeError)) {
      throw error
    }

    // `previous` is already known good — `cartReducer` validated the incoming
    // state before dispatching — so this only ever discards a bad candidate.
    warnInDev('refused a transition: the resulting cart would exceed the safe integer range')
    return previous
  }
}

/**
 * 🔴 Incoming-state validation (Codex final review).
 *
 * Runs before ANY action is dispatched, so every code path — including the
 * early returns for an unknown slug, a decrement already at the minimum, and
 * a remove that matches nothing — fails loudly on corrupt input rather than
 * handing it back unchanged. A duplicate add can no longer overwrite a
 * corrupt line and quietly launder the state either.
 *
 * 🔴 This deliberately does NOT catch. The `RangeError` propagates to the
 * caller; it is never converted into a no-op, a clamp or a repair.
 */
function assertIncomingState(state: CartState): void {
  getTotalQuantity(state)
  getSubtotalMinor(state)
}

/** Replaces exactly one line, preserving order. */
function replaceItem(items: readonly CartItem[], index: number, next: CartItem): readonly CartItem[] {
  return items.map((item, i) => (i === index ? next : item))
}

function addProduct(state: CartState, product: ProductCardModel): CartState {
  const unitPriceMinor = parsePriceToMinor(product.price)
  if (unitPriceMinor === null) {
    // Reject before corrupt state enters the cart. No zero-price line, no
    // guessed price, no partial subtotal.
    warnInDev(`refused to add "${product.slug}": price is not a valid decimal string`)
    return state
  }

  if (!isValidQuantity(product.stockQuantity)) {
    // Covers out of stock (0), negative, fractional and non-finite stock.
    warnInDev(`refused to add "${product.slug}": stockQuantity is not a positive integer`)
    return state
  }

  const index = state.items.findIndex((item) => item.slug === product.slug)

  if (index === -1) {
    const item: CartItem = {
      slug: product.slug,
      name: product.name,
      brandName: product.brandName,
      imageFile: product.imageFile,
      packageQuantity: product.packageQuantity,
      unitPriceMinor,
      stockQuantity: product.stockQuantity,
      lowStockThreshold: product.lowStockThreshold,
      quantity: 1,
    }
    return acceptCandidateState(state, { items: [...state.items, item] })
  }

  // Duplicate add: one line per slug, never a second. The snapshot is
  // refreshed from the newest catalogue data — the latest fetch wins over
  // whatever was true when the line was created — and the quantity is then
  // re-clamped against it, which can lower an already-stale quantity.
  const existing = state.items[index]
  const quantity = Math.min(existing.quantity + 1, product.stockQuantity)

  // The refreshed snapshot is validated as a whole before it replaces the
  // line: a stale-stock refresh that would break the derived invariants is
  // rejected outright, leaving the old snapshot exactly as it was.
  return acceptCandidateState(state, {
    items: replaceItem(state.items, index, {
      ...existing,
      name: product.name,
      brandName: product.brandName,
      imageFile: product.imageFile,
      packageQuantity: product.packageQuantity,
      unitPriceMinor,
      stockQuantity: product.stockQuantity,
      lowStockThreshold: product.lowStockThreshold,
      quantity,
    }),
  })
}

function changeQuantity(state: CartState, slug: string, delta: 1 | -1): CartState {
  const index = state.items.findIndex((item) => item.slug === slug)
  if (index === -1) {
    return state
  }

  const existing = state.items[index]
  // Minimum is 1 and the ceiling is this line's stock. A line never reaches
  // 0: decrement at the minimum is a no-op, and removal is only ever the
  // explicit `remove` action (DESIGN_SYSTEM.md §8 — removal is a separately
  // named, reversible control, so the minus button must not double as one).
  const quantity = Math.min(Math.max(existing.quantity + delta, 1), existing.stockQuantity)

  if (quantity === existing.quantity) {
    return state
  }

  return acceptCandidateState(state, { items: replaceItem(state.items, index, { ...existing, quantity }) })
}

export function cartReducer(state: CartState, action: CartAction): CartState {
  // 🔴 Before anything else, and for every action without exception.
  assertIncomingState(state)

  switch (action.type) {
    case 'add':
      return addProduct(state, action.product)
    case 'increment':
      return changeQuantity(state, action.slug, 1)
    case 'decrement':
      return changeQuantity(state, action.slug, -1)
    case 'remove': {
      const next = state.items.filter((item) => item.slug !== action.slug)
      // Routed through the same helper as every other path, for one
      // consistent boundary — a removal only ever shrinks the totals, so it
      // is never the transition that gets rejected.
      return next.length === state.items.length ? state : acceptCandidateState(state, { items: next })
    }
  }
}

/**
 * 🔴 Selector failure policy (Codex review, Checkpoint B).
 *
 * Both selectors below validate every operand and every intermediate result,
 * and throw `RangeError` rather than returning a value they cannot vouch for.
 * They never clamp, never round, never return a partial sum, never fall back
 * to zero and never return the previous accumulator. A wrong badge count or a
 * wrong subtotal is worse than a loud failure: it is a number a shopper would
 * believe.
 *
 * Messages name the slug only — never a price, a quantity or any product
 * content — so a thrown error is deterministic and discloses nothing.
 *
 * Neither guard is reachable from a reducer-produced state: `addProduct`
 * bounds `unitPriceMinor` through `parsePriceToMinor` and refuses any
 * `stockQuantity` that is not a positive safe integer, and quantity is
 * clamped into `[1, stockQuantity]` on every transition. The guards exist for
 * state that did not come from this reducer.
 */

/**
 * Total units across every line — the Header badge's value. Derived on
 * every read, never stored as a separate mutable count, so it cannot drift
 * from the items it summarises.
 */
export function getTotalQuantity(state: CartState): number {
  let total = 0

  for (const item of state.items) {
    if (!isValidQuantity(item.quantity)) {
      throw new RangeError(`cart line "${item.slug}" has an invalid quantity`)
    }

    const nextTotal = total + item.quantity
    if (!Number.isSafeInteger(nextTotal)) {
      throw new RangeError(`cart total quantity exceeded the safe integer range at line "${item.slug}"`)
    }

    total = nextTotal
  }

  return total
}

/**
 * Subtotal in agorot. Integer multiply and add throughout — exact, with no
 * floating-point accumulation.
 *
 * 🔴 Not rendered anywhere in Slice 7, by decision. A server-authoritative
 * total supersedes this for anything displayed once a cart API exists.
 */
export function getSubtotalMinor(state: CartState): number {
  let subtotal = 0

  for (const item of state.items) {
    if (!Number.isSafeInteger(item.unitPriceMinor) || item.unitPriceMinor < 0) {
      throw new RangeError(`cart line "${item.slug}" has an invalid unit price`)
    }

    if (!isValidQuantity(item.quantity)) {
      throw new RangeError(`cart line "${item.slug}" has an invalid quantity`)
    }

    // Both operands are validated before the multiply, and the product is
    // validated before it is accumulated: a product above 2^53 lands outside
    // the safe range, so `isSafeInteger` catches it rather than silently
    // returning a rounded float.
    const lineTotal = item.unitPriceMinor * item.quantity
    if (!Number.isSafeInteger(lineTotal)) {
      throw new RangeError(`cart line "${item.slug}" exceeded the safe integer range`)
    }

    const nextSubtotal = subtotal + lineTotal
    if (!Number.isSafeInteger(nextSubtotal)) {
      throw new RangeError(`cart subtotal exceeded the safe integer range at line "${item.slug}"`)
    }

    subtotal = nextSubtotal
  }

  return subtotal
}
