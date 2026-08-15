import 'dotenv/config'
import { CANONICAL_CATEGORIES } from '../src/lib/catalogCategories.js'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma, type DosageForm } from '@prisma/client'
import { validateAllergenFields } from '../src/lib/allergenInfo.js'
import { parseCsvFile } from '../src/lib/productsCsv.js'
import { assertLocalDevTarget } from './assertLocalDevTarget.js'
import {
  syncProductHealthGoals,
  syncProductImages,
  syncProductIngredients,
} from '../src/lib/syncProductRelations.js'

type Db = PrismaClient | Prisma.TransactionClient

// ── Safety: never seed anything but the local dev database ──────────────
// 🔴 SHARED with `seedAccounts.ts`. See `assertLocalDevTarget.ts` for why a
// second copy would be worse than an import.

assertLocalDevTarget()

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

// ── Paths — assets/ lives at the repo root (DEC-016), two levels up from
// server/prisma/ ─────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')
const productsCsvPath = path.join(repoRoot, 'assets/products/products.csv')
const ingredientsCsvPath = path.join(repoRoot, 'assets/products/ingredients.csv')

// ── Known-vocabulary translations for taxonomy labels (category / health
// goal / dosage form). Fixed dictionary words, not product facts — distinct
// from DEC-026's accurate tier, which governs per-product data. Extend this
// map if a future verified row introduces a new value; an unmapped value
// fails the seed rather than silently guessing English. ──────────────────
// ⚠️ ISSUE-044 — this DUPLICATES `src/lib/catalogCategories.ts`, which already
// holds all six canonical nameHe -> nameEn pairs in REQ-F-001 spec order. This
// copy held only three, so it was already a divergent subset before batch 2
// touched it. ISSUE-044 CLOSED 2026-08-14: the map is now DERIVED from
// CANONICAL_CATEGORIES — the same list `GET /api/categories` serves — so the
// seed no longer keeps a copy to drift. The loud unknown-category throw in
// translateCategory stands.
const CATEGORY_EN: Record<string, string> = Object.fromEntries(
  CANONICAL_CATEGORIES.map((category) => [category.nameHe, category.nameEn]),
)
const HEALTH_GOAL_EN: Record<string, string> = {
  'לב וכלי דם': 'Heart & Blood Vessels',
  'מוח וזיכרון': 'Brain & Memory',
  'חיזוק חיסון': 'Immune Support',
  'שינה': 'Sleep',
  'ספורט': 'Sports',
  'עצמות': 'Bone Health',
  'אנרגיה': 'Energy',
  // MILESTONE-004 batch 2 — the first SEEDED product to carry this goal.
  // The value already existed on unseeded Partial rows, so the map was
  // missing it without ever throwing. Assigned only where the manufacturer
  // makes the placement itself (Altman files Jarro-Dophilus under
  // /probiotics/digest/; Supherb lists Bio 25 under עיכול), never inferred
  // from what the ingredient "is for" — DEC-032's no-invented-claims rule.
  'עיכול': 'Digestion',
  // MILESTONE-004 batch 3. Same standard as עיכול: assigned only where the
  // manufacturer places the product itself (Altman's /beauty/skin-care/ and
  // /beauty/hair-care/ paths), and for the biotin the package states it
  // outright — "ביוטין תורם לשמירה על עור ושיער תקינים".
  'עור ושיער': 'Skin & Hair',
}
const DOSAGE_FORM_EN: Record<DosageForm, string> = {
  CAPSULE: 'capsules',
  TABLET: 'tablets',
  DROPS: 'drops',
  POWDER: 'powder',
  SYRUP: 'syrup',
}
// Brand.name is intentionally stored untranslated (DEC-017 — brand names,
// unlike category/name/description/health_goal, are not a paired _he/_en
// field). That's correct for the stored row, but embedding the Hebrew value
// mid-sentence in a generated ENGLISH description would be a real display
// bug, not a translation choice. This map feeds buildEnglishDescription
// below AND (since DEC-080, 2026-08-15) converges Brand.nameEn — the
// manufacturer-verified Latin form the English UI displays. It still never
// changes what's written to Brand.name itself.
const BRAND_EN: Record<string, string> = {
  'סולגאר': 'Solgar',
  'סופהרב': 'Supherb',
  // MILESTONE-004 batch 1. Taken from the manufacturer's own English
  // branding on altman.co.il ("Altman"), not transliterated by ear —
  // the same standard the two rows above were held to.
  'אלטמן': 'Altman',
  // MILESTONE-004 Part 4 — two rows CLOSED out of the original fifteen, which
  // brought their brands into the seed for the first time. Both taken from the
  // source's own English usage, not transliterated: truforme.com writes
  // "briamil" in its own URLs and page text, and moraz.co.il titles the
  // product "SALUS - סירופ מולטי ויטמין".
  // 🔴 SUPERSEDED 2026-08-12 by DEC-032 "BRAND = MANUFACTURER, NOT PRODUCT
  // LINE". בריאמיל is a TruForMe product LINE, not a brand; the row that used
  // it now says טרו פור מי. The entry is KEPT because a stale CSV or a
  // re-import would otherwise fail the seed on a value this file once wrote —
  // it costs nothing and removing it buys nothing.
  'בריאמיל': 'Briamil',
  'טרו פור מי': 'TruForMe',
  // MILESTONE-004 Step 2 — the first genuinely NEW manufacturer since the
  // expansion began. naturalis.co.il writes "NATURALIS" in its own English
  // branding; not transliterated by ear.
  'נטורליס': 'Naturalis',
  'סלוס': 'Salus',
  // MILESTONE-004 Part 4, cohort B. Already Latin on the manufacturer's own
  // site and in the CSV, so this maps to itself — the entry exists because the
  // seed requires an EXPLICIT registration rather than falling through to the
  // source string, which is what caught this row rather than shipping a
  // guessed English name.
  'ECOSUPP': 'ECOSUPP',
  // MILESTONE-004 Part 4 — the last of the original fifteen to be seeded,
  // unblocked by DEC-032's new bar. meditec.co.il writes the brand "Britamin"
  // in its own English usage; not transliterated by ear.
  'בריטמין': 'Britamin',
}

