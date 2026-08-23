import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { CANONICAL_CATEGORIES, findCanonicalCategoryBySlug } from '../lib/catalogCategories.js'
import {
  CatalogIntegrityError,
  mapProductToPublicCatalog,
  mapProductToPublicDetail,
  toImageRef,
  type ProductWithCatalogRelations,
  type PublicCatalogProduct,
  type PublicProductDetail,
} from '../lib/catalogMapper.js'
import { parseCatalogProductsQuery, type RawCatalogQuery } from '../lib/catalogQuery.js'
import { buildProductWhere } from '../lib/catalogFilterWhere.js'
import { buildOrderBy } from '../lib/catalogOrderBy.js'
import { computeCatalogPagination, PAGE_SIZE } from '../lib/catalogPagination.js'
import { findInvalidReferencedIdFields } from '../lib/catalogIdExistence.js'
import { resolveCatalogFacets } from '../lib/catalogFacets.js'
import { resolvePopularityScores, sortByPopularity } from '../lib/catalogPopularity.js'
import { resolveCatalogFallback, type CatalogFallback } from '../lib/catalogFallback.js'
import { CATALOG_RELATIONS_INCLUDE, findActiveProductBySlug } from '../lib/catalogProductLookup.js'
import { recordFunnelEvent } from '../lib/funnelEvents.js'
import { ensureVisitorId } from '../lib/visitorId.js'
import { createCatalogRateLimiters } from '../lib/rateLimit.js'

export const catalogRouter = Router()

// Checkpoint J correction — the include shapes and the detail lookup moved
// to catalogProductLookup.ts so the §7 not-found guarantee is unit-testable
// rather than only readable. See that module's own doc comment.

// GET /api/categories — the six REQ-F-001 canonical categories, fixed order,
// no product counts. Category tone stays client-owned (getCategoryTone).
//
// 🔴 `imageFile` added by the lecturer-fixes list (2026-08-23): the home
// page's tiles used to MINE their imagery from the newest-products page,
// which covers only the categories that page happens to hold — at DEC-107's
// pageSize 12 that was three of six, and the gap read as a "language
// toggle" bug. The endpoint now answers a representative image per
// category: the NEWEST active product with an image, deterministically
// ordered (createdAt desc, id desc — fixture selection always orders). A
// category with no imaged product answers null and the client keeps its
// reserved-height fallback. Tolerant on the client (absence = null), so
// a client ahead of the server never breaks.
catalogRouter.get('/categories', async (_req, res) => {
  const imaged = await prisma.product.findMany({
    where: { isActive: true, images: { some: {} } },
    select: {
      category: { select: { nameHe: true } },
      images: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], take: 1, select: { url: true } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  })
  const imageByCategory = new Map<string, string>()
  for (const product of imaged) {
    const first = product.images[0]
    if (first && !imageByCategory.has(product.category.nameHe)) {
      imageByCategory.set(product.category.nameHe, toImageRef(first.url))
    }
  }
  res.json({
    items: CANONICAL_CATEGORIES.map(({ nameHe, nameEn, slug }) => ({
      slug,
      nameHe,
      nameEn,
      imageFile: imageByCategory.get(nameHe) ?? null,
    })),
  })
})

// GET /api/catalog/facets — MILESTONE-005 §9d, frozen at Checkpoint A, built
// at Checkpoint D. One read-only endpoint; accepts no query parameters.
catalogRouter.get('/catalog/facets', async (req, res) => {
  const offendingParams = Object.keys(req.query)
  if (offendingParams.length > 0) {
    res.status(400).json({
      error: {
        code: 'UNSUPPORTED_QUERY_PARAMETER',
        message: `Unsupported query parameter(s): ${offendingParams.join(', ')}`,
        fields: offendingParams,
      },
    })
    return
  }

  const facets = await resolveCatalogFacets(prisma)
  res.json(facets)
})

