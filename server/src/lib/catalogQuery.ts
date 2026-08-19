// GET /api/products query parsing and validation — MILESTONE-005 Checkpoint C.
// Pure `zod` module (frozen at §13's Checkpoint C description): parses and
// validates raw query parameters against the contract frozen at MILESTONE-005
// Checkpoint A (technical/MILESTONE_PLANS.md §4). Produces a validated
// representation for Checkpoint D to execute against Prisma — this module
// never touches the database and never executes a query.

import { z } from 'zod'
import { CANONICAL_CATEGORIES } from './catalogCategories.js'

export const SUPPORTED_QUERY_PARAMS = [
  'q',
  'category',
  'brand',
  'ingredient',
  'healthGoal',
  'dosageForm',
  'minPrice',
  'maxPrice',
  'inStock',
  // DEC-078/DEC-083 — the three dietary filters. Same value contract as
  // inStock: the literal "true" or absent; they match ONLY products whose
  // sourced flag is true (null means unknown, never false — DEC-083).
  'kosher',
  'glutenFree',
  'vegan',
  'sort',
  'page',
] as const

const SUPPORTED_PARAM_SET: ReadonlySet<string> = new Set(SUPPORTED_QUERY_PARAMS)

// §12a — frozen at Checkpoint A correction: independent per-parameter ceiling.
export const MAX_REPEATABLE_VALUES = 10

export const SORT_VALUES = ['price_asc', 'price_desc', 'newest', 'popularity'] as const
export type SortValue = (typeof SORT_VALUES)[number]
const DEFAULT_SORT: SortValue = 'newest'

// §4b enum identifiers — mirrors prisma/schema.prisma's DosageForm enum.
export const DOSAGE_FORM_VALUES = ['CAPSULE', 'TABLET', 'DROPS', 'POWDER', 'SYRUP'] as const
export type DosageFormValue = (typeof DOSAGE_FORM_VALUES)[number]

const DEFAULT_PAGE = 1

const CANONICAL_CATEGORY_SLUGS: ReadonlySet<string> = new Set(
  CANONICAL_CATEGORIES.map((category) => category.slug),
)

// §4b — brand/ingredient/healthGoal are Brand.id/ActiveIngredient.id/HealthGoal.id,
// all `String @id @default(uuid())`. Checkpoint C validates well-formed shape only;
// existence-in-database is a Checkpoint D concern (requires a DB round trip, which
// this pure module never performs — see the module doc comment above).
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// §4 — "decimal string, 0–99999.99". Up to 5 whole digits, up to 2 decimal places.
const DECIMAL_PATTERN = /^\d{1,5}(\.\d{1,2})?$/
const MAX_PRICE_CENTS = 99_999_99

// §5's canonical parameter order — used to make a multi-field INVALID_QUERY_PARAMETER
// response's `fields` array deterministic regardless of input key order.
const FIELD_ORDER = [
  'q',
  'category',
  'brand',
  'dosageForm',
  'ingredient',
  'healthGoal',
  'minPrice',
  'maxPrice',
  'inStock',
  'kosher',
  'glutenFree',
  'vegan',
  'sort',
  'page',
] as const
type CatalogQueryField = (typeof FIELD_ORDER)[number]

export interface ParsedCatalogQuery {
  q: string | undefined
  category: string | undefined
  brand: string[]
  ingredient: string[]
  healthGoal: string[]
  dosageForm: DosageFormValue[]
  minPrice: string | undefined
  maxPrice: string | undefined
  inStock: true | undefined
  kosher: true | undefined
  glutenFree: true | undefined
  vegan: true | undefined
  sort: SortValue
  page: number
}

export interface CatalogQueryError {
  code: 'UNSUPPORTED_QUERY_PARAMETER' | 'INVALID_QUERY_PARAMETER'
  message: string
  fields: string[]
}

export type CatalogQueryParseResult =
  | { ok: true; query: ParsedCatalogQuery }
  | { ok: false; error: CatalogQueryError }

// Mirrors the shape of Express/qs's req.query values without importing express —
// keeps this module dependency-free (besides zod) and independently unit-testable.
export type RawCatalogQuery = Record<string, unknown>

// ── zod schemas — one per frozen §4 value contract ──────────────────────────

// Exported since M-011: the AI agent's criteria mapping validates provider-
// emitted prices against THIS schema (regex + cents ceiling), so a handoff
// URL can never carry a price the very endpoint it targets would reject.
export const decimalPriceSchema = z
  .string()
  .regex(DECIMAL_PATTERN)
  .refine((value) => decimalToCents(value) <= MAX_PRICE_CENTS)

const uuidIdSchema = z.string().regex(UUID_PATTERN)

const dosageFormSchema = z.enum(DOSAGE_FORM_VALUES)

const sortSchema = z.enum(SORT_VALUES)

// Bounds the digit string BEFORE parsing so an absurdly long input (e.g. a
// 50-digit string) never reaches Number.parseInt at all — length is checked
// on the string, precision is checked on the resulting number, and both must
// pass. MAX_SAFE_INTEGER is 16 digits; any longer string is rejected outright.
const MAX_PAGE_DIGITS = String(Number.MAX_SAFE_INTEGER).length

const pageSchema = z
  .string()
  .regex(/^[1-9]\d*$/)
  .refine((value) => value.length <= MAX_PAGE_DIGITS)
  .transform((value) => Number.parseInt(value, 10))
  .refine((value) => Number.isSafeInteger(value))

const inStockSchema = z.literal('true')

const qSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().min(1).max(80))

