import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Router, type ErrorRequestHandler } from 'express'
import multer from 'multer'
import type { Prisma, PrismaClient } from '@prisma/client'
import {
  createAdminProductRateLimiters,
  type AdminProductRateLimiters,
} from '../lib/rateLimit.js'
import {
  deriveSlug,
  parseProductCreate,
  parseProductPatch,
} from '../lib/adminProductForm.js'
import { isUniqueViolationOn } from '../lib/prismaUniqueViolation.js'
import { findCanonicalCategoryByNameHe } from '../lib/catalogCategories.js'
import { PRODUCTS_UPLOAD_DIR, mintUploadUrl } from '../lib/uploadPaths.js'
import { requireShopper } from './requireShopper.js'
import { createRequireAdmin } from './requireAdmin.js'

/**
 * MILESTONE-010 / DEC-088 — the product-admin routes. ISSUE-111's second
 * half: add/edit/deactivate products, stock, prices.
 *
 * 🔴 THE MIDDLEWARE ORDER IS THE CONTRACT (the adminOrders precedent,
 * verbatim): limiter → requireShopper (401) → requireAdmin (403, role read
 * PER REQUEST — DEC-065).
 *
 * 🔴 INV-03: THERE IS NO DELETE ROUTE, so the forbidden verb has no handler
 * to drift toward. Deactivation is a PATCH on `isActive`, reversible, and
 * the admin list is the ONE surface where an inactive product stays
 * visible — that visibility is what makes the soft-delete audit trail
 * usable rather than a hidden flag.
 *
 * 🔴 INV-02 IS UNTOUCHED BY CONSTRUCTION. Orders freeze their own copies of
 * price and name; carts hold no price and read the live row per request —
 * so an edit here reaches the very next getCart read and no frozen figure
 * anywhere moves. The integration test proves the seam live, the same way
 * the club's join test does.
 *
 * ⚠️ DEC-088 O1 (accept-and-document): `prisma db seed` remains the dev
 * catalogue's reset button — a re-seed converges price/stock/names back to
 * the CSV's stated values, by DEC-076's design. Edits made here are the
 * live-DB truth BETWEEN resets. This is the recorded deal, not a bug.
 */

export type AdminProductRouterDeps = {
  prisma: PrismaClient
  /** Injectable so tests can identify the limiter rather than count it. */
  rateLimiters?: AdminProductRateLimiters
}

/** One screenful — the admin orders list's convention. */
const ADMIN_PRODUCTS_PAGE_SIZE = 25

/** The same overflow cap the orders list carries, same reasoning. */
const MAX_PAGE = 1_000_000

/** Bounded attempts at a unique slug before giving up loudly. */
const SLUG_SUFFIX_ATTEMPTS = 50

/**
 * DEC-089c — the upload contract. 🔴 The NAME is a fresh UUID and the
 * EXTENSION comes from the SNIFFED content type: nothing of the client's
 * filename OR its claimed Content-Type survives (review finding: the
 * first build trusted `file.mimetype`, which is just a header the
 * uploader wrote — §3.4's client-is-not-truth applies to admins too).
 * 5MB cap; multer holds the file in MEMORY and the route writes it only
 * after the bytes identify themselves.
 */
const UPLOAD_MAX_BYTES = 5 * 1024 * 1024

/** Magic-byte identification — the CONTENT decides the extension. */
function sniffImageExtension(buffer: Buffer): string | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpg'
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buffer.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'webp'
  }
  return null
}
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const uploadParser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_MAX_BYTES, files: 1 },
})

const PRODUCT_SELECT = {
  id: true,
  slug: true,
  nameHe: true,
  nameEn: true,
  price: true,
  stockQuantity: true,
  lowStockThreshold: true,
  packageQuantity: true,
  dosageForm: true,
  usageInstructions: true,
  descriptionHe: true,
  descriptionEn: true,
  warningsAllergens: true,
  isKosher: true,
  isGlutenFree: true,
  isVegan: true,
  isActive: true,
  createdAt: true,
  category: { select: { id: true, nameHe: true, nameEn: true } },
  brand: { select: { id: true, name: true, nameEn: true } },
} as const