// GET /api/products — MILESTONE-005 §4. Checkpoint C validates and parses
// the query (pure); Checkpoint D executes filtering/sorting/pagination and
// §4b existence+active-usage validation; Checkpoint E adds `q` free-text
// search execution (§3/§3a), composed as one more AND-across group.
// Checkpoint F adds: `sort=popularity` real execution (§6a — 30-day
// SUM(OrderItem.quantity), cancelled excluded, no stored column, sorted in
// application code since no native Prisma ORDER BY exists for a cross-table
// aggregate with nothing stored) and fallback suggestions (§6b) when a
// validated, successful query yields totalItems === 0.
catalogRouter.get('/products', async (req, res) => {
  const parseResult = parseCatalogProductsQuery(req.query as RawCatalogQuery)
  if (!parseResult.ok) {
    res.status(400).json({ error: parseResult.error })
    return
  }
  const query = parseResult.query

  // §4b/§6c: category was already validated against the static canonical
  // slug list at Checkpoint C (categorySlugSchema) — this lookup resolves it
  // to Product.category's actual filter key (nameHe). No DB round trip.
  const categoryNameHe =
    query.category !== undefined ? findCanonicalCategoryBySlug(query.category)?.nameHe : undefined

  // §4b: brand/ingredient/healthGoal are well-formed UUIDs (Checkpoint C) but
  // whether they EXIST and are ALLOWED (used by at least one active product,
  // the same definition §9d's facets endpoint uses) was explicitly deferred
  // here, since it requires a DB round trip Checkpoint C is not allowed to
  // make.
  const invalidReferencedFields = await findInvalidReferencedIdFields(prisma, {
    brand: query.brand,
    ingredient: query.ingredient,
    healthGoal: query.healthGoal,
  })
  if (invalidReferencedFields.length > 0) {
    res.status(400).json({
      error: {
        code: 'INVALID_QUERY_PARAMETER',
        message: `Invalid value for query parameter(s): ${invalidReferencedFields.join(', ')}`,
        fields: invalidReferencedFields,
      },
    })
    return
  }

  const where = buildProductWhere(query, categoryNameHe)

  // Execution order is frozen: totalItems first, then derive totalPages,
  // then decide whether this page has any rows at all BEFORE computing a
  // skip/slice. A zero-result query or a past-the-end page never fetches a
  // page of rows — productsToMap is [] directly.
  let productsToMap: ProductWithCatalogRelations[]
  let totalItems: number
  let totalPages: number

  if (query.sort === 'popularity') {
    // No native Prisma ORDER BY exists for "SUM(OrderItem.quantity) over
    // the last 30 days, cancelled excluded" — there is no stored column to
    // sort by. The matching set is fetched in full (this catalogue's scale
    // makes that the correct "computed at query time, no materialised
    // view" reading of §6a) and sorted in application code.
    const matches = await prisma.product.findMany({ where, include: CATALOG_RELATIONS_INCLUDE })
    totalItems = matches.length
    const pagination = computeCatalogPagination(query.page, totalItems)
    totalPages = pagination.totalPages
    if (!pagination.withinRange) {
      productsToMap = []
    } else {
      const scores = await resolvePopularityScores(prisma, matches.map((product) => product.id))
      const skip = pagination.skip! // withinRange === true guarantees skip is defined
      productsToMap = sortByPopularity(matches, scores).slice(skip, skip + pagination.take)
    }
  } else {
    const orderBy = buildOrderBy(query.sort)
    totalItems = await prisma.product.count({ where })
    const pagination = computeCatalogPagination(query.page, totalItems)
    totalPages = pagination.totalPages
    productsToMap = pagination.withinRange
      ? await prisma.product.findMany({
          where,
          orderBy,
          skip: pagination.skip,
          take: pagination.take,
          include: CATALOG_RELATIONS_INCLUDE,
        })
      : []
  }

  let items: PublicCatalogProduct[]
  let fallback: CatalogFallback | null
  try {
    items = productsToMap.map(mapProductToPublicCatalog)
    // §6b: computed ONLY when the validated, successful query yields
    // totalItems === 0. Ignores every narrowing filter except category —
    // never substituted into items/totalItems/totalPages.
    fallback = totalItems === 0 ? await resolveCatalogFallback(prisma, { categoryNameHe }) : null
  } catch (error) {
    if (error instanceof CatalogIntegrityError) {
      console.error(`[catalog] data integrity failure: ${error.message}`)
      res.status(500).json({
        error: {
          code: 'CATALOG_DATA_INTEGRITY',
          message: 'The catalogue could not be served due to a data-integrity problem.',
        },
      })
      return
    }
    throw error
  }

  res.json({
    items,
    page: query.page,
    pageSize: PAGE_SIZE,
    totalItems,
    totalPages,
    fallback,
  })
})

