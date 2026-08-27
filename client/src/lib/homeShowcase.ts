import type { CatalogProductDto } from '../types/catalog'

export type HomeShowcase = {
  /**
   * categorySlug → a representative product image (first seen in the page).
   * Value is string, not string | null — the builder only stores non-null
   * files, and a nullable value here forced a `!` on every consumer.
   */
  categoryImages: ReadonlyMap<string, string>
}

export const EMPTY_SHOWCASE: HomeShowcase = {
  categoryImages: new Map(),
}

/**
 * DEC-082 — the home page's VISUAL layer, mined from the catalogue page
 * `useNewArrivals` ALREADY fetches (review of the fifth-list diff: the
 * first version fetched the identical /api/products page a second time).
 * Pure — runs outside any try/catch, so a mapping bug surfaces as a bug,
 * never as a silent "the server was slow" (the useNewArrivals rule).
 *
 * ⚠️ `totalItems` left this shape with the stats strip (the thirteenth
 * list): the count's only consumer was the deleted strip. `heroImages`
 * left with the shelf-scene hero (area 5, variant G): the hero is the
 * user's photo now, so the mined trio had no consumer either.
 */
export function buildShowcase(items: readonly CatalogProductDto[]): HomeShowcase {
  const categoryImages = new Map<string, string>()
  for (const item of items) {
    if (!categoryImages.has(item.categorySlug) && item.imageFile !== null) {
      categoryImages.set(item.categorySlug, item.imageFile)
    }
  }
  return { categoryImages }
}