// Derived from the select, so the two cannot drift (review finding: a
// hand-restated 20-field type compiles fine while silently dropping a
// field the select gained).
type ProductRow = Prisma.ProductGetPayload<{ select: typeof PRODUCT_SELECT }>

function toAdminProductDto(product: ProductRow) {
  return {
    id: product.id,
    slug: product.slug,
    nameHe: product.nameHe,
    nameEn: product.nameEn,
    price: product.price.toFixed(2),
    stockQuantity: product.stockQuantity,
    lowStockThreshold: product.lowStockThreshold,
    packageQuantity: product.packageQuantity,
    dosageForm: product.dosageForm,
    usageInstructions: product.usageInstructions,
    descriptionHe: product.descriptionHe,
    descriptionEn: product.descriptionEn,
    warningsAllergens: product.warningsAllergens,
    isKosher: product.isKosher,
    isGlutenFree: product.isGlutenFree,
    isVegan: product.isVegan,
    isActive: product.isActive,
    createdAt: product.createdAt.toISOString(),
    category: product.category,
    // Both stored forms travel; the table renders the Latin-preferred pick
    // (the same `nameEn ?? name` as the shop surfaces, DEC-085) and the
    // Hebrew form stays available to any future admin surface.
    brand: product.brand,
  }
}