// schema.prisma DosageForm enum: CAPSULE/TABLET/DROPS/POWDER/SYRUP, each
// @map()'d to its Hebrew DB value — DEC-028. The seed writes the enum KEY;
// Prisma maps it to the Hebrew value on write.
const DOSAGE_FORM_MAP: Record<string, DosageForm> = {
  'כמוסות': 'CAPSULE',
  'טבליות': 'TABLET',
  'טיפות': 'DROPS',
  'אבקה': 'POWDER',
  'סירופ': 'SYRUP',
}

interface ValidatedProductRow {
  slug: string
  imageFile: string
  nameHe: string
  nameEn: string
  category: string
  brand: string
  targetAudience: string | null
  price: string
  stockQuantity: number
  descriptionHe: string
  healthGoals: string[]
  dosageForm: DosageForm
  packageQuantity: number
  usageInstructions: string
  warningsAllergens: string
  allergenInfoIncomplete: boolean
  /**
   * DEC-076 / ISSUE-064 — the CSV's STATED activity, no longer inferred from
   * `verified`. `verified=yes` says the DATA is sourced; `is_active` says
   * whether the shop SELLS it. The file writes an explicit `yes` on every
   * active row; blank is tolerated and also means yes (so a hand-added row
   * cannot vanish by omission); anything else fails the seed loudly.
   */
  isActive: boolean
  /**
   * DEC-083 — tri-state dietary claims. 🔴 `null` means UNKNOWN, never false:
   * a value exists only when a manufacturer page states it (DEC-032's
   * no-invention rule). Blank CSV cell = null; `yes`/`no` = sourced claim.
   */
  isKosher: boolean | null
  isGlutenFree: boolean | null
  isVegan: boolean | null
}


function requireNonEmpty(value: string, field: string, slug: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new Error(`Malformed verified row "${slug}": required field "${field}" is empty.`)
  }
  return trimmed
}

function requirePositiveInt(value: string, field: string, slug: string): number {
  if (!/^\d+$/.test(value.trim())) {
    throw new Error(
      `Malformed verified row "${slug}": field "${field}" is not a plain non-negative integer ("${value}").`,
    )
  }
  const n = Number(value.trim())
  if (field === 'package_quantity' && n <= 0) {
    throw new Error(`Malformed verified row "${slug}": "${field}" must be > 0, got ${n}.`)
  }
  return n
}

