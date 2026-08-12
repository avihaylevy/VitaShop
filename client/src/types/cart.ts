/**
 * Cart domain types — MILESTONE-007 Checkpoint G.
 *
 * 🔴 THESE MIRROR THE SERVER'S DTO AND NOTHING ELSE. The Slice 7 prototype's
 * `CartItem` (slug · name · unitPriceMinor · stockQuantity snapshots, held in
 * browser memory) is GONE, not extended: §3.4 makes a browser that holds prices
 * a client asserting money, and two sources of cart truth is the defect class
 * MILESTONE-007 spent six passes removing from the server.
 *
 * 🔴 NOTHING HERE IS A SNAPSHOT. Every field is what the server said on the
 * last response. The client stores no price, no stock and no quantity of its
 * own, and never repairs, clamps or defaults a value it was given.
 */

/** One cart line, exactly as `GET /api/cart` reports it. */
export type CartLine = {
  /** The LINE's id — what `PATCH`/`DELETE /api/cart/items/:id` address. */
  id: string
  productId: string
  slug: string
  nameHe: string
  nameEn: string
  brandName: string
  packageQuantity: number
  imageFile: string | null
  quantity: number
  /** Canonical two-decimal string, live from the product row. Never a number. */
  unitPrice: string
  /** Computed SERVER-SIDE. The client does not multiply money. */
  lineTotal: string
  isActive: boolean
  stockQuantity: number
  lowStockThreshold: number
}

/**
 * DEC-058 — shipping, computed SERVER-SIDE and reported whole.
 *
 * 🔴 Every figure here arrives finished. The client does not compare `basis`
 * to `threshold`, does not subtract to find the remainder, and does not decide
 * whether shipping is free — §3.4, and a browser that adds up shipping is a
 * browser asserting a price.
 */
export type Shipping = {
  /**
   * 🔴 The total the threshold measures — ACTIVE lines ONLY, so it can be
   * LESS than `subtotal` when a withdrawn line is in the cart. The UI must say
   * so: two unexplained numbers on one screen read as a bug.
   */
  basis: string
  cost: string
  isFree: boolean
  threshold: string
  remainingForFree: string
  /** False for an empty cart and for a cart of only withdrawn lines. */
  hasShippableLines: boolean
}

export type Cart = {
  items: readonly CartLine[]
  totalQuantity: number
  /** ⚠️ ALL lines, withdrawn included (C3). NOT the shipping basis. */
  subtotal: string
  /** 🔴 C3: true when any line's product is inactive. Checkout is blocked. */
  hasBlockingLine: boolean
  shipping: Shipping
}

/**
 * 🔴 WHAT THE SERVER CHANGED THAT THE SHOPPER DID NOT ASK FOR.
 *
 * These flags exist so the UI can SAY what happened. `clampedByCap` /
 * `clampedByStock` / `alreadyAtMaximum` come straight from the add and update
 * responses; dropping them on the floor re-creates exactly the silent loss the
 * server work removed.
 */
export type CartMutationOutcome = {
  /** The slug or line the outcome is about, so a message can name it. */
  subject: string
  /** 🔴 The quantity the SERVER settled on — never the one the shopper typed. */
  quantity: number
  clampedByCap: boolean
  clampedByStock: boolean
  alreadyAtMaximum: boolean
  removed: boolean
  unchanged: boolean
}

/** Why a cart request failed. Never a reason invented by the client. */
export type CartFailure =
  | { kind: 'network' }
  | { kind: 'notFound' }
  | { kind: 'outOfStock' }
  | { kind: 'server' }

export type CartResult<T> = { ok: true; value: T } | { ok: false; failure: CartFailure }

/**
 * The login response's cart report — `merged`, `clampedSlugs`, `dropped` and
 * `mergeFailed`, all produced at the MERGE-GUEST-CART seam.
 *
 * 🔴 There is deliberately NO registration equivalent. Registration answers an
 * identical body whether or not the account already existed (DEC-053 clause 4b);
 * adding a cart report there would re-open the enumeration oracle ISSUE-067
 * closed.
 */
export type CartMergeReport = {
  mergeFailed: boolean
  merged: boolean
  clampedSlugs: string[]
  dropped: { slug: string; reason: 'INACTIVE' | 'UNAVAILABLE' }[]
}

export const EMPTY_CART: Cart = {
  items: [],
  totalQuantity: 0,
  subtotal: '0.00',
  hasBlockingLine: false,
  shipping: {
    basis: '0.00',
    cost: '0.00',
    isFree: false,
    threshold: '249.00',
    remainingForFree: '0.00',
    hasShippableLines: false,
  },
}
