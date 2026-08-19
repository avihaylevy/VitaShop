// MILESTONE-011 Checkpoint A — Stage 2's name→id mapping (AI_AGENT_SPEC,
// the criteria-schema note).
//
// 🔴 DROP, NEVER INVENT: a label the tables do not hold produces NO filter —
// the criterion disappears and is reported in `dropped` so the route's tests
// can see the difference between "matched nothing" and "was never looked
// up". No branch here fabricates an id, and the module performs READS ONLY.
//
// The output feeds buildProductWhere — THE SAME where-builder GET
// /api/products runs (§4.8.1: the agent translates into the same search
// criteria; it is not a second search engine).

import type { PrismaClient } from '@prisma/client'
import { findCanonicalCategoryBySlug, CANONICAL_CATEGORIES } from '../catalogCategories.js'
import {
  decimalPriceSchema,
  decimalToCents,
  DOSAGE_FORM_VALUES,
  MAX_REPEATABLE_VALUES,
  SUPPORTED_QUERY_PARAMS,
  type DosageFormValue,
} from '../catalogQuery.js'
import { DOSAGE_FORM_LABELS } from '../catalogFacets.js'
import type { ExtractedCriteriaNames } from './provider.js'

/** Ids-form criteria — the shape buildProductWhere + the handoff params need. */
export interface ResolvedCriteria {
  categorySlug: string | undefined
  categoryNameHe: string | undefined
  brandIds: string[]
  ingredientIds: string[]
  healthGoalIds: string[]
  dosageForms: DosageFormValue[]
  priceMin: string | undefined
  priceMax: string | undefined
  inStockOnly: true | undefined
  kosher: true | undefined
  glutenFree: true | undefined
  vegan: true | undefined
}

/**
 * 🔴 Typed against the catalogue's own param list (review finding): renaming
 * a GET /api/products parameter now breaks this module at COMPILE time
 * instead of surfacing as a 400 on the handoff URL in production.
 */
export type HandoffParams = Partial<
  Record<(typeof SUPPORTED_QUERY_PARAMS)[number], string | string[]>
>

export interface CriteriaMappingResult {
  resolved: ResolvedCriteria
  /** Labels that matched nothing (or exceeded the caps), e.g. "ingredient:קריסטלים". */
  dropped: string[]
  /** The resolved criteria as GET /api/products (= /catalog) query params. */
  handoffParams: HandoffParams
  /**
   * True when at least one filter survived — derived from handoffParams
   * (review finding: a hand-written boolean chain restating the same 11
   * fields drifted the moment one was added to only one of the two).
   */
  hasAnyCriterion: boolean
}

/**
 * Provider labels shorter than this are dropped unqueried (review finding):
 * a real LLM emitting "C" for vitamin C would CONTAINS-match half the
 * ingredient table and present five arbitrary products as "matching".
 */
const MIN_LABEL_LENGTH = 3

/**
 * The word→enum table, derived from the SERVER'S OWN label table (review
 * finding: a private table here was missing "כמוסות" — the exact string the
 * catalogue's filter chips display). Colloquial synonyms are additions on
 * top; the mock may also emit the enum value itself, accepted below.
 */
const DOSAGE_FORM_WORDS: Record<string, DosageFormValue> = {
  ...Object.fromEntries(
    (Object.keys(DOSAGE_FORM_LABELS) as DosageFormValue[]).flatMap((value) => [
      [DOSAGE_FORM_LABELS[value].labelHe.toLowerCase(), value],
      [DOSAGE_FORM_LABELS[value].labelEn.toLowerCase(), value],
    ]),
  ),
  'קפסולה': 'CAPSULE',
  'קפסולות': 'CAPSULE',
  capsule: 'CAPSULE',
  'טבליה': 'TABLET',
  tablet: 'TABLET',
  'טיפה': 'DROPS',
  drop: 'DROPS',
  'אבקות': 'POWDER',
}

function resolveCategory(
  label: string | undefined,
): { slug: string; nameHe: string } | undefined {
  if (label === undefined) return undefined
  const trimmed = label.trim()
  if (trimmed === '') return undefined
  const bySlug = findCanonicalCategoryBySlug(trimmed.toLowerCase())
  if (bySlug) return { slug: bySlug.slug, nameHe: bySlug.nameHe }
  const byName = CANONICAL_CATEGORIES.find(
    (category) =>
      category.nameHe === trimmed || category.nameEn.toLowerCase() === trimmed.toLowerCase(),
  )
  return byName ? { slug: byName.slug, nameHe: byName.nameHe } : undefined
}

