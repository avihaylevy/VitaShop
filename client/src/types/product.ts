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
  /**
   * The thirteenth list — the unit the QUANTITY is measured in, when it is
   * not a count: drops are volume ("250 מ״ל"), never "250 טיפות". Localised
   * at mapping time; undefined for countable forms, where the quantity
   * segment keeps pairing with the dosage-form label.
   */
  packageUnit?: string
  imageFile: string | null
}

/**
 * MILESTONE-005 Checkpoint J — the Product Details view-model (§7a).
 *
 * Extends `ProductCardModel` for the same reason the server's
 * `PublicProductDetail` extends `PublicCatalogProduct`: the shared fields
 * have ONE definition, so a card and a detail page can never disagree about
 * what a product's name or price is.
 *
 * Already language-resolved, like the card model — the bilingual pairs
 * (`descriptionHe`/`descriptionEn`, health-goal names) collapse to one
 * string here, while the Hebrew-only manufacturer texts (`usageInstructions`,
 * `warningsAllergens`) are carried as-is because the schema stores a single
 * language for them. `price` stays a string for the same reason as above.
 */
export type ProductDetailModel = ProductCardModel & {
  /** §7b field 01 — display/read-only. Never sent back to any endpoint. */
  serialNumber: string
  usageInstructions: string
  /** Ordered image basenames; the first is the same one the card shows. */
  images: string[]
  description: string
  warningsAllergens: string
  /** DEC-032 DECISION B — provenance, not absence. See `ProductDetailDto`. */
  allergenInfoIncomplete: boolean
  ingredients: { name: string; amount: string; unit: string }[]
  /** Language-resolved health-goal labels; may legitimately be empty. */
  healthGoals: string[]
  targetAudience: string | null
  /** ISO 8601, as received — formatting is the view's decision, not the mapper's. */
  createdAt: string
}