export function createAdminProductRouter(deps: AdminProductRouterDeps): ReturnType<typeof Router> {
  const { prisma } = deps
  const limiters = deps.rateLimiters ?? createAdminProductRateLimiters()
  const requireAdmin = createRequireAdmin(prisma)
  const router = Router()

  /**
   * The LIST — inactive rows INCLUDED by default (`?status=` narrows).
   * Unlike every shop surface, absence here would make a soft-deleted
   * product unreachable by the only role that can bring it back.
   */
  router.get('/', limiters.list, requireShopper, requireAdmin, async (req, res) => {
    const rawPage = Number.parseInt(String(req.query.page ?? '1'), 10)
    const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.min(rawPage, MAX_PAGE) : 1

    // An unknown status filters nothing — the orders list's bookmark rule.
    const rawStatus = req.query.status
    const activeFilter =
      rawStatus === 'active' ? { isActive: true } : rawStatus === 'inactive' ? { isActive: false } : {}

    // A plain contains filter over the three names an admin knows a
    // product by. No trigram machinery — this is a 49-row dev table and a
    // deliberately plain screen.
    const rawQ = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    const search =
      rawQ === ''
        ? {}
        : {
            OR: [
              { nameHe: { contains: rawQ, mode: 'insensitive' as const } },
              { nameEn: { contains: rawQ, mode: 'insensitive' as const } },
              // insensitive like the names — a hand-rolled toLowerCase here
              // was a second encoding of "slugs are lowercase" (review).
              { slug: { contains: rawQ, mode: 'insensitive' as const } },
            ],
          }

    const where = { ...activeFilter, ...search }

    try {
      const [totalItems, products] = await Promise.all([
        prisma.product.count({ where }),
        prisma.product.findMany({
          where,
          // The orders list's tiebreaker reasoning, verbatim: seeded rows
          // share a transaction-start createdAt, and ties make pagination
          // non-deterministic between queries.
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * ADMIN_PRODUCTS_PAGE_SIZE,
          take: ADMIN_PRODUCTS_PAGE_SIZE,
          select: PRODUCT_SELECT,
        }),
      ])

      res.json({
        page,
        totalItems,
        totalPages: Math.ceil(totalItems / ADMIN_PRODUCTS_PAGE_SIZE),
        products: products.map(toAdminProductDto),
      })
    } catch (error) {
      console.error('[admin] listing products failed', error)
      res.status(503).json({
        error: { code: 'PRODUCT_LIST_UNAVAILABLE', message: 'Try again shortly.' },
      })
    }
  })

  /**
   * The create form's pickers — every category and brand, id + names.
   * DEC-088 O2: a new product attaches to EXISTING taxonomy only, so the
   * form needs the rows to pick from and nothing else. Mounted before
   * `/:id` routes cannot shadow it (different method for most, and the
   * literal path wins for GET).
   */
  router.get('/options', limiters.list, requireShopper, requireAdmin, async (_req, res) => {
    try {
      const [categories, brands, healthGoals] = await Promise.all([
        prisma.category.findMany({
          select: { id: true, nameHe: true, nameEn: true },
          orderBy: { nameHe: 'asc' },
        }),
        prisma.brand.findMany({
          select: { id: true, name: true, nameEn: true },
          orderBy: { name: 'asc' },
        }),
        prisma.healthGoal.findMany({
          select: { id: true, nameHe: true, nameEn: true },
          orderBy: { nameHe: 'asc' },
        }),
      ])
      res.json({
        // 🔴 CANONICAL categories ONLY (review finding): catalogMapper
        // fail-closes the WHOLE shop catalogue on a product whose category
        // is outside the REQ-F-001 list, so a stale/renamed row offered
        // here would let one admin create 500 /api/products for everyone.
        // ⚠️ the helper answers UNDEFINED for an unknown name (a `!== null`
        // check here let every row through — caught by the masked-assert
        // in the integration test's first run).
        categories: categories.filter(
          (category) => findCanonicalCategoryByNameHe(category.nameHe) !== undefined,
        ),
        brands,
        healthGoals,
      })
    } catch (error) {
      console.error('[admin] listing product options failed', error)
      res.status(503).json({
        error: { code: 'PRODUCT_OPTIONS_UNAVAILABLE', message: 'Try again shortly.' },
      })
    }
  })

  /**
   * DEC-089c — the image upload. Answers `{ url: '/uploads/products/<name>' }`;
   * the CREATE then carries that path through the normal imageUrl field, so
   * upload and external-link images share ONE downstream pipeline.
   *
   * ⚠️ Multer's own failures (size cap, extra parts) surface through its
   * error middleware below as named 400s, never a raw 500.
   */
  router.post(
    '/image',
    limiters.write,
    requireShopper,
    requireAdmin,
    uploadParser.single('image'),
    async (req, res) => {
      const file = req.file
      if (!file) {
        res.status(400).json({
          error: { code: 'IMAGE_FILE_REQUIRED', message: 'Attach an image file as "image".' },
        })
        return
      }
      // The BYTES decide, not the claimed Content-Type (review finding).
      const extension = sniffImageExtension(file.buffer)
      if (!extension) {
        res.status(400).json({
          error: {
            code: 'IMAGE_TYPE_INVALID',
            message: 'Only PNG, JPEG and WebP images are accepted.',
          },
        })
        return
      }

      const name = `${randomUUID()}.${extension}`
      try {
        await mkdir(PRODUCTS_UPLOAD_DIR, { recursive: true })
        await writeFile(path.join(PRODUCTS_UPLOAD_DIR, name), file.buffer)
        res.status(201).json({ url: mintUploadUrl(name) })
      } catch (error) {
        console.error('[admin] image upload failed', error)
        res.status(503).json({
          error: { code: 'IMAGE_UPLOAD_UNAVAILABLE', message: 'Try again shortly.' },
        })
      }
    },
  )

  // Multer refusals (size cap, unexpected field) → named 400s, never a
  // raw 500. Registered after the upload route; the four-argument
  // signature is what makes Express treat it as an error handler.
  // ⚠️ It covers only routes registered ABOVE it in this router — a
  // future multer-using route must be added above this line or its
  // errors fall through to a raw 500.
  const uploadErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof multer.MulterError) {
      res.status(400).json({ error: { code: 'IMAGE_UPLOAD_REJECTED', message: error.code } })
      return
    }
    next(error)
  }
  router.use(uploadErrorHandler)

  /**
   * PATCH — the partial edit. Present fields only; an omitted field is
   * never touched. Price and stock are the headline case (ISSUE-111), the
   * rest of the CSV-editable text rides the same envelope.
   */
  router.patch('/:id', limiters.write, requireShopper, requireAdmin, async (req, res) => {
    const productId = typeof req.params.id === 'string' ? req.params.id : ''
    if (productId === '') {
      res.status(404).json({ error: { code: 'PRODUCT_NOT_FOUND', message: 'No such product.' } })
      return
    }

    const parsed = parseProductPatch(req.body ?? {})
    if (!parsed.ok) {
      res.status(400).json({
        error: {
          code: 'PRODUCT_PATCH_INVALID',
          message: 'The product update failed validation.',
          fields: parsed.fields,
          codes: parsed.codes,
        },
      })
      return
    }

    // Only the keys the request actually carried.
    const data = Object.fromEntries(
      Object.entries(parsed.value).filter(([, value]) => value !== undefined),
    )

    try {
      const product = await prisma.product.update({
        where: { id: productId },
        data,
        select: PRODUCT_SELECT,
      })
      res.json({ product: toAdminProductDto(product) })
    } catch (error) {
      if (isRecordNotFound(error)) {
        res.status(404).json({ error: { code: 'PRODUCT_NOT_FOUND', message: 'No such product.' } })
        return
      }
      console.error(`[admin] updating product ${productId} failed`, error)
      res.status(503).json({
        error: { code: 'PRODUCT_UPDATE_UNAVAILABLE', message: 'Try again shortly.' },
      })
    }
  })

  /**
   * The INV-03 toggle — deactivation AND reactivation through one honest
   * boolean. Its own route rather than a `PATCH /:id` field so the
   * audit-relevant action has its own name in logs and its own control on
   * the screen (an accidental deactivation hidden inside a field-edit
   * payload would be exactly the silent state change INV-03 exists to
   * prevent).
   */
  router.patch('/:id/active', limiters.write, requireShopper, requireAdmin, async (req, res) => {
    const productId = typeof req.params.id === 'string' ? req.params.id : ''
    if (productId === '') {
      res.status(404).json({ error: { code: 'PRODUCT_NOT_FOUND', message: 'No such product.' } })
      return
    }

    const isActive = (req.body ?? ({} as Record<string, unknown>)).isActive
    if (typeof isActive !== 'boolean') {
      res.status(400).json({
        error: { code: 'IS_ACTIVE_INVALID', message: 'isActive must be a boolean.' },
      })
      return
    }

    try {
      const product = await prisma.product.update({
        where: { id: productId },
        data: { isActive },
        select: PRODUCT_SELECT,
      })
      res.json({ product: toAdminProductDto(product) })
    } catch (error) {
      if (isRecordNotFound(error)) {
        res.status(404).json({ error: { code: 'PRODUCT_NOT_FOUND', message: 'No such product.' } })
        return
      }
      console.error(`[admin] toggling product ${productId} failed`, error)
      res.status(503).json({
        error: { code: 'PRODUCT_UPDATE_UNAVAILABLE', message: 'Try again shortly.' },
      })
    }
  })

  /**
   * CREATE — DEC-088 O4 (slug derived from nameEn, immutable, uniqueness
   * by numeric suffix) as amended by the 2026-08-17 user decisions:
   * DEC-089b's optional image, a NEW company by name (§10.2 amendment),
   * and DEC-092's dietary claims + health goals incl. inline new goals.
   * Only CATEGORIES remain existing-canonical-rows-only.
   */
  router.post('/', limiters.write, requireShopper, requireAdmin, async (req, res) => {
    const parsed = parseProductCreate(req.body ?? {})
    if (!parsed.ok) {
      res.status(400).json({
        error: {
          code: 'PRODUCT_CREATE_INVALID',
          message: 'The new product failed validation.',
          fields: parsed.fields,
          codes: parsed.codes,
        },
      })
      return
    }
    const input = parsed.value

    const base = deriveSlug(input.nameEn)
    if (base === '') {
      // A nameEn of punctuation/Hebrew only. Refused loudly rather than
      // inventing an identity the admin never saw.
      res.status(400).json({
        error: {
          code: 'SLUG_UNDERIVABLE',
          message: 'The English name must contain letters or digits to derive a URL slug.',
        },
      })
      return
    }

    try {
      const category = await prisma.category.findUnique({
        where: { id: input.categoryId },
        select: { id: true, nameHe: true },
      })
      if (!category) {
        res.status(400).json({
          error: { code: 'CATEGORY_NOT_FOUND', message: 'No such category.' },
        })
        return
      }
      // 🔴 THE SAME CANONICALITY GATE THE SHOP ENFORCES (review finding):
      // catalogMapper throws CatalogIntegrityError for an active product
      // under a non-canonical category, and the catalogue routes answer
      // that with a 500 and NO items. A create must not be able to arm
      // that failure — refused here with the same named-400 vocabulary,
      // even for an id /options no longer offers.
      if (findCanonicalCategoryByNameHe(category.nameHe) === undefined) {
        res.status(400).json({
          error: {
            code: 'CATEGORY_NOT_CANONICAL',
            message: 'Products may only be created under the canonical catalogue categories.',
          },
        })
        return
      }

      /*
       * The brand — an EXISTING row by id, or a NEW company by name (user
       * report 2026-08-17). A new name is first matched CASE-INSENSITIVELY
       * against both stored forms: "solgar" typed again must attach to the
       * existing סולגאר row, not mint a duplicate — Brand.name carries no
       * unique constraint, so this lookup is the only dedupe there is.
       * The unmatched-new-brand row is created NESTED inside the product
       * create below, so a refused or failed create leaves no orphan
       * brand (the DEC-089b image-row reasoning, applied to taxonomy).
       * ⚠️ Two simultaneous creates of the same new name can still race
       * past the lookup into two rows — accepted: a single-admin dev
       * surface, and the fix (a unique index) is a schema decision.
       */
      let brandRef: Prisma.BrandCreateNestedOneWithoutProductsInput
      if (input.brandId !== undefined) {
        const brand = await prisma.brand.findUnique({
          where: { id: input.brandId },
          select: { id: true },
        })
        if (!brand) {
          res.status(400).json({ error: { code: 'BRAND_NOT_FOUND', message: 'No such brand.' } })
          return
        }
        brandRef = { connect: { id: brand.id } }
      } else {
        const newName = input.newBrandName
        if (newName === undefined) {
          // Unreachable past the schema's exactly-one refine; kept so this
          // route never trusts a parser it cannot see from here.
          res.status(400).json({ error: { code: 'BRAND_REQUIRED', message: 'Pick or name a brand.' } })
          return
        }
        // 🔴 The typed LATIN form dedupes too (review finding): name
        // "אלטמן" + Latin "Altman" must attach to the existing Altman row,
        // or the pickers and the shop brand filter render two identical
        // "Altman" entries (DEC-085 displays nameEn ?? name).
        const newNameEn = input.newBrandNameEn
        const existing = await prisma.brand.findFirst({
          where: {
            OR: [
              { name: { equals: newName, mode: 'insensitive' } },
              { nameEn: { equals: newName, mode: 'insensitive' } },
              ...(newNameEn !== undefined
                ? [
                    { name: { equals: newNameEn, mode: 'insensitive' as const } },
                    { nameEn: { equals: newNameEn, mode: 'insensitive' as const } },
                  ]
                : []),
            ],
          },
          select: { id: true },
        })
        brandRef = existing
          ? { connect: { id: existing.id } }
          : { create: { name: newName, nameEn: newNameEn ?? null } }
      }

      /*
       * Health goals (user decision 2026-08-17) — the same shape as the
       * brand: EXISTING goals validated by id (a stale id is a named 400,
       * not a DB error), NEW goals deduped case-insensitively against
       * BOTH stored names, and unmatched ones created NESTED inside the
       * product insert so a refused create leaves no orphan goal. The
       * connect set is unique-ified: the join's (productId, healthGoalId)
       * PK would otherwise P2002 when a picked id and a deduped new name
       * resolve to the same row.
       */
      const goalConnectIds = new Set<string>()
      const goalCreates: { nameHe: string; nameEn: string }[] = []
      if (input.healthGoalIds !== undefined && input.healthGoalIds.length > 0) {
        const uniqueIds = [...new Set(input.healthGoalIds)]
        const found = await prisma.healthGoal.findMany({
          where: { id: { in: uniqueIds } },
          select: { id: true },
        })
        if (found.length !== uniqueIds.length) {
          res.status(400).json({
            error: { code: 'HEALTH_GOAL_NOT_FOUND', message: 'No such health goal.' },
          })
          return
        }
        for (const goal of found) goalConnectIds.add(goal.id)
      }
      if (input.newHealthGoals !== undefined && input.newHealthGoals.length > 0) {
        // ONE query for the whole batch (review finding: a per-goal
        // findFirst was up to 20 sequential round-trips), matched in
        // memory with the same insensitive both-names rule.
        const matches = await prisma.healthGoal.findMany({
          where: {
            OR: input.newHealthGoals.flatMap((goal) => [
              { nameHe: { equals: goal.nameHe, mode: 'insensitive' as const } },
              { nameEn: { equals: goal.nameEn, mode: 'insensitive' as const } },
            ]),
          },
          select: { id: true, nameHe: true, nameEn: true },
        })
        for (const goal of input.newHealthGoals) {
          const existing = matches.find(
            (row) =>
              row.nameHe.toLowerCase() === goal.nameHe.toLowerCase() ||
              row.nameEn.toLowerCase() === goal.nameEn.toLowerCase(),
          )
          if (existing) {
            goalConnectIds.add(existing.id)
          } else if (
            !goalCreates.some(
              (pending) =>
                pending.nameHe.toLowerCase() === goal.nameHe.toLowerCase() ||
                pending.nameEn.toLowerCase() === goal.nameEn.toLowerCase(),
            )
          ) {
            goalCreates.push(goal)
          }
        }
      }
      const healthGoalJoins = [
        ...[...goalConnectIds].map((id) => ({ healthGoal: { connect: { id } } })),
        ...goalCreates.map((goal) => ({ healthGoal: { create: goal } })),
      ]

      // The parsed input IS the create payload minus slug (review finding:
      // a field-by-field copy silently drops any future schema addition).
      // DEC-089b — imageUrl is NOT a Product column; it becomes the
      // product's first ProductImage row, created in the SAME insert so a
      // failed create leaves no orphan image row. category/brand travel as
      // RELATION connects (checked input) so the nested brand create above
      // can ride the same atomic insert.
      const {
        imageUrl,
        categoryId,
        brandId,
        newBrandName,
        newBrandNameEn,
        healthGoalIds,
        newHealthGoals,
        ...productFields
      } = input
      void categoryId
      void brandId
      void newBrandName
      void newBrandNameEn
      void healthGoalIds
      void newHealthGoals
      const data = {
        ...productFields,
        category: { connect: { id: category.id } },
        brand: brandRef,
        ...(healthGoalJoins.length > 0 ? { healthGoals: { create: healthGoalJoins } } : {}),
        ...(imageUrl ? { images: { create: { url: imageUrl, sortOrder: 0 } } } : {}),
        /*
         * 🔴 allergenInfoIncomplete: TRUE, deliberately (review finding).
         * `false` is a POSITIVE sourced claim — "the official page was
         * checked and warningsAllergens holds everything it publishes"
         * (the schema's own provenance comment) — and an admin-created
         * product has had no such check. `true` keeps the detail page's
         * incompleteness notice honest until someone actually sources the
         * allergen story; flipping it back is a data correction, not UI.
         */
        allergenInfoIncomplete: true,
      }

      /*
       * 🔴 CREATE-THEN-RETRY, not check-then-create — the registration
       * race's lesson: a uniqueness check and the insert are not atomic,
       * so the DATABASE constraint is the guarantee and P2002 is the
       * signal to try the next suffix. Bounded, and the bound failing is
       * a loud 503 rather than an infinite loop.
       */
      for (let attempt = 0; attempt < SLUG_SUFFIX_ATTEMPTS; attempt++) {
        const slug = attempt === 0 ? base : `${base}-${attempt + 1}`
        try {
          const product = await prisma.product.create({
            data: { slug, ...data },
            select: PRODUCT_SELECT,
          })
          res.status(201).json({ product: toAdminProductDto(product) })
          return
        } catch (error) {
          if (isUniqueViolationOn(error, ['slug', 'products_slug_key'])) continue
          throw error
        }
      }
      console.error(`[admin] no free slug after ${SLUG_SUFFIX_ATTEMPTS} attempts for "${base}"`)
      res.status(503).json({
        error: { code: 'PRODUCT_CREATE_UNAVAILABLE', message: 'Try again shortly.' },
      })
    } catch (error) {
      console.error('[admin] creating product failed', error)
      res.status(503).json({
        error: { code: 'PRODUCT_CREATE_UNAVAILABLE', message: 'Try again shortly.' },
      })
    }
  })

  return router
}

/** Prisma P2025 — update/delete on a row that does not exist. */
function isRecordNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2025'
  )
}
