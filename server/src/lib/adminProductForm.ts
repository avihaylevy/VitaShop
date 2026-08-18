import { z } from 'zod'
import { DOSAGE_FORM_VALUES } from './catalogQuery.js'
import { UPLOAD_REF_PATTERN } from './uploadPaths.js'

/**
 * MILESTONE-010 / DEC-088 — the product-admin forms, validated SERVER-SIDE.
 *
 * 🔴 §3.4: the admin client is not a source of truth any more than the
 * shopper client is. Every rule here binds regardless of what the admin
 * screen checks.
 *
 * 🔴 EVERY refusal carries a NAMED code (the JOIN_CLUB_INVALID lesson,
 * DEC-087's review: zod's default message maps to nothing on the client
 * and a submit fails with no visible feedback).
 */

/**
 * catalogQuery's exported list, REUSED — review finding: this file's first
 * draft restated it as a fifth copy under a comment claiming otherwise.
 */
export const DOSAGE_FORMS = DOSAGE_FORM_VALUES

/**
 * Canonical two-decimal money, strictly positive, bounded to the column.
 * A string end to end — Prisma Decimal accepts it; a float never appears
 * (schema field 08).
 *
 * 🔴 Review findings, both in the regex's shape:
 *   · no leading zeros — '00.00' satisfied the old `!== '0.00'` guard and
 *     stored a ₪0.00 product; `Number(value) > 0` is the positivity check
 *     now, and the canonical form forbids the disguise;
 *   · at most 8 integer digits — Decimal(10,2) overflows above that, and
 *     an unbounded value surfaced as a retryable 503 instead of a named
 *     refusal.
 */
const priceSchema = z
  .string({ message: 'PRICE_INVALID' })
  .regex(/^(0|[1-9]\d{0,7})\.\d{2}$/, 'PRICE_INVALID')
  .refine((value) => Number(value) > 0, 'PRICE_INVALID')

/** Bounded well under Int32 — an overflow must be a named 400, not a 503. */
const MAX_STOCK = 1_000_000
const MAX_PACKAGE_QUANTITY = 100_000

const stockSchema = z
  .number({ message: 'STOCK_INVALID' })
  .int('STOCK_INVALID')
  .min(0, 'STOCK_INVALID')
  .max(MAX_STOCK, 'STOCK_INVALID')

const packageQuantitySchema = z
  .number({ message: 'PACKAGE_QUANTITY_INVALID' })
  .int('PACKAGE_QUANTITY_INVALID')
  .positive('PACKAGE_QUANTITY_INVALID')
  .max(MAX_PACKAGE_QUANTITY, 'PACKAGE_QUANTITY_INVALID')

/**
 * DEC-083 AMENDED (user decision 2026-08-17): the admin IS a legitimate
 * writer of the dietary claims now — a tri-state per flag, exactly the
 * column's shape: null = no claim (the default), true/false = the admin's
 * stated claim, their responsibility like price (DEC-077) and warnings
 * already are. The filters keep matching `true` only, so a product joins
 * a dietary filter only when the admin actively marks it.
 */
const dietarySchema = (code: string) =>
  z.union([z.boolean(), z.null()], { message: code }).optional()

const FIELD_SCHEMAS = {
  nameHe: z.string({ message: 'NAME_HE_REQUIRED' }).trim().min(1, 'NAME_HE_REQUIRED'),
  nameEn: z.string({ message: 'NAME_EN_REQUIRED' }).trim().min(1, 'NAME_EN_REQUIRED'),
  descriptionHe: z
    .string({ message: 'DESCRIPTION_HE_REQUIRED' })
    .trim()
    .min(1, 'DESCRIPTION_HE_REQUIRED'),
  descriptionEn: z
    .string({ message: 'DESCRIPTION_EN_REQUIRED' })
    .trim()
    .min(1, 'DESCRIPTION_EN_REQUIRED'),
  usageInstructions: z.string({ message: 'USAGE_REQUIRED' }).trim().min(1, 'USAGE_REQUIRED'),
  // Empty is a VALUE here (no declared warnings), so no min(1) — see the
  // allergenInfoIncomplete provenance comment on the schema.
  warningsAllergens: z.string({ message: 'WARNINGS_INVALID' }),
  price: priceSchema,
  stockQuantity: stockSchema,
  packageQuantity: packageQuantitySchema,
  isKosher: dietarySchema('KOSHER_INVALID'),
  isGlutenFree: dietarySchema('GLUTEN_FREE_INVALID'),
  isVegan: dietarySchema('VEGAN_INVALID'),
} as const

/**
 * ⚠️ DEC-088 O1 still applies to the flags exactly as to price/stock: a
 * `prisma db seed` converges a SEEDED product's flags back to the CSV.
 * Admin edits are the live-DB truth between resets.
 */

/**
 * PATCH — every field optional (zod's own `.partial()`, review finding:
 * the hand-rolled Object.fromEntries + type cast said the same thing with
 * an unchecked assertion), at least one present. `undefined` means "not
 * this request", so the route builds the update from present keys only
 * and an omitted field is never overwritten.
 */