function requirePrice(value: string, slug: string): string {
  const trimmed = value.trim()
  if (!/^\d+\.\d{2}$/.test(trimmed) || Number(trimmed) <= 0) {
    throw new Error(`Malformed verified row "${slug}": "price" must be a positive decimal with 2 places, got "${value}".`)
  }
  return trimmed
}

function mapDosageForm(value: string, slug: string): DosageForm {
  const trimmed = value.trim()
  const mapped = DOSAGE_FORM_MAP[trimmed]
  if (!mapped) {
    throw new Error(
      `Malformed verified row "${slug}": "dosage_form" value "${value}" is not one of the approved enum values (DEC-028).`,
    )
  }
  return mapped
}

function translateCategory(nameHe: string, slug: string): string {
  const en = CATEGORY_EN[nameHe]
  if (!en) {
    throw new Error(`No English translation registered for category "${nameHe}" (row "${slug}"). Add it to CATEGORY_EN.`)
  }
  return en
}

function translateHealthGoal(nameHe: string, slug: string): string {
  const en = HEALTH_GOAL_EN[nameHe]
  if (!en) {
    throw new Error(`No English translation registered for health goal "${nameHe}" (row "${slug}"). Add it to HEALTH_GOAL_EN.`)
  }
  return en
}

// products.csv has one `description` column (Hebrew only) — no description_en.
// schema.prisma requires both descriptionHe and descriptionEn (DEC-017 pairing).
// Per DEC-026, `description` is invent-freely tier; a short factual English
// blurb built from already-validated fields (name/brand/package/dosage form)
// is generated here rather than duplicating the Hebrew text into the English
// column, which would be a real data-integrity fault, not a translation.
// Deterministic, catalogue-fields-only: same input always produces the same
// string. No medical claim, no dosage advice, no contraindication, no
// manufacturer voice — a plain factual restatement of already-validated
// fields, explicitly framed as a catalogue listing so it cannot read as an
// official manufacturer description.
function buildEnglishDescription(row: {
  nameEn: string
  brand: string
  packageQuantity: number
  dosageForm: DosageForm
  slug: string
}): string {
  const brandEn = BRAND_EN[row.brand]
  if (!brandEn) {
    throw new Error(`No English translation registered for brand "${row.brand}" (row "${row.slug}"). Add it to BRAND_EN.`)
  }
  return `Catalogue listing: ${row.nameEn} (${brandEn}), ${row.packageQuantity} ${DOSAGE_FORM_EN[row.dosageForm]} per package.`
}

function readIsActive(row: Record<string, string>, slug: string): boolean {
  const raw = (row.is_active ?? '').trim()
  if (raw === '' || raw === 'yes') return true
  if (raw === 'no') return false
  throw new Error(`Malformed verified row "${slug}": "is_active" must be yes/no/blank, got "${raw}".`)
}

// DEC-083. Distinct from readIsActive on purpose: there, blank means yes
// (an omitted row must not vanish); here, blank means UNKNOWN (null) —
// defaulting a dietary claim either way would invent it (DEC-032).
function readDietaryFlag(row: Record<string, string>, column: string, slug: string): boolean | null {
  const raw = (row[column] ?? '').trim()
  if (raw === '') return null
  if (raw === 'yes') return true
  if (raw === 'no') return false
  throw new Error(`Malformed verified row "${slug}": "${column}" must be yes/no/blank, got "${raw}".`)
}

