import type { CartItem } from '../types/cart'
import { isValidQuantity, minorToPriceString } from './money'

/**
 * Cart display model — Slice 7b (technical/SLICE_7B_PLAN.md, Accepted).
 *
 * Pure mapping from the stored `CartItem` to exactly what a row renders. It
 * exists so `CartItemRow` holds no derivation of its own and so every
 * boundary rule below is covered by tests that need no renderer.
 *
 * 🔴 No money arithmetic happens here. `unitPrice` is the stored integer
 * agorot reconstructed into the canonical price string by `minorToPriceString`
 * so the existing `formatPrice`/`Intl.NumberFormat` path stays the single
 * display route. No line total is produced: the client does not multiply money
 * for display, and the only total Slice 7b shows is the reducer's own
 * `subtotalMinor` selector (DEC-045 as extended by the approved Slice 7b plan).
 *
 * 🔴 `maxQuantity` is a SNAPSHOT. It is the stock observed the last time this
 * product was seen in the catalogue, not live stock and not a server
 * validation. `/cart` performs no refresh, and REQ-F-022's server-side check
 * and clamp remain unimplemented.
 *
 * 🔴 Nothing here repairs, clamps or defaults. Corrupt data throws
 * `RangeError`, matching the reducer's selectors — a wrong price or a wrong
 * quantity on screen is worse than a loud failure, because a shopper would
 * believe it.
 */

export type CartLineDisplay = {
  slug: string
  /**
   * Language snapshot taken at add time (D4, accepted limitation): a line
   * added in Hebrew keeps its Hebrew name after a language switch. Displayed
   * exactly as stored — never retranslated, never replaced with an invented
   * name.
   */
  name: string
  brandName?: string
  packageQuantity?: number
  imageFile: string | null
  /** Canonical two-decimal string for `formatPrice`. Never a number. */
  unitPrice: string
  quantity: number
  /** The snapshot stock ceiling. No invented cap (DEC-044). */
  maxQuantity: number
  lowStockThreshold: number
  canDecrement: boolean
  canIncrement: boolean
  /** True when the quantity has reached the snapshot ceiling. */
  atStockCap: boolean
}

export function getCartLineDisplay(item: CartItem): CartLineDisplay {
  if (!isValidQuantity(item.quantity)) {
    throw new RangeError(`cart line "${item.slug}" has an invalid quantity`)
  }

  if (!isValidQuantity(item.stockQuantity)) {
    throw new RangeError(`cart line "${item.slug}" has an invalid stock quantity`)
  }

  // 🔴 The accepted cart invariant (DEC-044): a line's quantity never exceeds
  // that line's stock snapshot. Both operands being individually valid is not
  // enough — `quantity: 5, stockQuantity: 3` is corrupt state, and rendering
  // it would silently present it as an at-stock-cap line, quietly laundering
  // a broken invariant into a plausible-looking row. Rejected outright: not
  // clamped, not repaired, not rendered.
  if (item.quantity > item.stockQuantity) {
    throw new RangeError(`cart line "${item.slug}" has a quantity above its stock quantity`)
  }

  return {
    slug: item.slug,
    name: item.name,
    brandName: item.brandName,
    packageQuantity: item.packageQuantity,
    imageFile: item.imageFile,
    // Throws on a non-integer or negative value rather than formatting one.
    unitPrice: minorToPriceString(item.unitPriceMinor),
    quantity: item.quantity,
    maxQuantity: item.stockQuantity,
    lowStockThreshold: item.lowStockThreshold,
    // Derived, never passed in: a disabled state that disagrees with the
    // number beside it is the classic stepper bug.
    canDecrement: item.quantity > 1,
    canIncrement: item.quantity < item.stockQuantity,
    atStockCap: item.quantity >= item.stockQuantity,
  }
}

export function getCartLines(items: readonly CartItem[]): CartLineDisplay[] {
  return items.map(getCartLineDisplay)
}

export function isCartEmpty(items: readonly CartItem[]): boolean {
  return items.length === 0
}

/** Distinct product lines, NOT total units — the badge already counts units. */
export function getCartLineCount(items: readonly CartItem[]): number {
  return items.length
}