/**
 * Screens raw provider labels: trims, drops empties silently, drops
 * too-short and over-cap labels INTO `dropped` — all before any query runs
 * (review finding: labels past the cap were fully queried and then thrown
 * away).
 */
function screenLabels(field: string, labels: string[], dropped: string[]): string[] {
  const usable: string[] = []
  for (const label of labels) {
    const trimmed = label.trim()
    if (trimmed === '') continue
    if (trimmed.length < MIN_LABEL_LENGTH) {
      dropped.push(`${field}:${label}`)
      continue
    }
    if (usable.length >= MAX_REPEATABLE_VALUES) {
      dropped.push(`${field}:${label} (over limit)`)
      continue
    }
    usable.push(trimmed)
  }
  return usable
}

interface NamedRow {
  id: string
  names: string[]
}

/**
 * One query per FIELD, not per label (review finding: the previous
 * per-label loop serialized up to dozens of round trips per request).
 * Attribution back to labels happens in memory so unmatched labels still
 * land in `dropped`. `matches` decides label↔row pairing; rows are ordered
 * by the caller's query so the id list is deterministic.
 */
function attribute(
  field: string,
  labels: string[],
  rows: NamedRow[],
  matches: (rowName: string, label: string) => boolean,
  dropped: string[],
): string[] {
  const ids: string[] = []
  for (const label of labels) {
    const lowered = label.toLowerCase()
    const hits = rows.filter((row) => row.names.some((name) => matches(name, lowered)))
    if (hits.length === 0) {
      dropped.push(`${field}:${label}`)
      continue
    }
    for (const hit of hits) {
      if (!ids.includes(hit.id)) ids.push(hit.id)
    }
  }
  return ids.slice(0, MAX_REPEATABLE_VALUES)
}

/**
 * Resolve provider-emitted labels against the real tables.
 *
 * Matching rules, per table:
 * · ingredients — case-insensitive CONTAINS: the stored names carry
 *   qualifiers ("מגנזיום (ביסגליצינאט)"), so the bare word must match every
 *   variant row; all matches join the OR-within-group filter.
 * · health goals / brands — case-insensitive EQUALS on either name column;
 *   these tables store clean labels.
 * · category — the static canonical list (slug or either name), no DB trip.
 * · dosage forms — the label-derived word table onto the enum.
 * · prices — validated with the catalogue's OWN decimalPriceSchema (regex +
 *   cents ceiling); a price the catalogue would reject is dropped here.
 *
 * Every id list is capped at MAX_REPEATABLE_VALUES — the same ceiling the
 * public query enforces, so the handoff URL can never be rejected by the
 * very endpoint it targets.
 */
