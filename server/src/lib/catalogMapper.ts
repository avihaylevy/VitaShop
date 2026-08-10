import type { Prisma } from '@prisma/client'
import { findCanonicalCategoryByNameHe } from './catalogCategories.js'

// Thrown when an active product's category is not one of the six REQ-F-001
// canonical categories. The route layer catches this and returns
// 500 CATALOG_DATA_INTEGRITY with no items — never a partial catalogue.
export class CatalogIntegrityError extends Error {
  readonly productSlug: string
  readonly categoryNameHe: string

  constructor(productSlug: string, categoryNameHe: string) {
    super(`Product "${productSlug}" has category "${categoryNameHe}", which is not in the canonical REQ-F-001 category list.`)
    this.name = 'CatalogIntegrityError'
    this.productSlug = productSlug
    this.categoryNameHe = categoryNameHe
  }
}

export type ProductWithCatalogRelations = Prisma.ProductGetPayload<{
  include: { category: true; brand: true; images: true }
}>

export interface PublicCatalogProduct {
  slug: string
  nameHe: string
  nameEn: string
  categoryNameHe: string
  categoryNameEn: string
  categorySlug: string
  brandName: string
  dosageForm: string
  packageQuantity: number
  price: string
  stockQuantity: number
  lowStockThreshold: number
  imageFile: string | null
}

/**
 * MILESTONE-005 Checkpoint J — the relations the DETAIL endpoint needs on
 * top of the list's. Field 13 (ingredients) and field 14 (health goals)
 * exist only here; the list DTO deliberately does not carry them.
 */
export type ProductWithDetailRelations = Prisma.ProductGetPayload<{
  include: {
    category: true
    brand: true
    images: true
    ingredients: { include: { activeIngredient: true } }
    healthGoals: { include: { healthGoal: true } }
  }
}>

/** Field 13 — one active ingredient with its amount. */
export interface PublicProductIngredient {
  name: string
  /** Prisma Decimal serialized with toFixed(2), never a float — same rule as `price`. */
  amount: string
  unit: string
}

/** Field 14 — a health goal, bilingual (DEC-017 pairing). */
export interface PublicProductHealthGoal {
  nameHe: string
  nameEn: string
}

/**
 * MILESTONE-005 §7 — the Product Details DTO. 🔴 It EXTENDS
 * `PublicCatalogProduct` rather than redeclaring the shared fields, exactly
 * as the frozen contract requires ("reuse, not a parallel definition, so
 * shared fields cannot drift between list and detail").
 *
 * 🔴 `serialNumber` is §7b's field 01 (D10, Option A): `Product.id`, exposed
 * read-only under a public name. The client never supplies, controls or
 * round-trips it; no endpoint accepts it as input; it is not a route key and
 * is absent from the list DTO, so it creates no enumeration surface.
 */
export interface PublicProductDetail extends PublicCatalogProduct {
  /** Field 01 — Product.id. Display/read-only. Never accepted as input. */
  serialNumber: string
  /** Field 07 — Hebrew-only manufacturer text (schema: not paired). */
  usageInstructions: string
  /** Field 10 — 1..4 image basenames, ordered. The list DTO gives only the first. */
  images: string[]
  /** Field 11 — paired, DEC-017. */
  descriptionHe: string
  descriptionEn: string
  /** Field 12 — Hebrew-only manufacturer text (schema: not paired). */
  warningsAllergens: string
  /** Field 13. */
  ingredients: PublicProductIngredient[]
  /** Field 14 — zero or more. */
  healthGoals: PublicProductHealthGoal[]
  /** Field 15 — nullable by schema; null is a real value here, not an omission. */
  targetAudience: string | null
  /** Field 16 — ISO 8601 string, never a Date instance across the wire. */
  createdAt: string
}

// Basename of a stored "assets/products/<file>" url. Never returns a path —
// only the filename, per the Slice 6 Checkpoint A contract.
function toImageFileBasename(url: string): string {
  const segments = url.split('/')
  return segments[segments.length - 1] ?? url
}

// §7a field 10's ordering — `sortOrder, id`. Defined once and used by BOTH
// the list's single image and the detail's full array, so the list can never
// show a different "first" image than the detail page's first.
function sortedImages(images: ProductWithCatalogRelations['images']): ProductWithCatalogRelations['images'] {
  return [...images].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
}

function firstImageFile(images: ProductWithCatalogRelations['images']): string | null {
  const [first] = sortedImages(images)
  return first ? toImageFileBasename(first.url) : null
}

// Throws CatalogIntegrityError if the product's category is not canonical —
// callers must not catch this per-product and skip the row; a single bad
// category fails the whole response (fail-closed, no partial catalogue).
export function mapProductToPublicCatalog(product: ProductWithCatalogRelations): PublicCatalogProduct {
  const canonicalCategory = findCanonicalCategoryByNameHe(product.category.nameHe)
  if (!canonicalCategory) {
    throw new CatalogIntegrityError(product.slug, product.category.nameHe)
  }

  return {
    slug: product.slug,
    nameHe: product.nameHe,
    nameEn: product.nameEn,
    categoryNameHe: product.category.nameHe,
    categoryNameEn: product.category.nameEn,
    categorySlug: canonicalCategory.slug,
    brandName: product.brand.name,
    dosageForm: product.dosageForm,
    packageQuantity: product.packageQuantity,
    price: product.price.toFixed(2),
    stockQuantity: product.stockQuantity,
    lowStockThreshold: product.lowStockThreshold,
    imageFile: firstImageFile(product.images),
  }
}

/**
 * MILESTONE-005 Checkpoint J — §7a's full 16-field detail mapping.
 *
 * 🔴 Built ON TOP of `mapProductToPublicCatalog`, not beside it: fields
 * 02–06, 08, 09 come from that call, so they cannot drift from the list.
 * The same fail-closed `CatalogIntegrityError` therefore applies here too —
 * a non-canonical category fails the detail response exactly as it fails the
 * list, rather than serving a product with an unmappable category.
 *
 * Determinism: ingredients sort by name, health goals by `nameHe`, images by
 * `sortOrder, id`. Nothing here depends on Prisma's row order.
 */
export function mapProductToPublicDetail(product: ProductWithDetailRelations): PublicProductDetail {
  return {
    ...mapProductToPublicCatalog(product),
    // Field 01 (§7b) — the existing Product.id under a public, read-only name.
    serialNumber: product.id,
    usageInstructions: product.usageInstructions,
    images: sortedImages(product.images).map((image) => toImageFileBasename(image.url)),
    descriptionHe: product.descriptionHe,
    descriptionEn: product.descriptionEn,
    warningsAllergens: product.warningsAllergens,
    ingredients: [...product.ingredients]
      .sort((a, b) => a.activeIngredient.name.localeCompare(b.activeIngredient.name))
      .map((row) => ({
        name: row.activeIngredient.name,
        // Decimal, serialized the same way `price` is — never a JS float.
        amount: row.amount.toFixed(2),
        unit: row.unit,
      })),
    healthGoals: [...product.healthGoals]
      .sort((a, b) => a.healthGoal.nameHe.localeCompare(b.healthGoal.nameHe))
      .map((row) => ({ nameHe: row.healthGoal.nameHe, nameEn: row.healthGoal.nameEn })),
    targetAudience: product.targetAudience,
    createdAt: product.createdAt.toISOString(),
  }
}
