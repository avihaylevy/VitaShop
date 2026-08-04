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

// Basename of a stored "assets/products/<file>" url. Never returns a path —
// only the filename, per the Slice 6 Checkpoint A contract.
function toImageFileBasename(url: string): string {
  const segments = url.split('/')
  return segments[segments.length - 1] ?? url
}

function firstImageFile(images: ProductWithCatalogRelations['images']): string | null {
  if (images.length === 0) return null
  const [first] = [...images].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
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