export async function resolveCriteria(
  prisma: PrismaClient,
  names: ExtractedCriteriaNames,
): Promise<CriteriaMappingResult> {
  const dropped: string[] = []

  const category = resolveCategory(names.category)
  if (names.category !== undefined && category === undefined) {
    dropped.push(`category:${names.category}`)
  }

  const ingredientLabels = screenLabels('ingredient', names.ingredients, dropped)
  const goalLabels = screenLabels('healthGoal', names.healthGoals, dropped)
  const brandLabels = screenLabels('brand', names.brands, dropped)

  // The three lookups are independent — one round trip each, in parallel.
  // orderBy makes the id lists deterministic even when a label matches more
  // rows than the cap keeps (review finding: an unordered findMany let the
  // same question return different products across calls).
  const [ingredientRows, goalRows, brandRows] = await Promise.all([
    // 🔴 Each lookup requires linkage to ≥1 ACTIVE product — the same
    // definition GET /api/products' §4b existence check enforces (review
    // finding, caught by the round-trip test: the dev database holds ORPHAN
    // taxonomy rows, and a handoff URL carrying an orphan id is 400-rejected
    // by the very endpoint it targets). An orphan-only label lands in
    // `dropped` like any other no-match.
    ingredientLabels.length === 0
      ? []
      : prisma.activeIngredient.findMany({
          where: {
            products: { some: { product: { isActive: true } } },
            OR: ingredientLabels.map((label) => ({
              name: { contains: label, mode: 'insensitive' as const },
            })),
          },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
    goalLabels.length === 0
      ? []
      : prisma.healthGoal.findMany({
          where: {
            products: { some: { product: { isActive: true } } },
            OR: goalLabels.flatMap((label) => [
              { nameHe: { equals: label, mode: 'insensitive' as const } },
              { nameEn: { equals: label, mode: 'insensitive' as const } },
            ]),
          },
          select: { id: true, nameHe: true, nameEn: true },
          orderBy: { nameHe: 'asc' },
        }),
    brandLabels.length === 0
      ? []
      : prisma.brand.findMany({
          where: {
            products: { some: { isActive: true } },
            OR: brandLabels.flatMap((label) => [
              { name: { equals: label, mode: 'insensitive' as const } },
              { nameEn: { equals: label, mode: 'insensitive' as const } },
            ]),
          },
          select: { id: true, name: true, nameEn: true },
          orderBy: { name: 'asc' },
        }),
  ])

  const ingredientIds = attribute(
    'ingredient',
    ingredientLabels,
    ingredientRows.map((row) => ({ id: row.id, names: [row.name] })),
    (name, label) => name.toLowerCase().includes(label),
    dropped,
  )
  const healthGoalIds = attribute(
    'healthGoal',
    goalLabels,
    goalRows.map((row) => ({ id: row.id, names: [row.nameHe, row.nameEn] })),
    (name, label) => name.toLowerCase() === label,
    dropped,
  )
  const brandIds = attribute(
    'brand',
    brandLabels,
    brandRows.map((row) => ({ id: row.id, names: [row.name, row.nameEn ?? ''] })),
    (name, label) => name !== '' && name.toLowerCase() === label,
    dropped,
  )

  const dosageForms: DosageFormValue[] = []
  for (const word of names.dosageForms.slice(0, MAX_REPEATABLE_VALUES)) {
    const value =
      DOSAGE_FORM_WORDS[word.trim().toLowerCase()] ??
      // A provider may already speak the enum ("CAPSULE") — accept it.
      DOSAGE_FORM_VALUES.find((enumValue) => enumValue === word.trim().toUpperCase())
    if (value === undefined) {
      dropped.push(`dosageForm:${word}`)
      continue
    }
    if (!dosageForms.includes(value)) dosageForms.push(value)
  }

  let priceMin = names.priceMin
  if (priceMin !== undefined && !decimalPriceSchema.safeParse(priceMin).success) {
    dropped.push(`priceMin:${priceMin}`)
    priceMin = undefined
  }
  let priceMax = names.priceMax
  if (priceMax !== undefined && !decimalPriceSchema.safeParse(priceMax).success) {
    dropped.push(`priceMax:${priceMax}`)
    priceMax = undefined
  }
  // A contradictory range would be rejected by the catalogue endpoint the
  // handoff targets — drop BOTH, same as the endpoint flags both fields.
  if (
    priceMin !== undefined &&
    priceMax !== undefined &&
    decimalToCents(priceMin) > decimalToCents(priceMax)
  ) {
    dropped.push(`priceRange:${priceMin}-${priceMax}`)
    priceMin = undefined
    priceMax = undefined
  }

  const resolved: ResolvedCriteria = {
    categorySlug: category?.slug,
    categoryNameHe: category?.nameHe,
    brandIds,
    ingredientIds,
    healthGoalIds,
    dosageForms,
    priceMin,
    priceMax,
    inStockOnly: names.inStockOnly,
    kosher: names.kosher,
    glutenFree: names.glutenFree,
    vegan: names.vegan,
  }

  const handoffParams = toHandoffParams(resolved)
  return {
    resolved,
    dropped,
    handoffParams,
    hasAnyCriterion: Object.keys(handoffParams).length > 0,
  }
}

/**
 * REQ-F-077's handoff — the resolved criteria as GET /api/products query
 * params (which are also /catalog's URL params via the client's
 * catalogUrlState mapping, Checkpoint C's half). The HandoffParams return
 * type ties every key to SUPPORTED_QUERY_PARAMS at compile time.
 */
export function toHandoffParams(resolved: ResolvedCriteria): HandoffParams {
  const params: HandoffParams = {}
  if (resolved.categorySlug !== undefined) params.category = resolved.categorySlug
  if (resolved.brandIds.length > 0) params.brand = resolved.brandIds
  if (resolved.ingredientIds.length > 0) params.ingredient = resolved.ingredientIds
  if (resolved.healthGoalIds.length > 0) params.healthGoal = resolved.healthGoalIds
  if (resolved.dosageForms.length > 0) params.dosageForm = resolved.dosageForms
  if (resolved.priceMin !== undefined) params.minPrice = resolved.priceMin
  if (resolved.priceMax !== undefined) params.maxPrice = resolved.priceMax
  if (resolved.inStockOnly === true) params.inStock = 'true'
  if (resolved.kosher === true) params.kosher = 'true'
  if (resolved.glutenFree === true) params.glutenFree = 'true'
  if (resolved.vegan === true) params.vegan = 'true'
  return params
}