// GET /api/products/:slug — MILESTONE-005 §7, frozen at Checkpoint A, built
// at Checkpoint J. Slug-keyed (DEC-033), superseding API_CONTRACT.md's
// Proposed /api/products/:id row. Accepts no query parameters.
//
// 🔴 Declared AFTER GET /products so the static path can never be captured
// by this parameterised one. Express matches in declaration order, and
// `/products` has no trailing segment, so the two cannot collide — but the
// ordering is deliberate rather than incidental.
// DEC-101 review — the detail route now records a funnel event, so this is
// the one public route whose every hit writes. The limiter caps what a
// crawler can insert; a human browsing session never approaches it.
const catalogLimiters = createCatalogRateLimiters()

catalogRouter.get('/products/:slug', catalogLimiters.detail, async (req, res) => {
  const offendingParams = Object.keys(req.query)
  if (offendingParams.length > 0) {
    res.status(400).json({
      error: {
        code: 'UNSUPPORTED_QUERY_PARAMETER',
        message: `Unsupported query parameter(s): ${offendingParams.join(', ')}`,
        fields: offendingParams,
      },
    })
    return
  }

  // 🔴 §7's not-found semantics: `isActive: true` is part of the LOOKUP, not
  // a post-filter. An inactive (soft-deleted, INV-03) product and a slug
  // that never existed take the identical path to the identical 404 below —
  // same status, same code, same message — so existence cannot be probed.
  // The `where` shape itself is asserted in catalogProductLookup.test.ts.
  // The middleware-bearing overload widens req.params values to
  // string | string[] | undefined; a non-string here can only mean a
  // malformed path, which takes the same 404 as an unknown slug.
  const slug = typeof req.params.slug === 'string' ? req.params.slug : ''
  const product = await findActiveProductBySlug(prisma, slug)

  if (!product) {
    res.status(404).json({
      error: {
        code: 'PRODUCT_NOT_FOUND',
        message: 'The requested product was not found.',
      },
    })
    return
  }

  let detail: PublicProductDetail
  try {
    detail = mapProductToPublicDetail(product)
  } catch (error) {
    // Same fail-closed behaviour as the list (§7): a non-canonical category
    // is a data-integrity failure, never a partially-mapped product.
    if (error instanceof CatalogIntegrityError) {
      console.error(`[catalog] data integrity failure: ${error.message}`)
      res.status(500).json({
        error: {
          code: 'CATALOG_DATA_INTEGRITY',
          message: 'The catalogue could not be served due to a data-integrity problem.',
        },
      })
      return
    }
    throw error
  }

  // DEC-101 / §4.7.5 — the product_view funnel event. `void`, not awaited:
  // the response owes analytics nothing, and recordFunnelEvent catches its
  // own failures so this can never surface as an unhandled rejection.
  // DEC-103 — the durable visitor id, captured BEFORE res.json (Set-Cookie
  // is a header).
  void recordFunnelEvent(prisma, {
    eventType: 'product_view',
    sessionId: ensureVisitorId(req, res),
    userId: req.session?.userId ?? null,
    productId: product.id,
  })

  res.json(detail)
})
