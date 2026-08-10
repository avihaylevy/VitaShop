// MILESTONE-005 Checkpoint D/E — pure Prisma `where` builder for
// `GET /api/products`. Consumes the Checkpoint C validated query
// representation and produces a Prisma.ProductWhereInput. AND across filter
// groups, OR within a group (§4/REQ-F-011/TEST-011) — a repeated key becomes
// a single `in: [...]` clause (OR-within); each present group is AND-ed
// together via the top-level AND array. Always restricted to isActive
// products (§4.7.1) — no combination of filters can widen past that.
//
// 🔴 Checkpoint E: `q` (free-text search, §3/§3a) is composed the SAME way
// every other group is — its own top-level AND entry, itself an OR across
// every searched field (catalogSearchForm.ts's buildSearchWhere). This is
// what makes "search AND category AND brand AND …" true without weakening
// D's existing AND-across-groups semantics: q is just one more group.

import type { Prisma, DosageForm as PrismaDosageForm } from '@prisma/client'
import type { DosageFormValue } from './catalogQuery.js'
import { buildSearchWhere } from './catalogSearchForm.js'

export interface CatalogFilterInput {
  q: string | undefined
  brand: string[]
  ingredient: string[]
  healthGoal: string[]
  dosageForm: DosageFormValue[]
  minPrice: string | undefined
  maxPrice: string | undefined
  inStock: true | undefined
}

// The resolved server-owned category representation (§4b/§6c) — Product has
// no Category.slug column, so filtering goes through Category.nameHe
// (catalogCategories.ts's canonical slug -> nameHe map). `undefined` means no
// category filter was supplied at all — never confused with "category filter
// present but matches nothing".
export function buildProductWhere(
  filter: CatalogFilterInput,
  categoryNameHe: string | undefined,
): Prisma.ProductWhereInput {
  const AND: Prisma.ProductWhereInput[] = [{ isActive: true }]

  const searchWhere = buildSearchWhere(filter.q)
  if (searchWhere !== undefined) {
    AND.push(searchWhere)
  }

  if (categoryNameHe !== undefined) {
    AND.push({ category: { nameHe: categoryNameHe } })
  }

  if (filter.brand.length > 0) {
    AND.push({ brandId: { in: filter.brand } })
  }

  if (filter.ingredient.length > 0) {
    AND.push({ ingredients: { some: { activeIngredientId: { in: filter.ingredient } } } })
  }

  if (filter.healthGoal.length > 0) {
    AND.push({ healthGoals: { some: { healthGoalId: { in: filter.healthGoal } } } })
  }

  if (filter.dosageForm.length > 0) {
    AND.push({ dosageForm: { in: filter.dosageForm as PrismaDosageForm[] } })
  }

  // Decimal filtering by string, never Number()/parseFloat() — Prisma's
  // Decimal-aware filter accepts the validated decimal string as-is, so the
  // frozen price contract (§4, "never Float") is preserved end-to-end.
  if (filter.minPrice !== undefined) {
    AND.push({ price: { gte: filter.minPrice } })
  }
  if (filter.maxPrice !== undefined) {
    AND.push({ price: { lte: filter.maxPrice } })
  }

  if (filter.inStock === true) {
    AND.push({ stockQuantity: { gt: 0 } })
  }

  return { AND }
}