function validateProductRow(row: Record<string, string>): ValidatedProductRow {
  const slug = requireNonEmpty(row.slug ?? '', 'slug', row.slug || '(missing slug)')
  return {
    slug,
    isActive: readIsActive(row, slug),
    imageFile: requireNonEmpty(row.image_file ?? '', 'image_file', slug),
    nameHe: requireNonEmpty(row.name_he ?? '', 'name_he', slug),
    nameEn: requireNonEmpty(row.name_en ?? '', 'name_en', slug),
    category: requireNonEmpty(row.category ?? '', 'category', slug),
    brand: requireNonEmpty(row.brand ?? '', 'brand', slug),
    targetAudience: row.target_audience && row.target_audience.trim().length > 0 ? row.target_audience.trim() : null,
    price: requirePrice(row.price ?? '', slug),
    stockQuantity: requirePositiveInt(row.stock_quantity ?? '', 'stock_quantity', slug),
    descriptionHe: requireNonEmpty(row.description ?? '', 'description', slug),
    healthGoals: (row.health_goals ?? '')
      .split('|')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    dosageForm: mapDosageForm(row.dosage_form ?? '', slug),
    packageQuantity: requirePositiveInt(row.package_quantity ?? '', 'package_quantity', slug),
    // 🔴 OPTIONAL since DEC-032's NEW BAR (2026-08-12). Usage instructions are
    // medical data: they come from a label or they stay EMPTY. Requiring them
    // is what creates pressure to paraphrase a page — and a paraphrase is how
    // superherb-biokid-drops came to state an infant dose from the wrong age.
    usageInstructions: (row.usage_instructions ?? '').trim(),
    isKosher: readDietaryFlag(row, 'is_kosher', slug),
    isGlutenFree: readDietaryFlag(row, 'is_gluten_free', slug),
    isVegan: readDietaryFlag(row, 'is_vegan', slug),
    ...validateAllergenFields(row, slug),
  }
}


interface ValidatedIngredientRow {
  productSlug: string
  ingredientHe: string
  ingredientEn: string
  amount: string
  unit: string
}

function validateIngredientRow(row: Record<string, string>, verifiedSlugs: Set<string>): ValidatedIngredientRow {
  const productSlug = requireNonEmpty(row.product_slug ?? '', 'product_slug', row.product_slug || '(missing product_slug)')
  if (!verifiedSlugs.has(productSlug)) {
    throw new Error(
      `Malformed verified ingredient row: product_slug "${productSlug}" is marked verified but does not reference a verified product row.`,
    )
  }
  const ingredientEn = requireNonEmpty(row.ingredient_en ?? '', 'ingredient_en', productSlug)
  const amountRaw = (row.amount ?? '').trim()
  if (!/^\d+(\.\d+)?$/.test(amountRaw) || Number(amountRaw) <= 0) {
    throw new Error(`Malformed verified ingredient row for "${productSlug}": "amount" must be a positive number, got "${row.amount}".`)
  }
  return {
    productSlug,
    ingredientHe: requireNonEmpty(row.ingredient_he ?? '', 'ingredient_he', productSlug),
    ingredientEn,
    amount: amountRaw,
    unit: requireNonEmpty(row.unit ?? '', 'unit', productSlug),
  }
}

async function findOrCreateCategory(db: Db, nameHe: string, slug: string) {
  const existing = await db.category.findFirst({ where: { nameHe } })
  if (existing) return existing
  return db.category.create({ data: { nameHe, nameEn: translateCategory(nameHe, slug) } })
}

async function findOrCreateBrand(db: Db, name: string) {
  // ISSUE-127a (user-approved 2026-08-15): the seed CONVERGES nameEn from
  // BRAND_EN — the same manufacturer-sourced map the English descriptions
  // already use — so existing rows gain the Latin form on the next run,
  // not only newly created ones.
  const nameEn = BRAND_EN[name] ?? null
  const existing = await db.brand.findFirst({ where: { name } })
  if (existing) {
    // Bidirectional convergence: a retracted/renamed BRAND_EN entry must be
    // repairable by re-running the seed, so a null CLEARS a stale Latin
    // form rather than fossilizing it (review of this diff).
    if (existing.nameEn !== nameEn) {
      return db.brand.update({ where: { id: existing.id }, data: { nameEn } })
    }
    return existing
  }
  return db.brand.create({ data: { name, nameEn } })
}

async function findOrCreateHealthGoal(db: Db, nameHe: string, slug: string) {
  const existing = await db.healthGoal.findFirst({ where: { nameHe } })
  if (existing) return existing
  return db.healthGoal.create({ data: { nameHe, nameEn: translateHealthGoal(nameHe, slug) } })
}

