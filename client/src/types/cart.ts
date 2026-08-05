/**
 * Cart domain types — Slice 7 (UI_IMPLEMENTATION_PLAN.md build-order step 7,
 * partial: context only, no CartItemRow/QuantityStepper/cart page).
 *
 * Deliberately narrower than `ProductCardModel`: a cart line stores what a
 * future CartItemRow needs to render without a refetch, and nothing else.
 * No description, ingredients, warnings, allergens, health goals, dosage
 * form or category data — those are catalogue concerns, and reproducing
 * medical content in a commerce surface is out of scope by rule.
 *
 * 🔴 `unitPriceMinor` is an integer count of agorot, never a float and never
 * a price string parsed with `Number`/`parseFloat`. See lib/money.ts.
 */

export type CartItem = {
  /** Identity. Matches `ProductCardModel.slug` and the /product/:slug route. */
  slug: string
  /**
   * Snapshots taken at add time. `name` is already language-resolved by
   * `mapCatalogProduct`, so a language toggle does NOT retranslate an
   * existing line — a known, recorded limitation, not a bug to paper over
   * with an invented replacement name.
   */
  name: string
  brandName?: string
  imageFile: string | null
  packageQuantity?: number
  /** Integer agorot. Validated before the line is ever created. */
  unitPriceMinor: number
  /**
   * Refreshed from the newest observed catalogue data on every add — the
   * latest fetch wins over the snapshot taken when the line was created.
   */
  stockQuantity: number
  lowStockThreshold: number
  /** Always a positive integer, always <= stockQuantity. Never 0. */
  quantity: number
}

export type CartState = {
  items: readonly CartItem[]
}
