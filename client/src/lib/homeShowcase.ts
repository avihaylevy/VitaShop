import type { CatalogProductDto } from '../types/catalog'

export type HomeShowcase = {
  /** categorySlug → a representative product image (first seen in the page). */
  categoryImages: ReadonlyMap<string, string | null>
  /** Up to three product images with a non-null file — the hero composition. */
  heroImages: readonly string[]
}

export const EMPTY_SHOWCASE: HomeShowcase = {
  categoryImages: new Map(),
  heroImages: [],
}

/**
 * DEC-082 — the home page's VISUAL layer, mined from the catalogue page
 * `useNewArrivals` ALREADY fetches (review of the fifth-list diff: the
 * first version fetched the identical /api/products page a second time).
 * Pure — runs outside any try/catch, so a mapping bug surfaces as a bug,
 * never as a silent "the server was slow" (the useNewArrivals rule).
 *
 * ⚠️ `totalItems` left this shape with the stats strip (the thirteenth
 * list): the count's only consumer was the deleted strip.
 */
export function buildShowcase(items: readonly CatalogProductDto[]): HomeShowcase {
  const categoryImages = new Map<string, string | null>()
  const heroImages: string[] = []
  for (const item of items) {
    if (!categoryImages.has(item.categorySlug) && item.imageFile !== null) {
      categoryImages.set(item.categorySlug, item.imageFile)
    }
    if (heroImages.length < 3 && item.imageFile !== null) {
      heroImages.push(item.imageFile)
    }
  }
  return { categoryImages, heroImages }
}