async function seedProduct(db: Db, row: ValidatedProductRow, ingredients: ValidatedIngredientRow[]) {
  const category = await findOrCreateCategory(db, row.category, row.slug)
  const brand = await findOrCreateBrand(db, row.brand)
  const descriptionEn = buildEnglishDescription({
    nameEn: row.nameEn,
    brand: row.brand,
    packageQuantity: row.packageQuantity,
    dosageForm: row.dosageForm,
    slug: row.slug,
  })

  const sharedFields = {
    nameHe: row.nameHe,
    nameEn: row.nameEn,
    categoryId: category.id,
    brandId: brand.id,
    dosageForm: row.dosageForm,
    packageQuantity: row.packageQuantity,
    usageInstructions: row.usageInstructions,
    price: row.price,
    stockQuantity: row.stockQuantity,
    descriptionHe: row.descriptionHe,
    descriptionEn,
    warningsAllergens: row.warningsAllergens,
    allergenInfoIncomplete: row.allergenInfoIncomplete,
    targetAudience: row.targetAudience,
    // 🔴 DEC-076 / ISSUE-064 — the CSV's STATED value, not `true`
    // unconditionally. `7baac10` made this `isActive: true` for every
    // verified row (correct for the reactivation bug it closed), which made
    // the CSV the silent authority: any admin soft-delete was resurrected on
    // the next seed with no trace. The `is_active` column makes the file's
    // intent SAY-SO — deactivating a product in the dev catalogue is now a
    // recorded CSV edit, and the seed converges on what the file states.
    // ⚠️ The accepted semantics stand: the seed is a dev tool and the CSV is
    // its authority; an admin deactivation still only survives a re-seed if
    // the CSV row says `no`. That is the deal DEC-076 records.
    isActive: row.isActive,
    // DEC-083 — converged like is_active: the CSV's stated value, null when
    // the file is silent. A retracted claim (value removed from the CSV)
    // returns to null on the next seed rather than fossilizing.
    isKosher: row.isKosher,
    isGlutenFree: row.isGlutenFree,
    isVegan: row.isVegan,
  }

  const product = await db.product.upsert({
    where: { slug: row.slug },
    update: sharedFields,
    create: { slug: row.slug, ...sharedFields },
  })

  // ProductImage — one row per product today, but reconciled as a SET so a
  // changed image_file replaces rather than accumulates. See the audit note in
  // syncProductRelations.ts: this loop was add-only and the bug was latent.
  await syncProductImages(db, product.id, [`assets/products/${row.imageFile}`])

  // ProductHealthGoal — likewise reconciled as a set. Add-only until
  // 2026-08-11; a product whose health_goals changed would have stayed
  // attached to the goal it no longer claims.
  const healthGoalIds: string[] = []
  for (const goalHe of row.healthGoals) {
    const goal = await findOrCreateHealthGoal(db, goalHe, row.slug)
    healthGoalIds.push(goal.id)
  }
  await syncProductHealthGoals(db, product.id, healthGoalIds)

  // ProductIngredient — join table with amount/unit; idempotent via manual
  // lookup, update amount/unit if the sourced value changed on re-verification
  /*
   * 🔴 ISSUE-049 + the seed idempotency gap it exposed. Both live in
   * `src/lib/syncProductIngredients.ts`, which was extracted so the PRUNING
   * could be tested — this file constructs a PrismaClient and calls
   * assertLocalDevTarget() at module scope, so a test cannot import it.
   *
   * The name passed is the HEBREW one. DEC-017 pairs _he/_en columns for CORE
   * fields only — name, description, category, health goal — and puts
   * everything else on a single Hebrew column, so ActiveIngredient.name is
   * Hebrew by decision. This seed previously wrote ingredient_en into it,
   * which rendered 46 Latin labels inside the Hebrew RTL UI.
   *
   * ⚠️ NOTHING IS TRANSLATED. Both names were sourced from the manufacturer's
   * own page and both already sit in ingredients.csv; composing a Hebrew name
   * would be invented data under DEC-032, exactly like a dosage.
   */
  await syncProductIngredients(
    db,
    product.id,
    ingredients.map((ing) => ({ name: ing.ingredientHe, amount: ing.amount, unit: ing.unit })),
  )

  return product
}

