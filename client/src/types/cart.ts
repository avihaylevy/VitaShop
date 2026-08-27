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
  /**
   * ISSUE-129 / DEC-080 — the manufacturer-verified Latin form, nullable like
   * the catalogue DTO's. The English UI prefers it; Hebrew keeps `brandName`.
   */
  brandNameEn: string | null
  packageQuantity: number
  /**
   * The raw dosage-form enum key ('DROPS', 'CAPSULE', …) — lets the row show
   * a VOLUME quantity as "250 מ״ל" like the card and detail page (the
   * thirteenth list). Optional in the type so older test fixtures stay
   * valid; the server always sends it.
   */
  dosageForm?: string
  imageFile: string | null
  quantity: number
  /** Canonical two-decimal string, live from the product row. Never a number. */
  unitPrice: string
  /**
   * The seventh list, item 2 — the UNDISCOUNTED unit price, always present.
   * Equal to `unitPrice` byte-for-byte when no discount applies; the row
   * strikes it through beside the member price when the two STRINGS differ.
   * 🔴 The client compares, never subtracts (§3.4).
   */
  baseUnitPrice: string
  /** Computed SERVER-SIDE. The client does not multiply money. */
  lineTotal: string
  isActive: boolean
  stockQuantity: number
  lowStockThreshold: number
}

/**
 * DEC-058 — shipping, computed SERVER-SIDE and reported whole.
 *
 * 🔴 Every figure here arrives finished. The client does not subtract to
 * find the remainder and does not decide whether shipping is free — §3.4,
 * and a browser that adds up shipping is a browser asserting a price.
 * ONE recorded exception (DEC-112): CartPage renders a DECORATIVE
 * progress bar whose width is basis/threshold — a visual ratio, aria-
 * hidden, never a displayed figure or a decision; `isFree` stays the
 * server's answer.
 */
export type Shipping = {
  /**
   * 🔴 The total the threshold measures — PURCHASABLE lines only, meaning
   * active AND stocked to the quantity asked for. So it can be LESS than
   * `subtotal` whenever a line cannot be bought, whether because the product
   * was withdrawn or because there is not enough of it. The UI must say so:
   * two unexplained numbers on one screen read as a bug.
   */
  basis: string
  cost: string
  isFree: boolean
  threshold: string
  remainingForFree: string
  /** False for an empty cart and for a cart with no purchasable line. */
  hasShippableLines: boolean
  /**
   * 🔴 Self pickup — nothing is being delivered, so the free-shipping threshold
   * is MOOT rather than unmet. Branch on this before rendering any "add ₪X more
   * for free shipping" prompt, or a pickup order is offered ₪0.00 more.
   */
  noDeliveryRequired: boolean
}

export type Cart = {
  items: readonly CartLine[]
  totalQuantity: number
  /**
   * M-012 Checkpoint C — whether the prices in this DTO are MEMBER prices.
   * Chooses COPY only (join hint vs member note); the client never derives
   * a discount from it (§3.4). ⚠️ An EMPTY cart reports false even for a
   * member (the server's empty constant) — hints render only beside items.
   */
  clubMember: boolean
  /**
   * The seventh list, item 2 — the club's worth on this cart, SERVER-computed
   * over the purchasable lines (§3.4: the client renders it, never derives
   * it). For a member: what the discount is saving now. For a non-member:
   * what joining would save on the same cart. '0.00' hides the row.
   */
  clubSavings: string
  /**
   * 🔴 PURCHASABLE LINES ONLY, and therefore EQUAL to `shipping.basis` —
   * DEC-059 answer 3, applied to the DTO at Checkpoint F1: an unpurchasable
   * line "contributes to nothing", which the decision says collapses the
   * subtotal and the basis into one number.
   *
   * ⚠️ This comment said the opposite until 2026-08-13 ("ALL lines,
   * unpurchasable included. NOT the shipping basis") and it was accurate then.
   * The line is STILL RENDERED — C3 stands, the cart does not hide what was
   * put in it — it simply counts toward nothing, and the row is what has to
   * say so (ISSUE-080).
   */
  subtotal: string
  /**
   * 🔴 C3 / DEC-059 answer 3: true when any line cannot be bought — the product
   * is inactive, OR there is less stock than the line asks for. Checkout is
   * blocked either way; the two read differently to a shopper, so the copy must
   * cover both without claiming one.
   */
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
  /**
   * ISSUE-073 — the names ride with the report, because a DROPPED line is in
   * no cart and the slug was the only thing left to show a shopper. Optional:
   * a missing or malformed name reads as absent, and the slug stays the last
   * resort rather than the first.
   */
  dropped: {
    slug: string
    nameHe?: string
    nameEn?: string
    reason: 'INACTIVE' | 'UNAVAILABLE'
  }[]
}

export const EMPTY_CART: Cart = {
  items: [],
  totalQuantity: 0,
  clubMember: false,
  clubSavings: '0.00',
  subtotal: '0.00',
  hasBlockingLine: false,
  shipping: {
    basis: '0.00',
    cost: '0.00',
    isFree: false,
    threshold: '249.00',
    remainingForFree: '0.00',
    hasShippableLines: false,
    noDeliveryRequired: false,
  },
}
