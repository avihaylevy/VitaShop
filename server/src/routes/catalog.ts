import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { CANONICAL_CATEGORIES } from '../lib/catalogCategories.js'
import { CatalogIntegrityError, mapProductToPublicCatalog } from '../lib/catalogMapper.js'

export const catalogRouter = Router()

const PAGE_SIZE = 24

// GET /api/categories — the six REQ-F-001 canonical categories, fixed order,
// no product counts. Category tone stays client-owned (getCategoryTone).
catalogRouter.get('/categories', (_req, res) => {
  res.json({
    items: CANONICAL_CATEGORIES.map(({ nameHe, nameEn, slug }) => ({ slug, nameHe, nameEn })),
  })
})

// GET /api/products — no server-side query parameters supported yet
// (Slice 6 Checkpoint A). ?category=<slug> is a client-side local filter on
// this same full response, never sent to the server.
catalogRouter.get('/products', async (req, res) => {
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

  const products = await prisma.product.findMany({
    where: { isActive: true },
    orderBy: { slug: 'asc' },
    include: { category: true, brand: true, images: true },
  })

  let items
  try {
    items = products.map(mapProductToPublicCatalog)
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

  const totalItems = items.length
  res.json({
    items,
    page: 1,
    pageSize: PAGE_SIZE,
    totalItems,
    totalPages: Math.ceil(totalItems / PAGE_SIZE),
  })
})