async function main() {
  const productRows = parseCsvFile(productsCsvPath)
  const ingredientRows = parseCsvFile(ingredientsCsvPath)

  const verifiedProductRaw = productRows.filter((r) => (r.verified ?? '').trim().toLowerCase() === 'yes')
  const skippedProductCount = productRows.length - verifiedProductRaw.length

  const validatedProducts = verifiedProductRaw.map(validateProductRow)
  const verifiedSlugs = new Set(validatedProducts.map((p) => p.slug))

  const verifiedIngredientRaw = ingredientRows.filter((r) => (r.verified ?? '').trim().toLowerCase() === 'yes')
  const skippedIngredientCount = ingredientRows.length - verifiedIngredientRaw.length
  const validatedIngredients = verifiedIngredientRaw.map((r) => validateIngredientRow(r, verifiedSlugs))

  console.log(
    `products.csv: ${productRows.length} total, ${validatedProducts.length} verified=yes (importing), ${skippedProductCount} skipped (Partial/No/blank/fictional)`,
  )
  console.log(
    `ingredients.csv: ${ingredientRows.length} total, ${validatedIngredients.length} verified=yes (importing), ${skippedIngredientCount} skipped`,
  )

  for (const productRow of validatedProducts) {
    const ownIngredients = validatedIngredients.filter((i) => i.productSlug === productRow.slug)
    await prisma.$transaction((tx) => seedProduct(tx, productRow, ownIngredients))
    console.log(`  seeded: ${productRow.slug} (${ownIngredients.length} ingredient row${ownIngredients.length === 1 ? '' : 's'})`)
  }

  /*
   * 🔴 DEACTIVATE products that are no longer verified. Added 2026-08-11.
   *
   * THE GAP: the seed only ever added and updated PRODUCTS, exactly as it
   * only ever added and updated ingredient links before that was fixed. A row
   * demoted from `verified=yes` back to Partial simply stopped being imported
   * — and its product stayed `isActive: true` in the database, so it kept
   * being served.
   *
   * This was found while REPAIRING ISSUE-045: five Solgar rows whose prices
   * have no admissible source were demoted to Partial, the seed re-run, and
   * the catalogue still reported 39 active products against 34 verified rows.
   * The demotion had changed nothing a user could see. The repair silently
   * did not work.
   *
   * ⚠️ Third instance of ONE root cause — a convergence property that holds
   * only while data grows. Ingredient links (86c559a), image and health-goal
   * links (8edd538), and now the products themselves.
   *
   * 🔴 SOFT DELETE ONLY — INV-03. `isActive: false`, never a DELETE. The row,
   * its order history and its images stay; it leaves the catalogue.
   * `catalogQuery` already filters on `isActive`, so this is the supported
   * way to withdraw a product.
   */
  const deactivated = await prisma.product.updateMany({
    where: { isActive: true, slug: { notIn: [...verifiedSlugs] } },
    data: { isActive: false },
  })
  if (deactivated.count > 0) {
    console.log(`  🔴 deactivated ${deactivated.count} product(s) no longer verified=yes (soft delete, INV-03)`)
  }

  /*
   * 🔴 DEC-072 — BRAND ROWS CONVERGE TOO (ISSUE-078, the FIFTH instance of
   * "the seed grows and never converges"). DEC-032's manufacturer rule moved
   * a product between brands and the abandoned brand row stayed forever.
   *
   * ⚠️ A HARD delete, deliberately, and it does not touch INV-03: that
   * invariant protects Product and Order. A brand row nothing references has
   * no order history, no frozen names, no images — there is nothing to
   * preserve. Two guards keep this narrow:
   *   · only names the verified CSV no longer uses, AND
   *   · only when NO product row still points at it — a soft-deleted
   *     product keeps its brand row alive, because reactivating that
   *     product must not resurrect its brand under a new id.
   * Accepted trade-off (recorded in DEC-072): a brand that returns in a
   * later catalogue pass is recreated with a NEW id.
   */
  const verifiedBrands = new Set(validatedProducts.map((p) => p.brand))
  /*
   * ⚠️ FLOORED AT A NON-EMPTY SET — review finding. `notIn: []` matches EVERY
   * row, so a repair pass that demotes the whole CSV to Partial would have
   * turned this into "delete every product-less brand". An empty verified
   * set means the catalogue is in surgery, not that every brand retired.
   */
  if (verifiedBrands.size > 0) {
    const retiredBrands = await prisma.brand.deleteMany({
      where: { name: { notIn: [...verifiedBrands] }, products: { none: {} } },
    })
    if (retiredBrands.count > 0) {
      console.log(`  🔴 retired ${retiredBrands.count} brand row(s) the CSV no longer references (DEC-072)`)
    }
  }

  console.log(`Done. ${validatedProducts.length} verified products processed.`)
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
