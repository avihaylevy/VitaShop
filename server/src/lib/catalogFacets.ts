// MILESTONE-005 Checkpoint D — `GET /api/catalog/facets` (§9d), frozen at
// Checkpoint A. One read-only endpoint. Values are derived from those
// actually used by ACTIVE products only — never an option that can match
// nothing. No counts (inventory leakage, §12). Stable IDs are the filter
// value (§4b); labels are for rendering only. Categories are NOT included
// here — they stay on the existing GET /api/categories (DEC-042, unchanged).

import type { PrismaClient } from '@prisma/client'
import { DOSAGE_FORM_VALUES, type DosageFormValue } from './catalogQuery.js'

export interface FacetOption {
  id: string
  label: string
}

export interface BilingualFacetOption {
  id: string
  labelHe: string
  labelEn: string
}

export interface DosageFormFacetOption {
  value: DosageFormValue
  labelHe: string
  labelEn: string
}

export interface CatalogFacetsPayload {
  brands: FacetOption[]
  ingredients: FacetOption[]
  healthGoals: BilingualFacetOption[]
  dosageForms: DosageFormFacetOption[]
}

// Server-owned dosage-form labels — the DosageForm enum's `@map` values
// (prisma/schema.prisma) are the DB storage representation, never surfaced
// by Prisma Client at runtime, so the display labels are declared here, the
// same "server owns its own canonical label data" pattern catalogCategories.ts
// already uses for categories. Matches client/src/locales/{he,en}/catalog.json
// `dosageForm` keys exactly — kept in sync by inspection, not by import,
// since server and client do not share a locale file.
const DOSAGE_FORM_LABELS: Record<DosageFormValue, { labelHe: string; labelEn: string }> = {
  CAPSULE: { labelHe: 'כמוסות', labelEn: 'Capsules' },
  TABLET: { labelHe: 'טבליות', labelEn: 'Tablets' },
  DROPS: { labelHe: 'טיפות', labelEn: 'Drops' },
  POWDER: { labelHe: 'אבקה', labelEn: 'Powder' },
  SYRUP: { labelHe: 'סירופ', labelEn: 'Syrup' },
}

export async function resolveCatalogFacets(prisma: PrismaClient): Promise<CatalogFacetsPayload> {
  const [brands, ingredients, healthGoals, activeDosageForms] = await Promise.all([
    prisma.brand.findMany({
      where: { products: { some: { isActive: true } } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.activeIngredient.findMany({
      where: { products: { some: { product: { isActive: true } } } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.healthGoal.findMany({
      where: { products: { some: { product: { isActive: true } } } },
      select: { id: true, nameHe: true, nameEn: true },
      orderBy: { nameHe: 'asc' },
    }),
    prisma.product.findMany({
      where: { isActive: true },
      select: { dosageForm: true },
      distinct: ['dosageForm'],
    }),
  ])

  const usedDosageForms = new Set(activeDosageForms.map((row) => row.dosageForm as DosageFormValue))

  return {
    brands: brands.map((brand) => ({ id: brand.id, label: brand.name })),
    ingredients: ingredients.map((ingredient) => ({ id: ingredient.id, label: ingredient.name })),
    healthGoals: healthGoals.map((goal) => ({ id: goal.id, labelHe: goal.nameHe, labelEn: goal.nameEn })),
    // Enum declaration order (DOSAGE_FORM_VALUES), filtered to what is
    // actually used — never alphabetical, matching §4b's "enum identifiers
    // acceptable" framing and keeping the facet list stable/reproducible.
    dosageForms: DOSAGE_FORM_VALUES.filter((value) => usedDosageForms.has(value)).map((value) => ({
      value,
      ...DOSAGE_FORM_LABELS[value],
    })),
  }
}
