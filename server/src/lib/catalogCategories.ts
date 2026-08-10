// Canonical catalogue categories — REQ-F-001 closed list, six main categories.
// Server-owned interim slug map (Slice 6 Checkpoint A decision 2): Category.slug
// does not exist in the schema yet, so the nameHe -> slug mapping lives here,
// not in the database. Do not seed additional Category rows for this list.

export interface CanonicalCategory {
  nameHe: string
  nameEn: string
  slug: string
}

// Order is the REQ-F-001 spec order — GET /api/categories returns this order verbatim.
export const CANONICAL_CATEGORIES: readonly CanonicalCategory[] = [
  { nameHe: 'ויטמינים', nameEn: 'Vitamins', slug: 'vitamins' },
  { nameHe: 'מינרלים', nameEn: 'Minerals', slug: 'minerals' },
  { nameHe: 'אומגה ושומנים', nameEn: 'Omega & Fats', slug: 'omega-fats' },
  { nameHe: 'חלבונים ואבקות', nameEn: 'Proteins & Powders', slug: 'proteins-powders' },
  { nameHe: 'פרוביוטיקה', nameEn: 'Probiotics', slug: 'probiotics' },
  { nameHe: 'צמחי מרפא', nameEn: 'Medicinal Herbs', slug: 'medicinal-herbs' },
]

const BY_NAME_HE = new Map<string, CanonicalCategory>(
  CANONICAL_CATEGORIES.map((category) => [category.nameHe, category]),
)

const BY_SLUG = new Map<string, CanonicalCategory>(
  CANONICAL_CATEGORIES.map((category) => [category.slug, category]),
)

// Returns undefined for a category name outside the canonical list — callers
// must treat that as a data-integrity failure (CATALOG_DATA_INTEGRITY), never
// a silent fallback.
export function findCanonicalCategoryByNameHe(nameHe: string): CanonicalCategory | undefined {
  return BY_NAME_HE.get(nameHe)
}

// MILESTONE-005 Checkpoint D — resolves a validated §4b category slug (already
// checked against this same canonical list at Checkpoint C) to the category's
// nameHe, which is what Product.category is actually keyed on for filtering
// (no Category.slug column exists — see catalogMapper.ts and DEC-043).
export function findCanonicalCategoryBySlug(slug: string): CanonicalCategory | undefined {
  return BY_SLUG.get(slug)
}
