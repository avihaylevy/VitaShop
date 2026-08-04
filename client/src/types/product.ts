/**
 * ProductCard/ProductGrid view-model. design/DESIGN_SYSTEM.md §6 (Accepted,
 * DEC-035) and technical/UI_IMPLEMENTATION_PLAN.md §14 step 5.
 *
 * Deliberately narrower than the Prisma `Product` model: this is what a
 * card is allowed to render, not the full row. Fields whose documented
 * fallback is "omit the segment" are optional; fields the card cannot
 * render without are required.
 *
 * `price` is a string, not a number — Prisma's `Decimal` serialises as a
 * string over JSON, and this type must never invite client-side price
 * arithmetic (CLAUDE.md rule 1 / spec §3.4: price is server-side only).
 */
export type ProductCardModel = {
  slug: string
  name: string
  categoryNameHe: string
  categoryName: string
  price: string
  stockQuantity: number
  lowStockThreshold: number
  brandName?: string
  dosageForm?: string
  packageQuantity?: number
  imageFile: string | null
}
