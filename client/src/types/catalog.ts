/**
 * Wire-format DTOs for the catalogue API (server/src/routes/catalog.ts,
 * Slice 6 Checkpoint A/B). Deliberately separate from `ProductCardModel`
 * (types/product.ts): the DTO is bilingual and server-shaped (both
 * `nameHe`/`nameEn`, a raw `dosageForm` enum key); the card model is
 * already language-resolved for rendering. `mapCatalogProduct` bridges them.
 */

export type DosageFormKey = 'CAPSULE' | 'TABLET' | 'DROPS' | 'POWDER' | 'SYRUP'

export interface CatalogProductDto {
  slug: string
  nameHe: string
  nameEn: string
  categoryNameHe: string
  categoryNameEn: string
  categorySlug: string
  brandName: string
  /**
   * ISSUE-127a — the brand's manufacturer-verified Latin form, null when
   * none is sourced. Display picks it for the English UI.
   */
  brandNameEn: string | null
  dosageForm: DosageFormKey
  packageQuantity: number
  /** Server-serialized via Prisma Decimal.toFixed(2) — never parse as a number here. */
  price: string
  stockQuantity: number
  lowStockThreshold: number
  imageFile: string | null
}

/**
 * §6b — computed only when a validated, successful query yields
 * totalItems === 0. Ignores every narrowing filter except category; never
 * substituted into `items`/`totalItems`/`totalPages`.
 */
export interface CatalogFallbackDto {
  kind: 'category' | 'popular'
  items: CatalogProductDto[]
  limit: number
}

export interface CatalogProductsEnvelope {
  items: CatalogProductDto[]
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
  fallback: CatalogFallbackDto | null
}

/** §7a field 13 — one active ingredient with its amount. */
export interface ProductIngredientDto {
  name: string
  /** Server-serialized via Prisma Decimal.toFixed(2) — never parse as a number here. */
  amount: string
  unit: string
}

/** §7a field 14 — a health goal, bilingual (DEC-017 pairing). */
export interface ProductHealthGoalDto {
  nameHe: string
  nameEn: string
}

/**
 * MILESTONE-005 §7 — `GET /api/products/:slug`. Mirrors the server's
 * `PublicProductDetail`, which EXTENDS the list DTO, so this extends
 * `CatalogProductDto` for the same reason: shared fields cannot drift
 * between list and detail.
 *
 * 🔴 `serialNumber` (§7b field 01) is display/read-only. It is never sent
 * back to any endpoint, never a route key, and absent from the list DTO.
 */
export interface ProductDetailDto extends CatalogProductDto {
  serialNumber: string
  usageInstructions: string
  /** Field 10 — image basenames, ordered; the list DTO carries only the first. */
  images: string[]
  descriptionHe: string
  descriptionEn: string
  warningsAllergens: string
  /**
   * DEC-032 DECISION B — 🔴 PROVENANCE, NOT ABSENCE. True means the
   * manufacturer's page was checked and `warningsAllergens` already holds
   * everything it publishes, which may be partial or empty. It composes with
   * that field rather than replacing it, and a true value must NEVER render
   * as an empty allergen section.
   */
  allergenInfoIncomplete: boolean
  ingredients: ProductIngredientDto[]
  healthGoals: ProductHealthGoalDto[]
  /** Field 15 — null is a real value, not an omission. */
  targetAudience: string | null
  /** Field 16 — ISO 8601 string. */
  createdAt: string
}

/**
 * §9d — `GET /api/catalog/facets`. One read-only endpoint, returned
 * UNWRAPPED (no `items` envelope), matching server/src/routes/catalog.ts.
 *
 * 🔴 The `id` (or `value` for dosage forms) is the filter value submitted
 * back in the query string (§4b — stable IDs, never display names); the
 * label is for rendering only. There are deliberately NO counts (§12,
 * inventory leakage). Categories are NOT here — they stay on the existing
 * `GET /api/categories` (DEC-042).
 */
export interface CatalogFacetOptionDto {
  id: string
  label: string
}

/**
 * Sixth defect list item 1 — the brand facet carries the DEC-080 Latin form
 * so the English UI's filter rail never lists a Hebrew brand name. Nullable:
 * no sourced Latin form means the stored name serves both languages.
 */
export interface CatalogBrandFacetOptionDto {
  id: string
  label: string
  labelEn: string | null
}

export interface CatalogBilingualFacetOptionDto {
  id: string
  labelHe: string
  labelEn: string
}

export interface CatalogDosageFormFacetDto {
  value: DosageFormKey
  labelHe: string
  labelEn: string
}

/** DEC-078/DEC-083 — the three dietary filter values, server offer order. */
export const DIETARY_FACET_VALUES = ['kosher', 'glutenFree', 'vegan'] as const
export type DietaryFacetValue = (typeof DIETARY_FACET_VALUES)[number]

export interface CatalogDietaryFacetDto {
  value: DietaryFacetValue
  labelHe: string
  labelEn: string
}

export interface CatalogFacetsDto {
  brands: CatalogBrandFacetOptionDto[]
  ingredients: CatalogFacetOptionDto[]
  healthGoals: CatalogBilingualFacetOptionDto[]
  dosageForms: CatalogDosageFormFacetDto[]
  /**
   * Only the flags at least one active product carries `true` — the server
   * never offers an option that can match nothing (§9d / ISSUE-051), so an
   * absent value here means "no sourced data yet", and the UI renders no
   * checkbox for it.
   */
  dietary: CatalogDietaryFacetDto[]
}

export interface CatalogCategoryDto {
  slug: string
  nameHe: string
  nameEn: string
}

export interface CatalogCategoriesEnvelope {
  items: CatalogCategoryDto[]
}

/** API_CONTRACT.md error envelope: `{ error: { code, message, fields? } }`. */
export interface CatalogApiErrorBody {
  error: {
    code: string
    message: string
    fields?: string[]
  }
}