const categorySlugSchema = z.string().refine((value) => CANONICAL_CATEGORY_SLUGS.has(value))

// Exported since M-011 alongside decimalPriceSchema (range comparison).
export function decimalToCents(decimal: string): number {
  const [whole = '0', frac = ''] = decimal.split('.')
  const paddedFrac = `${frac}00`.slice(0, 2)
  return Number.parseInt(whole, 10) * 100 + Number.parseInt(paddedFrac, 10)
}

// Normalizes a raw query-parameter value into a string array.
// - absent              -> []
// - a single string      -> [string]
// - an array of strings  -> that array, unchanged (no dedup, no reordering)
// - anything else (nested object, non-string array entry, number, boolean)
//   -> null, meaning "malformed shape" — never silently coerced.
function normalizeRawValues(value: unknown): string[] | null {
  if (value === undefined) return []
  if (typeof value === 'string') return [value]
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
    return value as string[]
  }
  return null
}

function parseSingleValue<T>(
  field: CatalogQueryField,
  raw: unknown,
  schema: z.ZodType<T>,
  invalidFields: Set<string>,
): T | undefined {
  const values = normalizeRawValues(raw)
  if (values === null || values.length > 1) {
    invalidFields.add(field)
    return undefined
  }
  if (values.length === 0) return undefined
  const result = schema.safeParse(values[0])
  if (!result.success) {
    invalidFields.add(field)
    return undefined
  }
  return result.data
}

function parseRepeatable<T extends string>(
  field: CatalogQueryField,
  raw: unknown,
  itemSchema: z.ZodType<T>,
  invalidFields: Set<string>,
): T[] {
  const values = normalizeRawValues(raw)
  if (values === null) {
    invalidFields.add(field)
    return []
  }
  if (values.length === 0) return []
  if (values.length > MAX_REPEATABLE_VALUES) {
    invalidFields.add(field)
    return []
  }
  const result = z.array(itemSchema).safeParse(values)
  if (!result.success) {
    invalidFields.add(field)
    return []
  }
  return result.data
}

export function parseCatalogProductsQuery(rawQuery: RawCatalogQuery): CatalogQueryParseResult {
  const unsupported = Object.keys(rawQuery)
    .filter((key) => !SUPPORTED_PARAM_SET.has(key))
    .sort()

  if (unsupported.length > 0) {
    return {
      ok: false,
      error: {
        code: 'UNSUPPORTED_QUERY_PARAMETER',
        message: `Unsupported query parameter(s): ${unsupported.join(', ')}`,
        fields: unsupported,
      },
    }
  }

  const invalidFields = new Set<string>()

  const q = parseSingleValue('q', rawQuery.q, qSchema, invalidFields)
  const category = parseSingleValue('category', rawQuery.category, categorySlugSchema, invalidFields)

  const brand = parseRepeatable('brand', rawQuery.brand, uuidIdSchema, invalidFields)
  const ingredient = parseRepeatable('ingredient', rawQuery.ingredient, uuidIdSchema, invalidFields)
  const healthGoal = parseRepeatable('healthGoal', rawQuery.healthGoal, uuidIdSchema, invalidFields)
  const dosageForm = parseRepeatable('dosageForm', rawQuery.dosageForm, dosageFormSchema, invalidFields)

  const minPrice = parseSingleValue('minPrice', rawQuery.minPrice, decimalPriceSchema, invalidFields)
  const maxPrice = parseSingleValue('maxPrice', rawQuery.maxPrice, decimalPriceSchema, invalidFields)
  if (
    minPrice !== undefined &&
    maxPrice !== undefined &&
    !invalidFields.has('minPrice') &&
    !invalidFields.has('maxPrice') &&
    decimalToCents(minPrice) > decimalToCents(maxPrice)
  ) {
    invalidFields.add('minPrice')
    invalidFields.add('maxPrice')
  }

  const inStockLiteral = parseSingleValue('inStock', rawQuery.inStock, inStockSchema, invalidFields)
  const inStock: true | undefined = inStockLiteral === 'true' ? true : undefined

  // DEC-078/DEC-083 — same literal contract as inStock, one schema for all
  // three so the flags cannot drift apart.
  const kosherLiteral = parseSingleValue('kosher', rawQuery.kosher, inStockSchema, invalidFields)
  const kosher: true | undefined = kosherLiteral === 'true' ? true : undefined
  const glutenFreeLiteral = parseSingleValue('glutenFree', rawQuery.glutenFree, inStockSchema, invalidFields)
  const glutenFree: true | undefined = glutenFreeLiteral === 'true' ? true : undefined
  const veganLiteral = parseSingleValue('vegan', rawQuery.vegan, inStockSchema, invalidFields)
  const vegan: true | undefined = veganLiteral === 'true' ? true : undefined

  const sort = parseSingleValue('sort', rawQuery.sort, sortSchema, invalidFields) ?? DEFAULT_SORT
  const page = parseSingleValue('page', rawQuery.page, pageSchema, invalidFields) ?? DEFAULT_PAGE

  if (invalidFields.size > 0) {
    const fields = FIELD_ORDER.filter((field) => invalidFields.has(field))
    return {
      ok: false,
      error: {
        code: 'INVALID_QUERY_PARAMETER',
        message: `Invalid value for query parameter(s): ${fields.join(', ')}`,
        fields,
      },
    }
  }

  return {
    ok: true,
    query: { q, category, brand, ingredient, healthGoal, dosageForm, minPrice, maxPrice, inStock, kosher, glutenFree, vegan, sort, page },
  }
}