export const productPatchSchema = z
  .object({
    ...FIELD_SCHEMAS,
    // DEC-093 — a PROTOCOL field, never a column: acknowledges the
    // PRODUCT_DUPLICATE refusal on a rename. Excluded from the
    // at-least-one-field rule below, or {allowDuplicate:true} alone
    // would count as "a change".
    allowDuplicate: z.boolean({ message: 'ALLOW_DUPLICATE_INVALID' }),
  })
  .partial()
  .strict()
  .refine(
    (data) =>
      Object.entries(data).some(
        ([key, value]) => key !== 'allowDuplicate' && value !== undefined,
      ),
    { message: 'NO_FIELDS' },
  )

export type ProductPatchInput = z.infer<typeof productPatchSchema>

/**
 * CREATE — DEC-088 O2: the full bilingual form, no image (ISSUE-008), the
 * category chosen from EXISTING rows by id. The slug is NOT a field:
 * DEC-088 O4 derives it from nameEn server-side.
 *
 * 🔴 BRAND: either an EXISTING row by id (`brandId`) or a NEW company by
 * name (`newBrandName`, optional Latin form `newBrandNameEn`) — exactly
 * one of the two (user report 2026-08-17: a product from a company not
 * yet in the DB was uncreatable; categories stay canonical-only, brands
 * are open taxonomy). The superRefine below owns the exactly-one rule so
 * each shape failure carries its own name.
 */
export const productCreateSchema = z.strictObject({
  nameHe: FIELD_SCHEMAS.nameHe,
  nameEn: FIELD_SCHEMAS.nameEn,
  categoryId: z.string({ message: 'CATEGORY_REQUIRED' }).min(1, 'CATEGORY_REQUIRED'),
  brandId: z.string({ message: 'BRAND_REQUIRED' }).min(1, 'BRAND_REQUIRED').optional(),
  newBrandName: z
    .string({ message: 'NEW_BRAND_NAME_REQUIRED' })
    .trim()
    .min(1, 'NEW_BRAND_NAME_REQUIRED')
    .optional(),
  // The manufacturer's Latin form (DEC-080's column) — the admin's claim,
  // like every other admin-typed field. Empty is "none yet" (the column is
  // nullable), so it collapses to absent the way imageUrl's empty does.
  newBrandNameEn: z.preprocess(
    (value) => (typeof value === 'string' ? value.trim() : value),
    z
      .union([
        z.literal('').transform(() => undefined),
        z.string({ message: 'NEW_BRAND_NAME_EN_INVALID' }),
      ])
      .optional(),
  ),
  dosageForm: z.enum(DOSAGE_FORMS, { message: 'DOSAGE_FORM_INVALID' }),
  packageQuantity: packageQuantitySchema,
  usageInstructions: FIELD_SCHEMAS.usageInstructions,
  price: priceSchema,
  stockQuantity: stockSchema,
  descriptionHe: FIELD_SCHEMAS.descriptionHe,
  descriptionEn: FIELD_SCHEMAS.descriptionEn,
  warningsAllergens: FIELD_SCHEMAS.warningsAllergens.default(''),
  // The admin's dietary claims (DEC-083 amended) — absent means null,
  // which is exactly "no claim" in the column's own vocabulary.
  isKosher: FIELD_SCHEMAS.isKosher,
  isGlutenFree: FIELD_SCHEMAS.isGlutenFree,
  isVegan: FIELD_SCHEMAS.isVegan,
  /**
   * Health goals (user decision 2026-08-17): EXISTING goals by id, and/or
   * NEW goals by bilingual name pair — HealthGoal carries a required
   * nameHe AND nameEn (DEC-017's paired columns), so a new goal must
   * arrive with both. Bounded so a runaway payload is a named 400.
   */
  healthGoalIds: z
    .array(z.string({ message: 'HEALTH_GOAL_IDS_INVALID' }).min(1, 'HEALTH_GOAL_IDS_INVALID'), {
      message: 'HEALTH_GOAL_IDS_INVALID',
    })
    .max(20, 'HEALTH_GOAL_IDS_INVALID')
    .optional(),
  newHealthGoals: z
    .array(
      z.strictObject(
        {
          nameHe: z.string({ message: 'NEW_HEALTH_GOAL_INVALID' }).trim().min(1, 'NEW_HEALTH_GOAL_INVALID'),
          nameEn: z.string({ message: 'NEW_HEALTH_GOAL_INVALID' }).trim().min(1, 'NEW_HEALTH_GOAL_INVALID'),
        },
        { message: 'NEW_HEALTH_GOAL_INVALID' },
      ),
      { message: 'NEW_HEALTH_GOAL_INVALID' },
    )
    .max(20, 'NEW_HEALTH_GOAL_INVALID')
    .optional(),
  /** DEC-093 — acknowledges the PRODUCT_DUPLICATE refusal; a protocol
   * field the route strips before the insert, never a column. */
  allowDuplicate: z.boolean({ message: 'ALLOW_DUPLICATE_INVALID' }).optional(),
  /**
   * DEC-089b/c — an OPTIONAL image: an absolute http(s) URL (external
   * link) or a server-hosted upload path ('/uploads/products/<name>', the
   * shape the upload route mints — never a client-invented path outside
   * it). Empty/absent means the imageless placeholder (DEC-088 O2's
   * default stands). The shop renders whatever this address serves, so it
   * is the admin's claim, not the system's.
   */
  imageUrl: z.preprocess(
    // Trimmed BEFORE the union, so the empty-check and the URL-check test
    // the same value (review finding: '  ' was a 400 while '' was
    // accepted-as-absent — two branches judging two different strings).
    (value) => (typeof value === 'string' ? value.trim() : value),
    z
      .union([
        z.literal('').transform(() => undefined),
        z
          .string({ message: 'IMAGE_URL_INVALID' })
          .max(2000, 'IMAGE_URL_INVALID')
          .regex(
            // Absolute http(s), or the upload route's own minted shape —
            // built from uploadPaths so the two cannot drift.
            new RegExp(`^(https?:\\/\\/\\S+)$|${UPLOAD_REF_PATTERN.source}`),
            'IMAGE_URL_INVALID',
          ),
      ])
      .optional(),
  ),
})
  /**
   * Exactly one brand shape per create. Both present is a contradiction
   * (which brand did the admin mean?); neither is the old BRAND_REQUIRED;
   * a stray Latin form beside a brandId is the same contradiction — the
   * client never sends it, so only a raw API caller can, and it refuses
   * loudly rather than silently dropping a field.
   */
  .superRefine((data, ctx) => {
    const hasId = data.brandId !== undefined
    const hasNew = data.newBrandName !== undefined
    if (!hasId && !hasNew) {
      ctx.addIssue({ code: 'custom', path: ['brandId'], message: 'BRAND_REQUIRED' })
    }
    if (hasId && hasNew) {
      ctx.addIssue({ code: 'custom', path: ['brandId'], message: 'BRAND_CONFLICT' })
    }
    if (hasId && data.newBrandNameEn !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['newBrandNameEn'], message: 'BRAND_CONFLICT' })
    }
  })

