import 'dotenv/config'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma, type DosageForm } from '@prisma/client'
import { syncProductIngredients } from '../src/lib/syncProductIngredients.js'

type Db = PrismaClient | Prisma.TransactionClient

// ── Safety: never seed anything but the local dev database ──────────────
// Credentials are parsed but never logged.
function assertLocalDevTarget(): void {
  const raw = process.env.DATABASE_URL
  if (!raw) {
    throw new Error('DATABASE_URL is not set. Refusing to seed.')
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('DATABASE_URL is not a valid connection URL. Refusing to seed.')
  }
  const host = url.hostname
  const database = url.pathname.replace(/^\//, '')
  const isLocalHost = host === 'localhost' || host === '127.0.0.1'
  if (!isLocalHost) {
    throw new Error(
      `DATABASE_URL host is "${host}", not localhost/127.0.0.1. Refusing to seed a non-local target.`,
    )
  }
  if (database !== 'vitashop_dev') {
    throw new Error(
      `DATABASE_URL database is "${database}", not "vitashop_dev". Refusing to seed an unexpected database.`,
    )
  }
  console.log(`Target confirmed: ${host}:${url.port || '5432'}/${database} (credentials not shown)`)
}

assertLocalDevTarget()

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

// ── Strict RFC4180 CSV parser — no new dependency added (CLAUDE.md: adding
// a dependency requires a stop-and-ask; this is a small, fully-specified
// grammar). A quote character is legal ONLY as the delimiter of a quoted
// field (opening/closing) or doubled inside one ("" -> literal "). A bare
// quote anywhere else is a malformed file, not something to route around —
// it throws with the exact line number rather than silently merging or
// "recovering" rows. The source CSV itself must be valid; see
// assets/products/ingredients.csv, corrected 2026-08-02 to properly quote
// every value containing a literal " (מ"ג -> "מ""ג", etc). ────────────────
function parseCsv(text: string): string[][] {
  const cleaned = text.replace(/^﻿/, '') // strip UTF-8 BOM — assets/README.md: "UTF-8 with BOM"
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let fieldWasQuoted = false
  let i = 0
  let line = 1
  while (i < cleaned.length) {
    const c = cleaned[i]
    if (inQuotes) {
      if (c === '"') {
        if (cleaned[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        const next = cleaned[i]
        if (next !== undefined && next !== ',' && next !== '\r' && next !== '\n') {
          throw new Error(
            `Malformed CSV at line ${line}: character "${next}" immediately follows a closing quote — ` +
              `only a comma or a line break may follow the closing " of a quoted field.`,
          )
        }
        continue
      }
      if (c === '\n') line++
      field += c
      i++
      continue
    }
    if (c === '"') {
      if (field.length > 0 || fieldWasQuoted) {
        throw new Error(
          `Malformed CSV at line ${line}: a " appeared outside a quoted field (field so far: "${field}"). ` +
            `A literal quote must be escaped by wrapping the whole field in quotes and doubling it, e.g. "מ""ג".`,
        )
      }
      inQuotes = true
      fieldWasQuoted = true
      i++
      continue
    }
    if (c === ',') {
      row.push(field)
      field = ''
      fieldWasQuoted = false
      i++
      continue
    }
    if (c === '\r') {
      i++
      continue
    }
    if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      fieldWasQuoted = false
      line++
      i++
      continue
    }
    field += c
    i++
  }
  if (inQuotes) {
    throw new Error(`Malformed CSV: file ends inside an unterminated quoted field (started before line ${line}).`)
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''))
}

function parseCsvFile(filePath: string): Record<string, string>[] {
  const text = readFileSync(filePath, 'utf-8')
  const rows = parseCsv(text)
  const header = rows[0]
  if (!header) return []
  const dataRows = rows.slice(1)
  dataRows.forEach((r, idx) => {
    if (r.length !== header.length) {
      throw new Error(
        `Malformed CSV in ${filePath}: data row ${idx + 2} has ${r.length} column(s), header has ${header.length}. ` +
          `Row: ${JSON.stringify(r)}`,
      )
    }
  })
  return dataRows.map((r) => {
    const obj: Record<string, string> = {}
    header.forEach((col, idx) => {
      obj[col] = r[idx] ?? ''
    })
    return obj
  })
}

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
// touched it. The values below are copied from CANONICAL_CATEGORIES verbatim;
// the real fix is to import that list instead of restating it, which is filed
// rather than done here so it is not a silent refactor inside a data batch.
const CATEGORY_EN: Record<string, string> = {
  'ויטמינים': 'Vitamins',
  'מינרלים': 'Minerals',
  'אומגה ושומנים': 'Omega & Fats',
  'פרוביוטיקה': 'Probiotics',
  'צמחי מרפא': 'Medicinal Herbs',
  'חלבונים ואבקות': 'Proteins & Powders', // batch 3 — the last of the six
}
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
// bug, not a translation choice. This map is used ONLY inside
// buildEnglishDescription below — it does not change what's written to
// Brand.name in the database.
const BRAND_EN: Record<string, string> = {
  'סולגאר': 'Solgar',
  'סופהרב': 'Supherb',
  // MILESTONE-004 batch 1. Taken from the manufacturer's own English
  // branding on altman.co.il ("Altman"), not transliterated by ear —
  // the same standard the two rows above were held to.
  'אלטמן': 'Altman',
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

function validateProductRow(row: Record<string, string>): ValidatedProductRow {
  const slug = requireNonEmpty(row.slug ?? '', 'slug', row.slug || '(missing slug)')
  return {
    slug,
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
    usageInstructions: requireNonEmpty(row.usage_instructions ?? '', 'usage_instructions', slug),
    warningsAllergens: requireNonEmpty(row.warnings_allergens ?? '', 'warnings_allergens', slug),
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
  const existing = await db.brand.findFirst({ where: { name } })
  if (existing) return existing
  return db.brand.create({ data: { name } })
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
    targetAudience: row.targetAudience,
  }

  const product = await db.product.upsert({
    where: { slug: row.slug },
    update: sharedFields,
    create: { slug: row.slug, ...sharedFields },
  })

  // ProductImage — no unique constraint in schema; idempotent via manual lookup
  const imageUrl = `assets/products/${row.imageFile}`
  const existingImage = await db.productImage.findFirst({ where: { productId: product.id, url: imageUrl } })
  if (!existingImage) {
    await db.productImage.create({ data: { productId: product.id, url: imageUrl, sortOrder: 0 } })
  }

  // ProductHealthGoal — join table, idempotent via manual lookup
  for (const goalHe of row.healthGoals) {
    const goal = await findOrCreateHealthGoal(db, goalHe, row.slug)
    const existingLink = await db.productHealthGoal.findFirst({
      where: { productId: product.id, healthGoalId: goal.id },
    })
    if (!existingLink) {
      await db.productHealthGoal.create({ data: { productId: product.id, healthGoalId: goal.id } })
    }
  }

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
