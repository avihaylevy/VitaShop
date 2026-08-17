/**
 * MILESTONE-010 / DEC-088 — the admin product screens' domain types.
 * Mirrors `server/src/routes/adminProducts.ts`'s DTO and nothing else.
 */
import type { AdminListFailure } from './adminOrders'

export type AdminProductRow = {
  id: string
  slug: string
  nameHe: string
  nameEn: string
  /** Canonical two-decimal string. Rendered, never computed on (§3.4). */
  price: string
  stockQuantity: number
  lowStockThreshold: number
  packageQuantity: number
  dosageForm: string
  usageInstructions: string
  descriptionHe: string
  descriptionEn: string
  warningsAllergens: string
  /** DEC-083 tri-state: null = no sourced claim. */
  isKosher: boolean | null
  isGlutenFree: boolean | null
  isVegan: boolean | null
  isActive: boolean
  createdAt: string
  category: { id: string; nameHe: string; nameEn: string }
  brand: { id: string; name: string; nameEn: string | null }
}

export type AdminProductsPage = {
  page: number
  totalItems: number
  totalPages: number
  products: AdminProductRow[]
}

/**
 * The adminOrders failure vocabulary, ACTUALLY reused (review finding: the
 * first draft copied the union field-for-field under a comment claiming
 * reuse — a new kind added to one copy would never reach the other).
 */
export type AdminProductsFailure = AdminListFailure

export type AdminProductsResult =
  | { ok: true; page: AdminProductsPage }
  | { ok: false; failure: AdminProductsFailure }

/** A write refusal: the named codes travel so the form can point at fields. */
export type AdminProductWriteFailure =
  | AdminProductsFailure
  | { kind: 'invalid'; codes: string[]; fields: string[] }
  | { kind: 'gone' }
  | { kind: 'server' }

export type AdminProductWriteResult =
  | { ok: true; product: AdminProductRow }
  | { ok: false; failure: AdminProductWriteFailure }

export type AdminProductOptions = {
  categories: { id: string; nameHe: string; nameEn: string }[]
  brands: { id: string; name: string; nameEn: string | null }[]
}

export type AdminProductOptionsResult =
  | { ok: true; options: AdminProductOptions }
  | { ok: false; failure: AdminProductsFailure }

/** What the create form submits — mirrors `productCreateSchema`. */
export type AdminProductCreatePayload = {
  nameHe: string
  nameEn: string
  categoryId: string
  brandId: string
  dosageForm: string
  packageQuantity: number
  usageInstructions: string
  price: string
  stockQuantity: number
  descriptionHe: string
  descriptionEn: string
  warningsAllergens: string
  /** DEC-089b — optional absolute http(s) image URL; omitted = placeholder. */
  imageUrl?: string
}