export type ProductCreateInput = z.infer<typeof productCreateSchema>

export interface AdminFormFailure {
  ok: false
  fields: string[]
  codes: string[]
}

function failureOf(error: z.ZodError): AdminFormFailure {
  const issues = error.issues
  return {
    ok: false,
    fields: [...new Set(issues.map((issue) => issue.path.join('.')).filter(Boolean))],
    codes: [...new Set(issues.map((issue) => issue.message))],
  }
}

export function parseProductPatch(
  raw: unknown,
): { ok: true; value: ProductPatchInput } | AdminFormFailure {
  const result = productPatchSchema.safeParse(raw)
  return result.success ? { ok: true, value: result.data } : failureOf(result.error)
}

export function parseProductCreate(
  raw: unknown,
): { ok: true; value: ProductCreateInput } | AdminFormFailure {
  const result = productCreateSchema.safeParse(raw)
  return result.success ? { ok: true, value: result.data } : failureOf(result.error)
}

/**
 * DEC-093 — the duplicate-detection normal form. ONE pure function, used
 * by the create AND rename checks, so "the same name" has exactly one
 * definition and one place to prove it.
 *
 * Lowercase (Latin; Hebrew has no case) · geresh/gershayim/apostrophes/
 * quotes stripped (ד״ר ≡ דר) · every other punctuation run and hyphen
 * becomes a space (אומגה-3 ≡ אומגה 3) · whitespace collapsed · trimmed.
 *
 * 🔴 DIGITS AND UNITS ARE NEVER STRIPPED. "מגנזיום 60 כמוסות" and
 * "מגנזיום 100 כמוסות" are a LEGIT VARIANT PAIR — the count is what
 * keeps them distinct, and a normal form that erased it would flag the
 * catalogue's own product families as duplicates of each other.
 */
export function normalizeProductName(name: string): string {
  return name
    .toLowerCase()
    // The quote family disappears entirely — it joins letters (ד"ר),
    // so mapping it to a space would split words instead of unifying.
    .replace(/['"׳״‘’“”`]/g, '')
    // Everything else that is not a letter or digit becomes a space —
    // hyphens, dots, slashes, commas, plus signs and friends.
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * DEC-088 O4 — the slug, derived from nameEn at create and IMMUTABLE after
 * (DEC-033: slugs are route identity; a rename must never break a URL).
 *
 * Lowercase, runs of anything but [a-z0-9] collapse to one hyphen, edges
 * trimmed. A nameEn with no usable characters yields '' — the ROUTE turns
 * that into a refusal (SLUG_UNDERIVABLE), not a silent invented name.
 */
export function deriveSlug(nameEn: string): string {
  return nameEn
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
