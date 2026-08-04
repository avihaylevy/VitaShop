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
  dosageForm: DosageFormKey
  packageQuantity: number
  /** Server-serialized via Prisma Decimal.toFixed(2) — never parse as a number here. */
  price: string
  stockQuantity: number
  lowStockThreshold: number
  imageFile: string | null
}

export interface CatalogProductsEnvelope {
  items: CatalogProductDto[]
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
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
