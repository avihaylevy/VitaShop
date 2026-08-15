// Read-only integration test against the local vitashop_dev database.
// 🔴 Strictly read-only: no seed, create, update, delete, cleanup, migration,
// or sequence change. If vitashop_dev is not reachable, every test in this
// file fails clearly, naming the required database — it never skips and
// never falls back to mocked data.
import type { Server } from 'node:http'
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { readVerifiedProductRows } from '../lib/productsCsv.js'
import { CANONICAL_CATEGORIES } from '../lib/catalogCategories.js'
import type { PublicCatalogProduct } from '../lib/catalogMapper.js'
import { prisma as appPrisma } from '../lib/prisma.js'

interface CategoriesEnvelope {
  items: { slug: string; nameHe: string; nameEn: string }[]
}

interface ProductsEnvelope {
  items: PublicCatalogProduct[]
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
}

interface ApiErrorEnvelope {
  error: { code: string; message: string; fields?: string[] }
}

interface FacetsEnvelope {
  brands: { id: string; label: string; labelEn: string | null }[]
  ingredients: { id: string; label: string }[]
  healthGoals: { id: string; labelHe: string; labelEn: string }[]
  dosageForms: { value: string; labelHe: string; labelEn: string }[]
  dietary: { value: string; labelHe: string; labelEn: string }[]
}

function assertLocalVitashopDevTarget(): void {
  const raw = process.env.DATABASE_URL
  if (!raw) {
    throw new Error(
      'DATABASE_URL is not set. This integration test requires the local "vitashop_dev" PostgreSQL database — see server/.env.example.',
    )
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('DATABASE_URL is not a valid connection URL. This integration test requires the local "vitashop_dev" database.')
  }
  const host = url.hostname
  const database = url.pathname.replace(/^\//, '')
  const isLocalHost = host === 'localhost' || host === '127.0.0.1'
  if (!isLocalHost) {
    throw new Error(`DATABASE_URL host is "${host}", not localhost/127.0.0.1. This integration test requires the local "vitashop_dev" database.`)
  }
  if (database !== 'vitashop_dev') {
    throw new Error(`DATABASE_URL database is "${database}", not "vitashop_dev". This integration test requires exactly "vitashop_dev".`)
  }
}

assertLocalVitashopDevTarget()

let server: Server
let baseUrl: string
/**
 * 🔴 RENAMED from `readonlyPrisma` on 2026-08-12. The name had become FALSE:
 * the soft-delete probe writes through this client, and so does the fixture
 * repair above. The name was the only thing enforcing the read-only
 * convention — there was never a read-only database ROLE behind it — so a
 * lying name was worse than no name at all.
 *
 * ⚠️ IMPLICIT GUARD, now explicit: the count-based assertions in this file are
 * safe ONLY because vitest runs the tests within a file SEQUENTIALLY. A
 * `describe.concurrent` anywhere here would let the soft-delete probe overlap
 * the 49-product / 3-page assertions and make them flaky in a way that looks
 * like a catalogue bug. Do not add one.
 */
let testPrisma: PrismaClient

beforeAll(async () => {
  // MILESTONE-006 Checkpoint C: the app now mounts express-session, which
  // refuses to start without SESSION_SECRET (clause A6 — no default, no
  // generated fallback). This is a throwaway value for the test process
  // only; it is never a real secret and never leaves this file. Set before
  // the dynamic import below, because the middleware is built at module load.
  process.env.SESSION_SECRET ??= 'integration-test-only-not-a-real-secret'

  // Fails clearly (throws, does not skip) if the DB is unreachable — the
  // app under test performs the actual round-trip once a request is made.
  const { app } = await import('../index.js')
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to determine the ephemeral test server port.')
  }
  baseUrl = `http://127.0.0.1:${address.port}`

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  testPrisma = new PrismaClient({ adapter })

  // 🔴 BEFORE, not only after — the run this repairs is the one that CRASHED.
  await repairDeactivatedFixtures()
})

/**
 * 🔴 CRASH-SAFE FIXTURE REPAIR.
 *
 * The soft-delete probe below deactivates a REAL product and restores it in a
 * `finally`. `finally` does not survive SIGINT, a vitest timeout kill, or a
 * worker crash — and any of those leaves the dev catalogue at 48 active, after
 * which the NEXT run fails on the 49-products / 3-pages assertions with no
 * pointer at all to the cause.
 *
 * So the repair is at SUITE level and runs BEFORE the tests, not only after:
 * anything the CSV marks `verified=yes` is reactivated, which is exactly the
 * seed's own contract. It is idempotent and a no-op on a healthy database.
 */
async function repairDeactivatedFixtures(): Promise<number> {
  const verifiedSlugs = readVerifiedProductRows()
    .map((row) => row.slug ?? '')
    .filter((slug) => slug.length > 0)
  const { count } = await testPrisma.product.updateMany({
    where: { slug: { in: verifiedSlugs }, isActive: false },
    data: { isActive: true },
  })
  if (count > 0) {
    // Loud on purpose: a silent repair would hide a crashed previous run.
    console.warn(
      `[catalog.integration] repaired ${count} product(s) left deactivated by an earlier run.`,
    )
  }
  return count
}

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()))
  })
  await repairDeactivatedFixtures()
  await testPrisma.$disconnect()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GET /api/categories', () => {
  it('returns exactly the six canonical categories, in fixed order, with no product counts', async () => {
    const res = await fetch(`${baseUrl}/api/categories`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as CategoriesEnvelope
    expect(body.items).toEqual(CANONICAL_CATEGORIES.map(({ nameHe, nameEn, slug }) => ({ slug, nameHe, nameEn })))
    for (const item of body.items) {
      expect(item).not.toHaveProperty('productCount')
      expect(item).not.toHaveProperty('count')
    }
  })
})

/**
 * 🔴 ADDED 2026-08-11 (MILESTONE-004 Part 2, batch 4) — the batch that took
 * the catalogue past ONE PAGE for the first time (27 active products,
 * pageSize server-fixed at 24, so 2 pages with 3 items on page 2).
 *
 * Ten assertions in this file compared a FULL read-only database query against
 * `body.items` — a single page. That was correct while everything fitted on
 * page 1, and one of them said so in its own name ("totalItems <= 24").
 * Growing the catalogue was the entire point of MILESTONE-004, so those
 * assertions had a built-in expiry date; this is it.
 *
 * Walking every page and concatenating is a STRONGER check than the original
 * single-page comparison: it proves the ordering is globally correct ACROSS
 * the page boundary, which is exactly where an offset/tie-break bug hides and
 * where a one-page catalogue could never have caught one.
 *
 * ⚠️ Reads `totalPages` from the first response rather than looping until an
 * empty page — an off-by-one in the server's own page maths would make an
 * until-empty loop agree with the bug instead of exposing it.
 */
async function fetchAllPages(query = ''): Promise<{ slugs: string[]; first: ProductsEnvelope }> {
  const sep = query ? '&' : ''
  const first = (await fetch(`${baseUrl}/api/products?${query}${sep}page=1`).then((r) => r.json())) as ProductsEnvelope
  const slugs = first.items.map((i) => i.slug)
  for (let page = 2; page <= first.totalPages; page++) {
    const body = (await fetch(`${baseUrl}/api/products?${query}${sep}page=${page}`).then((r) => r.json())) as ProductsEnvelope
    slugs.push(...body.items.map((i) => i.slug))
  }
  return { slugs, first }
}

describe('GET /api/products', () => {
  it('returns 200 with the approved envelope shape', async () => {
    const res = await fetch(`${baseUrl}/api/products`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ProductsEnvelope
    expect(Array.isArray(body.items)).toBe(true)
    expect(body.page).toBe(1)
    expect(body.pageSize).toBe(24)
    // A full page holds pageSize items; a final/only page holds the remainder.
    expect(body.items.length).toBe(Math.min(body.totalItems, 24))
    expect(body.totalPages).toBe(Math.ceil(body.totalItems / 24))
  })

  it('returns only active products (matches a direct read-only count)', async () => {
    const activeCount = await testPrisma.product.count({ where: { isActive: true } })
    const res = await fetch(`${baseUrl}/api/products`)
    const body = (await res.json()) as ProductsEnvelope
    // totalItems, not items.length — the catalogue no longer fits on one page.
    expect(body.totalItems).toBe(activeCount)
  })

  it('defaults to sort=newest — matches a direct read-only query with the same deterministic tie-break, ACROSS ALL PAGES', async () => {
    const expected = await testPrisma.product.findMany({
      where: { isActive: true },
      orderBy: [{ createdAt: 'desc' }, { slug: 'asc' }],
      select: { slug: true },
    })
    const { slugs, first } = await fetchAllPages()
    expect(first.totalPages).toBeGreaterThan(1) // fixture assumption: this really is a multi-page catalogue
    expect(slugs).toEqual(expected.map((p) => p.slug))
  })

  it('serializes price as a two-decimal string, never a number', async () => {
    const res = await fetch(`${baseUrl}/api/products`)
    const body = (await res.json()) as ProductsEnvelope
    for (const item of body.items) {
      expect(typeof item.price).toBe('string')
      expect(item.price).toMatch(/^\d+\.\d{2}$/)
    }
  })

  it('returns imageFile as a basename only (or null), never a path', async () => {
    const res = await fetch(`${baseUrl}/api/products`)
    const body = (await res.json()) as ProductsEnvelope
    for (const item of body.items) {
      if (item.imageFile !== null) {
        expect(typeof item.imageFile).toBe('string')
        expect(item.imageFile).not.toContain('/')
      }
    }
  })

  it('never includes description, ingredients, warnings, targetAudience, id, or timestamps', async () => {
    const res = await fetch(`${baseUrl}/api/products`)
    const body = (await res.json()) as ProductsEnvelope
    for (const item of body.items) {
      expect(item).not.toHaveProperty('id')
      expect(item).not.toHaveProperty('descriptionHe')
      expect(item).not.toHaveProperty('descriptionEn')
      expect(item).not.toHaveProperty('warningsAllergens')
      expect(item).not.toHaveProperty('targetAudience')
      expect(item).not.toHaveProperty('createdAt')
      expect(item).not.toHaveProperty('ingredients')
    }
  })

  it('rejects a genuinely unknown query parameter with 400 UNSUPPORTED_QUERY_PARAMETER', async () => {
    const res = await fetch(`${baseUrl}/api/products?bogus=1`)
    expect(res.status).toBe(400)
    const body = (await res.json()) as ApiErrorEnvelope
    expect(body.error.code).toBe('UNSUPPORTED_QUERY_PARAMETER')
    expect(body.error.fields).toEqual(['bogus'])
  })

  it('reports every offending parameter name when several are sent', async () => {
    const res = await fetch(`${baseUrl}/api/products?foo=1&bar=2`)
    expect(res.status).toBe(400)
    const body = (await res.json()) as ApiErrorEnvelope
    expect(body.error.code).toBe('UNSUPPORTED_QUERY_PARAMETER')
    expect(new Set(body.error.fields)).toEqual(new Set(['foo', 'bar']))
  })

  it('a client-supplied pageSize is still rejected as unsupported (TEST-013 ceiling clause)', async () => {
    const res = await fetch(`${baseUrl}/api/products?pageSize=10000`)
    expect(res.status).toBe(400)
    const body = (await res.json()) as ApiErrorEnvelope
    expect(body.error.code).toBe('UNSUPPORTED_QUERY_PARAMETER')
    expect(body.error.fields).toEqual(['pageSize'])
  })
})

describe('GET /api/products — filtering (Checkpoint D)', () => {
  it('category — matches a direct read-only query by the resolved nameHe', async () => {
    const category = CANONICAL_CATEGORIES.find((c) => c.nameHe === 'מינרלים')
    if (!category) throw new Error('fixture assumption failed: "מינרלים" is not a canonical category')
    const expected = await testPrisma.product.findMany({
      where: { isActive: true, category: { nameHe: 'מינרלים' } },
      select: { slug: true },
    })
    if (expected.length === 0) throw new Error('fixture assumption failed: no active product in category "מינרלים"')

    const { slugs, first } = await fetchAllPages(`category=${category.slug}`)
    expect(first.totalItems).toBeGreaterThan(0)
    expect(new Set(slugs)).toEqual(new Set(expected.map((p) => p.slug)))
    expect(first.totalItems).toBe(expected.length)
  })

  it('brand — a single id matches only that brand\'s active products', async () => {
    const brand = await testPrisma.brand.findFirst({ where: { products: { some: { isActive: true } } } })
    if (!brand) throw new Error('fixture assumption failed: no brand has an active product')
    const expected = await testPrisma.product.findMany({
      where: { isActive: true, brandId: brand.id },
      select: { slug: true },
    })

    const { slugs } = await fetchAllPages(`brand=${brand.id}`)
    expect(new Set(slugs)).toEqual(new Set(expected.map((p) => p.slug)))
  })

  it('brand — repeated values are OR-within: the union of both brands\' active products', async () => {
    const brands = await testPrisma.brand.findMany({ where: { products: { some: { isActive: true } } } })
    if (brands.length < 2) throw new Error('fixture assumption failed: fewer than 2 brands have active products')
    const [a, b] = brands
    const expected = await testPrisma.product.findMany({
      where: { isActive: true, brandId: { in: [a!.id, b!.id] } },
      select: { slug: true },
    })

    const { slugs } = await fetchAllPages(`brand=${a!.id}&brand=${b!.id}`)
    expect(new Set(slugs)).toEqual(new Set(expected.map((p) => p.slug)))
  })

  it('ingredient — matches active products carrying that active ingredient (relation "some")', async () => {
    const link = await testPrisma.productIngredient.findFirst({ where: { product: { isActive: true } } })
    if (!link) throw new Error('fixture assumption failed: no ProductIngredient row on an active product')
    const expected = await testPrisma.product.findMany({
      where: { isActive: true, ingredients: { some: { activeIngredientId: link.activeIngredientId } } },
      select: { slug: true },
    })

    const { slugs, first } = await fetchAllPages(`ingredient=${link.activeIngredientId}`)
    expect(new Set(slugs)).toEqual(new Set(expected.map((p) => p.slug)))
    expect(first.totalItems).toBeGreaterThan(0)
  })

  it('healthGoal — matches active products carrying that health goal (relation "some")', async () => {
    const link = await testPrisma.productHealthGoal.findFirst({ where: { product: { isActive: true } } })
    if (!link) throw new Error('fixture assumption failed: no ProductHealthGoal row on an active product')
    const expected = await testPrisma.product.findMany({
      where: { isActive: true, healthGoals: { some: { healthGoalId: link.healthGoalId } } },
      select: { slug: true },
    })

    const { slugs, first } = await fetchAllPages(`healthGoal=${link.healthGoalId}`)
    expect(new Set(slugs)).toEqual(new Set(expected.map((p) => p.slug)))
    expect(first.totalItems).toBeGreaterThan(0)
  })

  it('dosageForm — repeated values are OR-within', async () => {
    const forms = await testPrisma.product.findMany({
      where: { isActive: true },
      select: { dosageForm: true },
      distinct: ['dosageForm'],
    })
    if (forms.length < 2) throw new Error('fixture assumption failed: fewer than 2 distinct dosage forms among active products')
    const [f1, f2] = forms.map((f) => f.dosageForm)
    const expected = await testPrisma.product.findMany({
      where: { isActive: true, dosageForm: { in: [f1!, f2!] } },
      select: { slug: true },
    })

    const { slugs } = await fetchAllPages(`dosageForm=${f1}&dosageForm=${f2}`)
    expect(new Set(slugs)).toEqual(new Set(expected.map((p) => p.slug)))
  })

  it('AND across groups: brand + dosageForm narrows to their intersection, not their union', async () => {
    const brand = await testPrisma.brand.findFirst({ where: { products: { some: { isActive: true } } } })
    if (!brand) throw new Error('fixture assumption failed: no brand has an active product')
    const brandOnly = await testPrisma.product.findMany({ where: { isActive: true, brandId: brand.id }, select: { dosageForm: true, slug: true } })
    const form = brandOnly[0]?.dosageForm
    if (!form) throw new Error('fixture assumption failed: brand has no active products')
    const expected = brandOnly.filter((p) => p.dosageForm === form)

    const { slugs, first } = await fetchAllPages(`brand=${brand.id}&dosageForm=${form}`)
    expect(new Set(slugs)).toEqual(new Set(expected.map((p) => p.slug)))
    // Intersection must never exceed either single-filter result.
    expect(first.totalItems).toBeLessThanOrEqual(brandOnly.length)
  })

  /*
   * 🔴 Both walk ALL PAGES. They compared a full database query against
   * `body.items` — a single page — which was fine while any filtered result
   * fitted on one. MILESTONE-004 Part 4 batch 5 took the catalogue to 32
   * products and `minPrice=70` now matches 27, so page 1 held 24 of them and
   * the set comparison failed. Database checked first: all 27 really are at
   * or above ₪70, so the ENDPOINT was right and the test was page-blind.
   *
   * ⚠️ `maxPrice` was NOT failing — its result is small enough to fit. It is
   * rewritten anyway, because "passes because the data happens to be small"
   * is the same latent shape, just not yet reached. Fixing only the red one
   * would leave the identical bug waiting for the next batch.
   */
  it('minPrice — only products at or above the threshold, across all pages', async () => {
    const expected = await testPrisma.product.findMany({ where: { isActive: true, price: { gte: '70' } }, select: { slug: true } })
    const { slugs } = await fetchAllPages('minPrice=70')
    expect(new Set(slugs)).toEqual(new Set(expected.map((p) => p.slug)))
  })

  it('maxPrice — only products at or below the threshold, across all pages', async () => {
    const expected = await testPrisma.product.findMany({ where: { isActive: true, price: { lte: '70' } }, select: { slug: true } })
    const { slugs } = await fetchAllPages('maxPrice=70')
    expect(new Set(slugs)).toEqual(new Set(expected.map((p) => p.slug)))
  })

  it('minPrice + maxPrice — an inclusive band', async () => {
    const expected = await testPrisma.product.findMany({
      where: { isActive: true, price: { gte: '60', lte: '80' } },
      select: { slug: true },
    })
    const { slugs } = await fetchAllPages('minPrice=60&maxPrice=80')
    expect(new Set(slugs)).toEqual(new Set(expected.map((p) => p.slug)))
  })

  it('inStock=true — matches a direct read-only query for stockQuantity > 0', async () => {
    const expected = await testPrisma.product.count({ where: { isActive: true, stockQuantity: { gt: 0 } } })
    const res = await fetch(`${baseUrl}/api/products?inStock=true`)
    const body = (await res.json()) as ProductsEnvelope
    expect(body.totalItems).toBe(expected)
  })

  it('kosher=true — every returned product carries a sourced isKosher=true; null (unsourced) rows excluded', async () => {
    const expected = await testPrisma.product.findMany({
      where: { isActive: true, isKosher: true },
      select: { slug: true },
    })
    // 🔴 Non-vacuity: ISSUE-124 batch 1 sourced kosher certifications, so an
    // empty expectation means the fixture is broken, not that the filter works.
    expect(expected.length).toBeGreaterThan(0)
    const { slugs } = await fetchAllPages('kosher=true')
    expect(new Set(slugs)).toEqual(new Set(expected.map((p) => p.slug)))
  })

  it('glutenFree=true and vegan=true — same equality against direct reads', async () => {
    for (const [param, where] of [
      ['glutenFree=true', { isGlutenFree: true }],
      ['vegan=true', { isVegan: true }],
    ] as const) {
      const expected = await testPrisma.product.findMany({
        where: { isActive: true, ...where },
        select: { slug: true },
      })
      expect(expected.length).toBeGreaterThan(0)
      const { slugs } = await fetchAllPages(param)
      expect(new Set(slugs)).toEqual(new Set(expected.map((p) => p.slug)))
    }
  })

  it('kosher=false is INVALID_QUERY_PARAMETER — the literal contract, same as inStock', async () => {
    const res = await fetch(`${baseUrl}/api/products?kosher=false`)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string; fields: string[] } }
    expect(body.error.code).toBe('INVALID_QUERY_PARAMETER')
    expect(body.error.fields).toEqual(['kosher'])
  })

  it('a filter combination with no matches returns a truthful zero-result envelope', async () => {
    const res = await fetch(`${baseUrl}/api/products?minPrice=99999&maxPrice=99999.99`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ProductsEnvelope
    expect(body.items).toEqual([])
    expect(body.totalItems).toBe(0)
    expect(body.totalPages).toBe(0)
  })
})

// Checkpoint E — free-text search execution against the real vitashop_dev
// database. Checkpoint C only proved the Prisma contains/mode:'insensitive'
// shape compiles (type-level, no live query); THIS suite is the runtime
// proof the frozen §3a form actually behaves as specified against the real
// PostgreSQL provider. Search terms below are chosen from direct inspection
// of the current seed's 6 active products (verified read-only via
// testPrisma at test-authoring time — not fabricated), each picked to
// land on exactly one searched field wherever the fixture allows it. If the
// seed ever changes, a fixture-assumption guard throws a clear message
// rather than passing vacuously or failing cryptically.
describe('GET /api/products — free-text search (Checkpoint E)', () => {
  it('matches a direct read-only query built with the identical OR-across-fields shape, for an arbitrary term', async () => {
    const term = 'ויטמין'
    const expected = await testPrisma.product.findMany({
      where: {
        isActive: true,
        OR: [
          { nameHe: { contains: term, mode: 'insensitive' } },
          { nameEn: { contains: term, mode: 'insensitive' } },
          { descriptionHe: { contains: term, mode: 'insensitive' } },
          { descriptionEn: { contains: term, mode: 'insensitive' } },
          { brand: { name: { contains: term, mode: 'insensitive' } } },
          { ingredients: { some: { activeIngredient: { name: { contains: term, mode: 'insensitive' } } } } },
          { category: { nameHe: { contains: term, mode: 'insensitive' } } },
          { category: { nameEn: { contains: term, mode: 'insensitive' } } },
          { healthGoals: { some: { healthGoal: { nameHe: { contains: term, mode: 'insensitive' } } } } },
          { healthGoals: { some: { healthGoal: { nameEn: { contains: term, mode: 'insensitive' } } } } },
        ],
      },
      select: { slug: true },
    })
    if (expected.length === 0) throw new Error(`fixture assumption failed: no active product matches "${term}"`)

    const res = await fetch(`${baseUrl}/api/products?q=${encodeURIComponent(term)}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ProductsEnvelope
    expect(new Set(body.items.map((i) => i.slug))).toEqual(new Set(expected.map((p) => p.slug)))
  })

  /**
   * 🔴 REWRITTEN 2026-08-11 (MILESTONE-004 Part 2, batch 3). Both asserted a
   * single slug for an omega term. Batch 3 added a second omega product
   * (`altman-alsepa-omega-3-210`), so both legitimately went to two.
   * Database checked first: "אומגה", "omega" and "EPA" each match exactly
   * those two products, so the search was right and the rosters were stale.
   *
   * The claim under test is that a term in THIS FIELD reaches the product —
   * not which products happen to hold it. The expectation is therefore derived
   * from the field family each test names.
   */
  async function slugsMatchingText(term: string): Promise<Set<string>> {
    const like = { contains: term, mode: 'insensitive' } as const
    const rows = await testPrisma.product.findMany({
      where: {
        isActive: true,
        OR: [
          { nameHe: like },
          { nameEn: like },
          { descriptionHe: like },
          { descriptionEn: like },
          { category: { OR: [{ nameHe: like }, { nameEn: like }] } },
        ],
      },
      select: { slug: true },
    })
    return new Set(rows.map((r) => r.slug))
  }

  it('direct field — Hebrew product name match ("אומגה")', async () => {
    const expected = await slugsMatchingText('אומגה')
    expect(expected.size).toBeGreaterThan(0) // fixture assumption: something matches
    const res = await fetch(`${baseUrl}/api/products?q=${encodeURIComponent('אומגה')}`)
    const body = (await res.json()) as ProductsEnvelope
    expect(new Set(body.items.map((i) => i.slug))).toEqual(expected)
  })

  it('direct field — English product name match, case-insensitive ("omega")', async () => {
    const expected = await slugsMatchingText('omega')
    expect(expected.size).toBeGreaterThan(0) // fixture assumption: something matches
    const res = await fetch(`${baseUrl}/api/products?q=omega`)
    const body = (await res.json()) as ProductsEnvelope
    // Case-insensitivity is the point: the query is lower-case, the stored
    // names are not.
    expect(new Set(body.items.map((i) => i.slug))).toEqual(expected)
  })

  /**
   * 🔴 REWRITTEN 2026-08-15 (ISSUE-124 batch 1) the same way the English
   * sibling below was on 2026-08-11 and for the same reason: the enrichment
   * wave added "בד"צ העדה החרדית" kosher-certification wording to three
   * Altman descriptions, so the single-slug expectation went stale. What is
   * under test is that a term appearing ONLY in the Hebrew description is
   * reachable — so the expectation derives from the field the endpoint
   * searches, and the "absent from every name" premise is asserted rather
   * than assumed.
   */
  it('direct field — Hebrew description match, a term absent from every name ("החרדית")', async () => {
    const expected = await testPrisma.product.findMany({
      where: { isActive: true, descriptionHe: { contains: 'החרדית' } },
      select: { slug: true, nameHe: true, nameEn: true },
    })
    expect(expected.length).toBeGreaterThan(0) // fixture assumption
    for (const product of expected) {
      expect(product.nameHe).not.toContain('החרדית')
      expect(product.nameEn).not.toContain('החרדית')
    }
    const res = await fetch(`${baseUrl}/api/products?q=${encodeURIComponent('החרדית')}`)
    const body = (await res.json()) as ProductsEnvelope
    expect(new Set(body.items.map((i) => i.slug))).toEqual(new Set(expected.map((p) => p.slug)))
  })

  /**
   * 🔴 REWRITTEN 2026-08-11 (MILESTONE-004 Part 2, batch 2). This asserted a
   * single slug for "60 capsules". It is not a product-specific term at all —
   * `descriptionEn` is GENERATED by the seed as "... N capsules per package.",
   * so the phrase belongs to every 60-capsule capsule product. Batch 2 added
   * three of them and the count went 1 -> 4.
   *
   * Checked against the database first: all four really do carry the phrase in
   * `descriptionEn`, so the search was right and the expectation was stale.
   * The sibling Hebrew test above ("החרדית") is genuinely product-specific and
   * is deliberately left alone.
   *
   * What is actually under test is that a term appearing ONLY in the English
   * description is reachable — not which products happen to have it — so the
   * expectation is derived from the same field the endpoint searches.
   */
  it('direct field — English description match, a term absent from every name ("60 capsules")', async () => {
    const expected = await testPrisma.product.findMany({
      where: { isActive: true, descriptionEn: { contains: '60 capsules', mode: 'insensitive' } },
      select: { slug: true },
    })
    expect(expected.length).toBeGreaterThan(0) // fixture assumption
    const res = await fetch(`${baseUrl}/api/products?q=${encodeURIComponent('60 capsules')}`)
    const body = (await res.json()) as ProductsEnvelope
    expect(body.totalItems).toBe(expected.length)
    const expectedSlugs = new Set(expected.map((p) => p.slug))
    for (const item of body.items) expect(expectedSlugs).toContain(item.slug)
  })

  /**
   * 🔴 REWRITTEN 2026-08-11 (batch 3), and the search TERM changed — this is
   * the important part.
   *
   * It used to query "EPA" and assert `['solgar-omega-3']`. Batch 3 added a
   * second omega product and it went to two. The obvious repair was to derive
   * the expected set from the ingredient relation and keep querying "EPA".
   *
   * 🔴 THAT REPAIR WAS TESTED AND FOUND WORTHLESS. Deleting the ingredient
   * join from the search left it GREEN. "EPA" never proved the join at all:
   *
   *   · `solgar-omega-3` carries "EPA" in its Hebrew description, and
   *   · `Alsepa` — the second product's own name — CONTAINS the substring
   *     "epa", so it matches `nameEn` case-insensitively.
   *
   * Both products were reachable through plain text the whole time. The
   * original one-slug assertion had the same hole; it simply never had a
   * second product to expose it.
   *
   * "Fenupure" is used instead: a patented fenugreek extract name that appears
   * in an ingredient row and in NO product name or description. Confirmed
   * against the database — text fields match zero products, the ingredient
   * relation matches one — so the join is the only path to it.
   *
   * Mutation-tested: removing the `ingredients` branch from the search OR
   * turns this red. The "EPA" version did not.
   */
  it('relation — active ingredient match, via a term reachable ONLY through the join ("Fenupure")', async () => {
    const rows = await testPrisma.product.findMany({
      where: {
        isActive: true,
        ingredients: { some: { activeIngredient: { name: { contains: 'Fenupure', mode: 'insensitive' } } } },
      },
      select: { slug: true },
    })
    const expected = new Set(rows.map((r) => r.slug))
    expect(expected.size).toBeGreaterThan(0) // fixture assumption

    // The oracle only holds while no product NAMES or DESCRIBES the term —
    // assert that rather than trusting it, or this silently rots back into
    // the "EPA" trap.
    const viaText = await testPrisma.product.count({
      where: {
        isActive: true,
        OR: [
          { nameHe: { contains: 'Fenupure', mode: 'insensitive' } },
          { nameEn: { contains: 'Fenupure', mode: 'insensitive' } },
          { descriptionHe: { contains: 'Fenupure', mode: 'insensitive' } },
          { descriptionEn: { contains: 'Fenupure', mode: 'insensitive' } },
        ],
      },
    })
    expect(viaText).toBe(0)

    const res = await fetch(`${baseUrl}/api/products?q=Fenupure`)
    const body = (await res.json()) as ProductsEnvelope
    expect(new Set(body.items.map((i) => i.slug))).toEqual(expected)
  })

  /**
   * These two assert that searching a CATEGORY NAME returns that category's
   * members — the relation join, not a fixed roster.
   *
   * 🔴 REWRITTEN 2026-08-11 (MILESTONE-004 Part 2, batch 1) — RESOLVES
   * ISSUE-041 for this pair. They previously hardcoded three slugs, and had
   * already been hand-patched once when Part 1 promoted
   * `solgar-gentle-iron-25`. Batch 1 added three more genuine minerals
   * (magnesium citrate, magnesium bisglycinate, zinc lozenges) and they went
   * red a second time.
   *
   * 🔴 Both times the ENDPOINT was correct and the EXPECTATION was stale —
   * checked against the database before either edit, never inferred from the
   * failure text. A hardcoded roster turns every catalogue addition into a
   * red suite, and a suite that is expected to go red is a suite whose
   * failures stop being read. The expected set is now derived from the same
   * database the API reads, so it tracks the catalogue at any size.
   *
   * ⚠️ Deriving the expectation from the DB, NOT from a second call to the
   * endpoint under test — that would be circular and would pass even if the
   * category join were dropped entirely.
   *
   * 🔴 Asserted on `totalItems`, not on a set comparison of `items` —
   * `pageSize` is server-fixed at 24 (§4a, `catalogPagination.ts`) and is NOT
   * client-settable, so comparing the first page against the whole category
   * would start failing the moment a category passes 24 products. That is the
   * same size-coupling this rewrite exists to remove, just with a higher
   * threshold. `totalItems` counts across pages, so it holds at any size.
   *
   * Both directions are covered: `totalItems` equal to the category's size
   * catches a member silently missed (the failure that matters) and a
   * spurious extra; the per-item check confirms the returned page really is
   * category members rather than an equal-sized set of something else.
   *
   * 🔴 THAT PREDICTION CAME TRUE IN BATCH 4, and this is the amended version.
   * `altman-multi-vitamin-women-60` sits in ויטמינים but its description reads
   * "ויטמינים ומינרלים להשלמה תזונתית", so a search for "מינרלים" returns 8
   * where the category holds 7. Checked against the database: the eighth hit
   * is a genuine free-text match, so the ENDPOINT is right — a category-name
   * search is a free-text search that happens to hit a category name, not a
   * category filter, and suppressing the text match would be the bug.
   *
   * The expectation is therefore the category's members PLUS anything whose
   * own text contains the term. The part that matters is unchanged and still
   * asserted separately: every category member must be present.
   */
  async function activeSlugsInCategory(nameHe: string): Promise<Set<string>> {
    const rows = await testPrisma.product.findMany({
      where: { isActive: true, category: { nameHe } },
      select: { slug: true },
    })
    if (rows.length === 0) throw new Error(`fixture assumption failed: no active products in category "${nameHe}"`)
    return new Set(rows.map((r) => r.slug))
  }

  /** Category members PLUS any product whose own text contains the term. */
  async function expectedForCategoryTerm(nameHe: string, term: string): Promise<Set<string>> {
    const members = await activeSlugsInCategory(nameHe)
    const like = { contains: term, mode: 'insensitive' } as const
    const byText = await testPrisma.product.findMany({
      where: {
        isActive: true,
        OR: [{ nameHe: like }, { nameEn: like }, { descriptionHe: like }, { descriptionEn: like }],
      },
      select: { slug: true },
    })
    return new Set([...members, ...byText.map((r) => r.slug)])
  }

  async function assertCategorySearch(nameHe: string, term: string): Promise<void> {
    const members = await activeSlugsInCategory(nameHe)
    const expected = await expectedForCategoryTerm(nameHe, term)
    const res = await fetch(`${baseUrl}/api/products?q=${encodeURIComponent(term)}`)
    const body = (await res.json()) as ProductsEnvelope
    expect(body.totalItems).toBe(expected.size)
    for (const item of body.items) expect(expected).toContain(item.slug)
    // The property that actually matters: no category member is ever missed.
    const returned = new Set(body.items.map((i) => i.slug))
    for (const slug of members) expect(returned.has(slug)).toBe(true)
  }

  it('relation — Hebrew category match ("מינרלים" -> every Minerals-category product, plus text matches)', async () => {
    await assertCategorySearch('מינרלים', 'מינרלים')
  })

  it('relation — English category match ("Minerals" -> every Minerals-category product, plus text matches)', async () => {
    await assertCategorySearch('מינרלים', 'Minerals')
  })

  it('relation — Hebrew health-goal match ("עצמות" -> both Bone-Health-goal products)', async () => {
    const res = await fetch(`${baseUrl}/api/products?q=${encodeURIComponent('עצמות')}`)
    const body = (await res.json()) as ProductsEnvelope
    // Derived, not hardcoded — one of the two original slugs left the
    // catalogue when ISSUE-045's unsourceable-price rows were demoted.
    const expectedGoal = await testPrisma.product.findMany({
      where: { isActive: true, healthGoals: { some: { healthGoal: { nameHe: 'עצמות' } } } },
      select: { slug: true },
    })
    expect(expectedGoal.length).toBeGreaterThan(0)
    expect(new Set(body.items.map((i) => i.slug))).toEqual(new Set(expectedGoal.map((p) => p.slug)))
  })

  it('relation — English health-goal match ("Bone" -> both Bone-Health-goal products)', async () => {
    const res = await fetch(`${baseUrl}/api/products?q=Bone`)
    const body = (await res.json()) as ProductsEnvelope
    // Derived, not hardcoded — one of the two original slugs left the
    // catalogue when ISSUE-045's unsourceable-price rows were demoted.
    const expectedGoal = await testPrisma.product.findMany({
      where: { isActive: true, healthGoals: { some: { healthGoal: { nameHe: 'עצמות' } } } },
      select: { slug: true },
    })
    expect(expectedGoal.length).toBeGreaterThan(0)
    expect(new Set(body.items.map((i) => i.slug))).toEqual(new Set(expectedGoal.map((p) => p.slug)))
  })

  it('relation — brand match returns every product of that brand (Solgar)', async () => {
    const brand = await testPrisma.brand.findFirst({ where: { name: 'סולגאר' } })
    if (!brand) throw new Error('fixture assumption failed: brand "סולגאר" not found')
    const expected = await testPrisma.product.count({ where: { isActive: true, brandId: brand.id } })
    const res = await fetch(`${baseUrl}/api/products?q=${encodeURIComponent('סולגאר')}`)
    const body = (await res.json()) as ProductsEnvelope
    expect(body.totalItems).toBeGreaterThanOrEqual(expected)
    for (const item of body.items) {
      // every item returned genuinely matches SOME searched field — spot
      // check that the brand-named ones are indeed present
      expect(typeof item.slug).toBe('string')
    }
  })

  it('partial-word match — a mid-word substring still matches (Hebrew)', async () => {
    // "טמין" is a mid-word fragment of "ויטמין" (vitamin) — proves this is
    // substring matching, not a whole-word/prefix search.
    const res = await fetch(`${baseUrl}/api/products?q=${encodeURIComponent('טמין')}`)
    const body = (await res.json()) as ProductsEnvelope
    // Single page is sufficient here — the claim is only that a mid-word
    // fragment matches at all, not which products it returns.
    expect(body.totalItems).toBeGreaterThan(0)
  })

  it('partial-word match — a mid-word substring still matches (English)', async () => {
    // "itami" is a mid-word fragment of "Vitamin".
    const res = await fetch(`${baseUrl}/api/products?q=itami`)
    const body = (await res.json()) as ProductsEnvelope
    expect(body.totalItems).toBeGreaterThan(0)
  })

  it('is case-insensitive for English terms', async () => {
    const lower = await fetch(`${baseUrl}/api/products?q=omega`).then((r) => r.json()) as ProductsEnvelope
    const upper = await fetch(`${baseUrl}/api/products?q=OMEGA`).then((r) => r.json()) as ProductsEnvelope
    const mixed = await fetch(`${baseUrl}/api/products?q=OmEgA`).then((r) => r.json()) as ProductsEnvelope
    expect(lower.items.map((i) => i.slug)).toEqual(upper.items.map((i) => i.slug))
    expect(lower.items.map((i) => i.slug)).toEqual(mixed.items.map((i) => i.slug))
  })

  it('no results for a term nothing matches', async () => {
    const res = await fetch(`${baseUrl}/api/products?q=zzzznonexistentzzzz`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ProductsEnvelope
    expect(body.items).toEqual([])
    expect(body.totalItems).toBe(0)
    expect(body.totalPages).toBe(0)
  })

  // 🔴 Runtime §3a stop-condition proof — Checkpoint C only had compile-time
  // evidence; these prove the escaped contains/mode:'insensitive' form
  // genuinely behaves as literal-substring against real PostgreSQL, not
  // wildcard-as-LIKE-meaning. If escaping ever silently stopped working, a
  // bare % would revert to match-all and return every active product.
  //
  // ⚠️ The original comment here asserted "none of the seed's text fields
  // contain a literal %, _, or backslash". That stopped being true in batch 2:
  // `altman-ashwagandha-balance-60` describes "5% וויטאנולידים" straight from
  // the manufacturer's page. The % case below is written against the real
  // count rather than against that assumption — see its own note.
  describe('literal-substring semantics — runtime proof against real PostgreSQL', () => {
    /**
     * 🔴 REWRITTEN 2026-08-11 (batch 2). This asserted `totalItems === 0`,
     * which only ever held because no seeded product contained a `%`. Batch 2
     * added one that does, and the endpoint correctly returned exactly it.
     * Database checked first — `strpos` (no wildcard semantics of its own)
     * confirms exactly one product carries a literal `%`.
     *
     * 🔴 The rewrite is a STRONGER proof than the original, not a weakened
     * one. Zero results only showed "nothing matched", which is also what a
     * broken query returning nothing would show. Matching exactly the rows
     * that contain a literal `%` — while 17 active products exist —
     * distinguishes the two live failure modes directly:
     *
     *   escaping works    -> 1  (the literal match)
     *   % acts as wildcard -> 17 (match-all)
     *
     * The `expect(...).toBeLessThan(total)` guard is what actually kills the
     * wildcard regression, and it holds at any catalogue size.
     */
    it('q="%" does not become match-all — matches only literal "%", not every product', async () => {
      const rows = await testPrisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*) FROM products
        WHERE is_active = true
          AND (strpos(name_he, '%') > 0 OR strpos(name_en, '%') > 0
            OR strpos(description_he, '%') > 0 OR strpos(description_en, '%') > 0)
      `
      // Not destructured: `noUncheckedIndexedAccess` types rows[0] as possibly
      // undefined, and defaulting it to 0 would turn a broken query into a
      // silently passing assertion. count(*) always yields exactly one row.
      const first = rows[0]
      if (first === undefined) throw new Error('count(*) returned no row')
      const literalMatches = Number(first.count)
      const totalActive = await testPrisma.product.count({ where: { isActive: true } })
      expect(literalMatches).toBeLessThan(totalActive) // else the assertion below proves nothing

      const res = await fetch(`${baseUrl}/api/products?q=${encodeURIComponent('%')}`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as ProductsEnvelope
      expect(body.totalItems).toBe(literalMatches)
      expect(body.totalItems).toBeLessThan(totalActive)
    })

    it('q="_" does not become a single-character wildcard — zero results', async () => {
      const res = await fetch(`${baseUrl}/api/products?q=${encodeURIComponent('_')}`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as ProductsEnvelope
      expect(body.totalItems).toBe(0)
    })

    it('q="\\\\" (a literal backslash) does not error and matches nothing', async () => {
      const res = await fetch(`${baseUrl}/api/products?q=${encodeURIComponent('\\')}`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as ProductsEnvelope
      expect(body.totalItems).toBe(0)
    })
  })

  describe('composition with Checkpoint D filters — q ANDs with every other group', () => {
    it('q AND category narrows to the intersection, not the union', async () => {
      // "ויטמין" alone matches 4 products across 2 categories (Vitamins +
      // Minerals, verified above); narrowing to category=vitamins must drop
      // the Minerals-category match (solgar-cal-mag-d3).
      const category = CANONICAL_CATEGORIES.find((c) => c.nameHe === 'ויטמינים')
      if (!category) throw new Error('fixture assumption failed: "ויטמינים" is not canonical')
      const unfiltered = await fetch(`${baseUrl}/api/products?q=${encodeURIComponent('ויטמין')}`).then(
        (r) => r.json(),
      ) as ProductsEnvelope
      const filtered = await fetch(
        `${baseUrl}/api/products?q=${encodeURIComponent('ויטמין')}&category=${category.slug}`,
      ).then((r) => r.json()) as ProductsEnvelope
      expect(filtered.totalItems).toBeLessThan(unfiltered.totalItems)
      expect(filtered.items.every((i) => i.categorySlug === category.slug)).toBe(true)
    })

    it('q AND brand narrows to the intersection', async () => {
      // 🔴 Was hardcoded to סולגאר, whose products all left the catalogue when
      // ISSUE-045's unsourceable-price rows were demoted. Pick any brand that
      // actually has active products, so this cannot go stale that way again.
      const brand = await testPrisma.brand.findFirst({
        where: { products: { some: { isActive: true } } },
        orderBy: { name: 'asc' },
      })
      if (!brand) throw new Error('fixture assumption failed: no brand has an active product')
      const res = await fetch(`${baseUrl}/api/products?q=${encodeURIComponent('ויטמין')}&brand=${brand.id}`)
      const body = (await res.json()) as ProductsEnvelope
      const expected = await testPrisma.product.findMany({
        where: {
          isActive: true,
          brandId: brand.id,
          OR: [
            { nameHe: { contains: 'ויטמין', mode: 'insensitive' } },
            { nameEn: { contains: 'ויטמין', mode: 'insensitive' } },
            { descriptionHe: { contains: 'ויטמין', mode: 'insensitive' } },
            { descriptionEn: { contains: 'ויטמין', mode: 'insensitive' } },
          ],
        },
        select: { slug: true },
      })
      expect(new Set(body.items.map((i) => i.slug))).toEqual(new Set(expected.map((p) => p.slug)))
    })

    it('q combined with inStock=true still returns a valid, non-crashing result', async () => {
      const res = await fetch(`${baseUrl}/api/products?q=${encodeURIComponent('ויטמין')}&inStock=true`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as ProductsEnvelope
      expect(body.totalItems).toBeGreaterThan(0)
    })

    it('q combined with minPrice/maxPrice still returns a valid, non-crashing result', async () => {
      const res = await fetch(`${baseUrl}/api/products?q=${encodeURIComponent('ויטמין')}&minPrice=0&maxPrice=99999.99`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as ProductsEnvelope
      expect(body.totalItems).toBeGreaterThan(0)
    })
  })

  /**
   * 🟢 UPGRADED 2026-08-11 from a structural check to a LIVE one.
   *
   * This used to assert `totalCount === activeCount` — i.e. it verified the
   * claim by observing that **no inactive product existed to test with**. That
   * is the weakest possible form of the check: it passes precisely because the
   * interesting case is absent.
   *
   * ISSUE-045's repair created real inactive products for the first time (five
   * rows demoted for unsourceable prices, soft-deleted per INV-03). The claim
   * can now be probed for real: an inactive product must not appear in search
   * results, in the unfiltered catalogue, or in any facet.
   */
  it('inactive products are unreachable via search — probed LIVE against a real soft-deleted product', async () => {
    // 🔴 THIS TEST NOW CREATES ITS OWN FIXTURE, and the reason is worth
    // keeping. It used to probe whatever product happened to be soft-deleted.
    // On 2026-08-12 the seed gained REACTIVATION, every verified row became
    // active, and the test failed with "no inactive product to probe" — a
    // correct, loud failure, but the coverage would have been LOST had the
    // easy fix been taken (skip when none exists). The soft-delete guarantee
    // is INV-03's, so it must be provable whether or not the seed happens to
    // leave a casualty behind.
    const victim = await testPrisma.product.findFirst({
      where: { isActive: true },
      select: { id: true, slug: true, nameHe: true },
    })
    if (!victim) throw new Error('fixture assumption failed: no active product to soft-delete')

    await testPrisma.product.update({ where: { id: victim.id }, data: { isActive: false } })
    try {
      // Searching its own name must not surface it.
      const res = await fetch(`${baseUrl}/api/products?q=${encodeURIComponent(victim.nameHe)}`)
      const body = (await res.json()) as ProductsEnvelope
      expect(body.items.map((i) => i.slug)).not.toContain(victim.slug)

      // Nor may it appear anywhere in the unfiltered catalogue.
      const { slugs } = await fetchAllPages()
      expect(slugs).not.toContain(victim.slug)
    } finally {
      // 🔴 Restored even when an assertion throws — otherwise a red test
      // leaves the dev catalogue one product short and the NEXT run fails
      // somewhere unrelated.
      await testPrisma.product.update({ where: { id: victim.id }, data: { isActive: true } })
    }
  })
})

describe('GET /api/products — sorting (Checkpoint D)', () => {
  it('price_asc — matches a direct read-only query with the same tie-break', async () => {
    const expected = await testPrisma.product.findMany({
      where: { isActive: true },
      orderBy: [{ price: 'asc' }, { createdAt: 'desc' }, { slug: 'asc' }],
      select: { slug: true },
    })
    const { slugs } = await fetchAllPages('sort=price_asc')
    expect(slugs).toEqual(expected.map((p) => p.slug))
  })

  it('price_desc — matches a direct read-only query with the same tie-break', async () => {
    const expected = await testPrisma.product.findMany({
      where: { isActive: true },
      orderBy: [{ price: 'desc' }, { createdAt: 'desc' }, { slug: 'asc' }],
      select: { slug: true },
    })
    const { slugs } = await fetchAllPages('sort=price_desc')
    expect(slugs).toEqual(expected.map((p) => p.slug))
  })

  it('newest — matches a direct read-only query with the same tie-break', async () => {
    const expected = await testPrisma.product.findMany({
      where: { isActive: true },
      orderBy: [{ createdAt: 'desc' }, { slug: 'asc' }],
      select: { slug: true },
    })
    const { slugs } = await fetchAllPages('sort=newest')
    expect(slugs).toEqual(expected.map((p) => p.slug))
  })

  /**
   * 🔴 REWRITTEN 2026-08-11 (MILESTONE-004 Part 2, batch 4) — and the
   * ASSERTION was wrong, not merely stale.
   *
   * It compared `asc` against `desc.reverse()` and demanded exact equality.
   * That held only while every price was unique. Batch 4 produced the first
   * genuine tie: `altman-licorice-60` and `altman-iron-comfort-30` are both
   * ₪141.10 — two real products whose real prices coincide, each confirmed on
   * its own manufacturer page.
   *
   * 🔴 With a tie present, a STRICT REVERSAL IS THE WRONG EXPECTATION — it
   * directly contradicts this test's own name. Both sorts apply the same
   * trailing tie-break (`createdAt desc, slug asc`), so tied products keep the
   * SAME relative order in both directions. A strict reversal would require
   * them to swap, which is exactly the "ties silently reordered" this test
   * exists to forbid. The endpoint is right; the assertion had a hidden
   * precondition ("all prices distinct") that nobody stated and the data has
   * now falsified.
   *
   * What is asserted instead is the property actually wanted:
   *   · the sequence of PRICE GROUPS is reversed, and
   *   · WITHIN a tied group the order is IDENTICAL in both directions.
   * Both are checked, and both would break if the tie-break were dropped or
   * made direction-dependent.
   */
  it('price_asc and price_desc reverse the price GROUPS while the tie-break holds order WITHIN a group', async () => {
    const asc = await fetchAllPages('sort=price_asc')
    const desc = await fetchAllPages('sort=price_desc')
    expect(asc.first.totalPages).toBeGreaterThan(1) // fixture assumption: multi-page
    expect(asc.slugs.length).toBe(desc.slugs.length)

    const priceBySlug = new Map(
      (await testPrisma.product.findMany({ where: { isActive: true }, select: { slug: true, price: true } }))
        .map((p) => [p.slug, p.price.toString()] as const),
    )
    const groups = (slugs: string[]): Array<{ price: string; slugs: string[] }> => {
      const out: Array<{ price: string; slugs: string[] }> = []
      for (const slug of slugs) {
        const price = priceBySlug.get(slug)
        if (price === undefined) throw new Error(`returned slug not in the database: ${slug}`)
        const last = out[out.length - 1]
        if (last !== undefined && last.price === price) last.slugs.push(slug)
        else out.push({ price, slugs: [slug] })
      }
      return out
    }
    const ascGroups = groups(asc.slugs)
    const descGroups = groups(desc.slugs)

    // The tie this test now depends on — assert it exists, or the interesting
    // half below is vacuous and nobody would notice.
    expect(ascGroups.some((g) => g.slugs.length > 1)).toBe(true)

    expect(ascGroups.map((g) => g.price)).toEqual([...descGroups.map((g) => g.price)].reverse())
    const descByPrice = new Map(descGroups.map((g) => [g.price, g.slugs] as const))
    for (const g of ascGroups) expect(g.slugs).toEqual(descByPrice.get(g.price))
  })
})

// Checkpoint F — real popularity execution (§6a).
// 🔴 REWRITTEN 2026-08-14, ISSUE-106. This block used to assert that
// popularity output EQUALS newest output — "the documented all-tie
// behaviour", true only while the entire database held zero orders. The
// user's first real purchase turned it red with nothing wrong: a test in a
// read-only file must not assert a global ordering of a shared database,
// because any order anyone ever places changes that ordering.
// What this file still owns and asserts: the parameter is accepted, it
// composes with filters/search/pagination, and sorting never changes
// MEMBERSHIP. The ordering semantics themselves (units sold in 30 days,
// cancelled excluded, tie-break) are proven end-to-end against fixture
// orders in catalogPopularity.integration.test.ts, and at the unit layer in
// catalogPopularity.test.ts.
describe('GET /api/products — sort=popularity execution (Checkpoint F)', () => {
  it('is accepted (never 400) and returns 200 with results', async () => {
    const res = await fetch(`${baseUrl}/api/products?sort=popularity`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ProductsEnvelope
    expect(body.items.length).toBeGreaterThan(0)
  })

  it('sorting by popularity changes ORDER at most, never membership — same slugs as newest', async () => {
    const popularity = await fetchAllPages('sort=popularity')
    const newest = await fetchAllPages('sort=newest')
    expect([...popularity.slugs].sort()).toEqual([...newest.slugs].sort())
  })

  it('composes with filters — popularity + category', async () => {
    const category = CANONICAL_CATEGORIES.find((c) => c.nameHe === 'מינרלים')
    if (!category) throw new Error('fixture assumption failed: "מינרלים" is not canonical')
    const res = await fetch(`${baseUrl}/api/products?sort=popularity&category=${category.slug}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ProductsEnvelope
    expect(body.items.every((i) => i.categorySlug === category.slug)).toBe(true)
    expect(body.items.length).toBeGreaterThan(0)
  })

  /**
   * 🔴 REWRITTEN 2026-08-11 (batch 3) — hardcoded a single omega slug and went
   * to two when a second omega product was seeded. Database checked first.
   *
   * Composition means the q filter still applies under a non-default sort, so
   * the expectation is the UNSORTED q result: changing `sort` must change the
   * ORDER, never the MEMBERSHIP. That is a sharper statement than any fixed
   * roster, and it cannot go stale as the catalogue grows.
   */
  it('composes with q search — sort changes order, not membership', async () => {
    const unsorted = await fetch(`${baseUrl}/api/products?q=omega`)
    const unsortedBody = (await unsorted.json()) as ProductsEnvelope
    expect(unsortedBody.items.length).toBeGreaterThan(0) // fixture assumption

    const res = await fetch(`${baseUrl}/api/products?sort=popularity&q=omega`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ProductsEnvelope
    expect(body.totalItems).toBe(unsortedBody.totalItems)
    expect(new Set(body.items.map((i) => i.slug))).toEqual(new Set(unsortedBody.items.map((i) => i.slug)))
  })

  it('pagination — a past-the-end popularity-sorted page is a truthful empty page, not a crash', async () => {
    const totalItems = await testPrisma.product.count({ where: { isActive: true } })
    if (totalItems === 0) throw new Error('fixture assumption failed: no active products at all')
    const res = await fetch(`${baseUrl}/api/products?sort=popularity&page=999`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ProductsEnvelope
    expect(body.items).toEqual([])
    expect(body.totalItems).toBe(totalItems)
    expect(body.page).toBeGreaterThan(body.totalPages)
  })

  it('a zero-result popularity query still returns totalPages 0, not an error', async () => {
    const res = await fetch(`${baseUrl}/api/products?sort=popularity&minPrice=99999&maxPrice=99999.99`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ProductsEnvelope
    expect(body.items).toEqual([])
    expect(body.totalItems).toBe(0)
    expect(body.totalPages).toBe(0)
  })
})

// Checkpoint F — fallback (§6b, REQ-F-014).
describe('GET /api/products — fallback (Checkpoint F)', () => {
  it('is null when the primary query has results', async () => {
    const res = await fetch(`${baseUrl}/api/products`)
    const body = (await res.json()) as ProductsEnvelope & { fallback: unknown }
    expect(body.fallback).toBeNull()
  })

  it('is null on a past-the-end page (totalItems > 0), even though items is empty — canonicalization, not fallback', async () => {
    const totalItems = await testPrisma.product.count({ where: { isActive: true } })
    if (totalItems === 0) throw new Error('fixture assumption failed: no active products at all')
    const res = await fetch(`${baseUrl}/api/products?page=999`)
    const body = (await res.json()) as ProductsEnvelope & { fallback: unknown }
    expect(body.items).toEqual([])
    expect(body.fallback).toBeNull()
  })

  it('kind="category" — a zero-result query with a valid category suggests other products from that same category, every other filter relaxed', async () => {
    // 🔴 The CATEGORY is derived too, not just the dosage form. Hardcoding
    // "מינרלים" broke twice as the catalogue grew — once when a drops product
    // joined it, and again when a tablets product did. Any category with at
    // least one product and at least one UNUSED dosage form satisfies this
    // scenario, so the test finds one instead of asserting which it is.
    const activeByCategory = await testPrisma.product.findMany({
      where: { isActive: true },
      select: { dosageForm: true, category: { select: { nameHe: true } } },
    })
    const category = CANONICAL_CATEGORIES.find((c) => {
      const inCat = activeByCategory.filter((p) => p.category.nameHe === c.nameHe)
      if (inCat.length === 0) return false
      const forms = new Set(inCat.map((p) => p.dosageForm))
      return forms.size < 5
    })
    if (!category) {
      throw new Error(
        'fixture assumption failed: no canonical category has both products and an unused DosageForm, ' +
          'so a zero-result query with a VALID category cannot be built at all.',
      )
    }
    const expectedCategoryProducts = activeByCategory.filter(
      (p) => p.category.nameHe === category.nameHe,
    ).length

    // 🔴 The empty dosage form is DERIVED, not hardcoded. This assertion used
    // to say "dosageForm=DROPS matches no product in Minerals today", which
    // stopped being true the moment `ecosupp-iron-drops-c` (מינרלים · טיפות)
    // was seeded — and the failure mode was the DANGEROUS direction of
    // ISSUE-041: had the new row been a category with no fallback to check,
    // the test would have gone quietly vacuous instead of red.
    //
    // So the premise is now computed AND asserted: pick a dosage form with
    // zero active products in this category, and fail loudly if the catalogue
    // ever covers all five, because at that point this scenario cannot be
    // constructed and silently passing would prove nothing.
    const formsInCategory = new Set(
      (
        await testPrisma.product.findMany({
          where: { isActive: true, category: { nameHe: category.nameHe } },
          select: { dosageForm: true },
        })
      ).map((p) => p.dosageForm),
    )
    const emptyDosageForm = (['DROPS', 'POWDER', 'SYRUP', 'TABLET', 'CAPSULE'] as const).find(
      (form) => !formsInCategory.has(form),
    )
    if (!emptyDosageForm) {
      throw new Error(
        `fixture assumption failed: every DosageForm now has an active product in "${category.nameHe}", ` +
          'so a zero-result query with a valid category cannot be built from it. Pick another category.',
      )
    }

    const res = await fetch(`${baseUrl}/api/products?category=${category.slug}&dosageForm=${emptyDosageForm}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ProductsEnvelope & { fallback: { kind: string; items: unknown[]; limit: number } | null }
    expect(body.totalItems).toBe(0)
    expect(body.fallback).not.toBeNull()
    expect(body.fallback!.kind).toBe('category')
    expect(body.fallback!.limit).toBe(8)
    // Capped by the fallback's own limit of 8, exactly as the sibling
    // kind="popular" test does. The uncapped form only ever passed because the
    // hardcoded category happened to hold fewer than 8 products.
    expect(body.fallback!.items).toHaveLength(Math.min(expectedCategoryProducts, 8))
  })

  it('kind="popular" — a zero-result query with no category suggests popular products across the whole active catalogue', async () => {
    const activeProducts = await testPrisma.product.findMany({ where: { isActive: true } })
    const res = await fetch(`${baseUrl}/api/products?minPrice=99999&maxPrice=99999.99`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ProductsEnvelope & { fallback: { kind: string; items: PublicCatalogProduct[]; limit: number } | null }
    expect(body.totalItems).toBe(0)
    expect(body.fallback).not.toBeNull()
    expect(body.fallback!.kind).toBe('popular')
    expect(body.fallback!.limit).toBe(8)
    expect(body.fallback!.items).toHaveLength(Math.min(activeProducts.length, 8))

    // §6b 🔴 "Both kinds use the same deterministic popularity ordering
    // (§6a)" — asserted directly, not just implemented: the fallback's
    // order must equal the TOP of the live `sort=popularity` output.
    // 🔴 REWRITTEN 2026-08-14, ISSUE-106. This used to recompute the
    // expected order as sortByPopularity(products, new Map()) — an EMPTY
    // score map, correct only while the whole database held zero orders;
    // the user's first purchase broke it. Comparing the two API surfaces
    // pins exactly what §6b claims (same ordering) without this read-only
    // file asserting what that ordering is — the scoring semantics are
    // proven against fixture orders in catalogPopularity.integration.test.ts.
    const popular = await fetch(`${baseUrl}/api/products?sort=popularity`)
    const popularBody = (await popular.json()) as ProductsEnvelope
    const expectedOrder = popularBody.items.slice(0, 8).map((p) => p.slug)
    expect(body.fallback!.items.map((i) => i.slug)).toEqual(expectedOrder)
  })

  it('an invalid category never receives fallback recommendations — rejected before fallback logic runs', async () => {
    const res = await fetch(`${baseUrl}/api/products?category=not-a-real-category`)
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).not.toHaveProperty('fallback')
  })

  it('fallback never carries pagination fields', async () => {
    const res = await fetch(`${baseUrl}/api/products?minPrice=99999&maxPrice=99999.99`)
    const body = (await res.json()) as { fallback: Record<string, unknown> | null }
    expect(body.fallback).not.toHaveProperty('page')
    expect(body.fallback).not.toHaveProperty('totalItems')
    expect(body.fallback).not.toHaveProperty('totalPages')
  })

  it('fallback items never include inactive products — isActive is never relaxed', async () => {
    const res = await fetch(`${baseUrl}/api/products?minPrice=99999&maxPrice=99999.99`)
    const body = (await res.json()) as { fallback: { items: PublicCatalogProduct[] } | null }
    // structural proof: every fallback item slug corresponds to a real
    // active product (a direct DB check per slug)
    for (const item of body.fallback?.items ?? []) {
      const product = await testPrisma.product.findUnique({ where: { slug: item.slug } })
      expect(product?.isActive).toBe(true)
    }
  })
})

describe('GET /api/products — stable-ID existence + active-usage validation (Checkpoint D)', () => {
  // 🔴 Corrected 2026-08-10 (Codex review): "allowed" (§4b) means usage-
  // derived from ACTIVE products only — the same definition §9d's facets
  // endpoint uses (catalogFacets.ts). The current vitashop_dev seed has
  // ZERO inactive products (verified in the pagination/filtering suites
  // above), so "an id that exists but is used only by inactive products"
  // cannot be constructed against live data here. That specific case —
  // plus the exact active-usage `where` shape sent to Prisma — is proven at
  // the unit layer: catalogIdExistence.test.ts (a minimal fake-Prisma
  // stub, the only such stub in this codebase, used because no live
  // fixture can express this case today).
  const nonexistentUuid = '00000000-0000-4000-8000-000000000000'

  it('a well-formed but nonexistent brand id is rejected, naming "brand"', async () => {
    const res = await fetch(`${baseUrl}/api/products?brand=${nonexistentUuid}`)
    expect(res.status).toBe(400)
    const body = (await res.json()) as ApiErrorEnvelope
    expect(body.error.code).toBe('INVALID_QUERY_PARAMETER')
    expect(body.error.fields).toEqual(['brand'])
  })

  it('a well-formed but nonexistent ingredient id is rejected, naming "ingredient"', async () => {
    const res = await fetch(`${baseUrl}/api/products?ingredient=${nonexistentUuid}`)
    expect(res.status).toBe(400)
    const body = (await res.json()) as ApiErrorEnvelope
    expect(body.error.code).toBe('INVALID_QUERY_PARAMETER')
    expect(body.error.fields).toEqual(['ingredient'])
  })

  it('a well-formed but nonexistent healthGoal id is rejected, naming "healthGoal"', async () => {
    const res = await fetch(`${baseUrl}/api/products?healthGoal=${nonexistentUuid}`)
    expect(res.status).toBe(400)
    const body = (await res.json()) as ApiErrorEnvelope
    expect(body.error.code).toBe('INVALID_QUERY_PARAMETER')
    expect(body.error.fields).toEqual(['healthGoal'])
  })

  it('a nonexistent id alongside a real, active-used one for the same field still rejects the whole field', async () => {
    const brand = await testPrisma.brand.findFirst({ where: { products: { some: { isActive: true } } } })
    if (!brand) throw new Error('fixture assumption failed: no brand has an active product')
    const res = await fetch(`${baseUrl}/api/products?brand=${brand.id}&brand=${nonexistentUuid}`)
    expect(res.status).toBe(400)
    const body = (await res.json()) as ApiErrorEnvelope
    expect(body.error.fields).toEqual(['brand'])
  })

  it('two nonexistent fields at once are both named, in canonical order', async () => {
    const res = await fetch(`${baseUrl}/api/products?brand=${nonexistentUuid}&ingredient=${nonexistentUuid}`)
    expect(res.status).toBe(400)
    const body = (await res.json()) as ApiErrorEnvelope
    expect(body.error.fields).toEqual(['brand', 'ingredient'])
  })

  it('a real, existing id is accepted (regression: existence validation does not reject valid ids)', async () => {
    const brand = await testPrisma.brand.findFirst({ where: { products: { some: { isActive: true } } } })
    if (!brand) throw new Error('fixture assumption failed: no brand has an active product')
    const res = await fetch(`${baseUrl}/api/products?brand=${brand.id}`)
    expect(res.status).toBe(200)
  })
})

describe('GET /api/products — pagination (Checkpoint D)', () => {
  /**
   * 🔴 REWRITTEN 2026-08-11 (MILESTONE-004 Part 2, batch 4). These two encoded
   * a SINGLE-PAGE catalogue as a fixture assumption — one threw outright above
   * 24 products, the other used `page=2` as its example of a PAST-THE-END
   * page. MILESTONE-004 existed to make that false: 27 active products,
   * pageSize server-fixed at 24, so page 2 is now a real page with 3 items.
   *
   * 🔴 The old `page=2` test is the one worth noticing. It did not just go
   * stale — it had been asserting `totalPages === 1` and an EMPTY page 2,
   * which is now the exact opposite of correct behaviour. Left "fixed" by
   * bumping the number it would have kept passing while testing nothing about
   * a real second page.
   *
   * They are replaced by a genuine multi-page pair: page 2 holds the
   * remainder and does not overlap page 1, and past-the-end is derived from
   * `totalPages` rather than hardcoded.
   */
  it('a multi-page catalogue: page 2 holds the remainder and does not overlap page 1', async () => {
    const totalItems = await testPrisma.product.count({ where: { isActive: true } })
    expect(totalItems).toBeGreaterThan(24) // the point of MILESTONE-004 — pagination has something to paginate

    const page1 = (await fetch(`${baseUrl}/api/products?page=1`).then((r) => r.json())) as ProductsEnvelope
    const page2 = (await fetch(`${baseUrl}/api/products?page=2`).then((r) => r.json())) as ProductsEnvelope

    expect(page1.totalItems).toBe(totalItems)
    expect(page1.totalPages).toBe(Math.ceil(totalItems / 24))
    expect(page1.items).toHaveLength(24)

    expect(page2.page).toBe(2)
    expect(page2.totalItems).toBe(totalItems)
    expect(page2.items).toHaveLength(Math.min(totalItems - 24, 24))
    expect(page2.items.length).toBeGreaterThan(0)

    // No overlap and no gap — the two pages partition the catalogue.
    const s1 = new Set(page1.items.map((i) => i.slug))
    const s2 = new Set(page2.items.map((i) => i.slug))
    for (const slug of s2) expect(s1.has(slug)).toBe(false)
    expect(s1.size + s2.size).toBe(Math.min(totalItems, 48))
  })

  it('a past-the-end page returns a truthful empty page — items: [], page > totalPages, totalItems > 0 — not canonicalized server-side', async () => {
    const totalItems = await testPrisma.product.count({ where: { isActive: true } })
    if (totalItems === 0) throw new Error('fixture assumption failed: no active products at all')
    // Derived from totalPages, never hardcoded — that is what made the
    // previous version silently wrong the moment the catalogue grew.
    const totalPages = Math.ceil(totalItems / 24)
    const pastTheEnd = totalPages + 1
    const res = await fetch(`${baseUrl}/api/products?page=${pastTheEnd}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ProductsEnvelope
    expect(body.items).toEqual([])
    expect(body.page).toBe(pastTheEnd)
    expect(body.totalItems).toBe(totalItems)
    expect(body.totalPages).toBe(totalPages)
    expect(body.page).toBeGreaterThan(body.totalPages)
  })

  // 🔴 Corrected 2026-08-10 (Codex review): behavioral proof, not just
  // arithmetic — a past-the-end or zero-result query must never reach
  // Prisma's findMany at all (no skip, safe or otherwise, is ever computed
  // or sent for it). Spies on the real app's Prisma singleton.
  it('a past-the-end page never calls findMany', async () => {
    const totalItems = await testPrisma.product.count({ where: { isActive: true } })
    if (totalItems === 0) throw new Error('fixture assumption failed: no active products at all')
    const findManySpy = vi.spyOn(appPrisma.product, 'findMany')
    const res = await fetch(`${baseUrl}/api/products?page=999999`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ProductsEnvelope
    expect(body.items).toEqual([])
    expect(findManySpy).not.toHaveBeenCalled()
  })

  it('a zero-result filtered query never calls findMany for the PRIMARY page (Checkpoint F: it now calls findMany once for the §6b fallback candidates instead)', async () => {
    const findManySpy = vi.spyOn(appPrisma.product, 'findMany')
    const res = await fetch(`${baseUrl}/api/products?minPrice=99999&maxPrice=99999.99`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ProductsEnvelope
    expect(body.totalItems).toBe(0)
    // Exactly one call — the §6b fallback candidate fetch
    // (catalogFallback.ts), whose where clause is isActive-only (no
    // category in this request, no price/other filters relaxed-in). The
    // primary page's own findMany (with the original narrowing where/
    // orderBy/skip/take) is still never called, since
    // pagination.withinRange is false for a zero-result query.
    expect(findManySpy).toHaveBeenCalledTimes(1)
    expect(findManySpy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    )
  })

  it('a within-range page still queries normally — the safe-execution guard does not break the happy path', async () => {
    const totalItems = await testPrisma.product.count({ where: { isActive: true } })
    if (totalItems === 0) throw new Error('fixture assumption failed: no active products at all')
    const findManySpy = vi.spyOn(appPrisma.product, 'findMany')
    const res = await fetch(`${baseUrl}/api/products?page=1`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ProductsEnvelope
    // A full page holds pageSize items once the catalogue outgrows one page
    // (batch 4: 27 active). What this test is about is the guard not blocking
    // a valid page, so it asserts the page is FULL and the skip/take are right.
    expect(body.items).toHaveLength(Math.min(totalItems, 24))
    expect(findManySpy).toHaveBeenCalledTimes(1)
    expect(findManySpy).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 24 }))
  })

  it('the safe-execution guard does not block page 2 either — skip is computed, not zeroed', async () => {
    const totalItems = await testPrisma.product.count({ where: { isActive: true } })
    expect(totalItems).toBeGreaterThan(24) // fixture assumption: a real page 2 exists
    const findManySpy = vi.spyOn(appPrisma.product, 'findMany')
    const res = await fetch(`${baseUrl}/api/products?page=2`)
    expect(res.status).toBe(200)
    expect(findManySpy).toHaveBeenCalledTimes(1)
    expect(findManySpy).toHaveBeenCalledWith(expect.objectContaining({ skip: 24, take: 24 }))
  })
})

describe('GET /api/catalog/facets', () => {
  it('returns 200 with the frozen §9d shape', async () => {
    const res = await fetch(`${baseUrl}/api/catalog/facets`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as FacetsEnvelope
    expect(Array.isArray(body.brands)).toBe(true)
    expect(Array.isArray(body.ingredients)).toBe(true)
    expect(Array.isArray(body.healthGoals)).toBe(true)
    expect(Array.isArray(body.dosageForms)).toBe(true)
  })

  it('does not fold categories into the facets contract', async () => {
    const res = await fetch(`${baseUrl}/api/catalog/facets`)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).not.toHaveProperty('categories')
  })

  it('never includes a count field anywhere in the payload', async () => {
    const res = await fetch(`${baseUrl}/api/catalog/facets`)
    const text = await res.text()
    expect(text).not.toMatch(/"count"/)
  })

  it('brands — exactly the brands used by active products, with real ids and BOTH label forms', async () => {
    const expected = await testPrisma.brand.findMany({
      where: { products: { some: { isActive: true } } },
      select: { id: true, name: true, nameEn: true },
    })
    const res = await fetch(`${baseUrl}/api/catalog/facets`)
    const body = (await res.json()) as FacetsEnvelope
    expect(new Set(body.brands.map((b) => b.id))).toEqual(new Set(expected.map((b) => b.id)))
    for (const brand of expected) {
      // Sixth list item 1: the Latin form rides the facet so the English
      // UI's filter rail never lists a Hebrew brand name.
      expect(body.brands).toContainEqual({ id: brand.id, label: brand.name, labelEn: brand.nameEn ?? null })
    }
    // 🔴 Non-vacuity: DEC-080 converged nameEn for every seeded brand, so at
    // least one facet entry must actually carry a Latin form.
    expect(body.brands.some((b) => b.labelEn !== null)).toBe(true)
  })

  it('ingredients — exactly the active ingredients used by active products', async () => {
    const expected = await testPrisma.activeIngredient.findMany({
      where: { products: { some: { product: { isActive: true } } } },
      select: { id: true },
    })
    const res = await fetch(`${baseUrl}/api/catalog/facets`)
    const body = (await res.json()) as FacetsEnvelope
    expect(new Set(body.ingredients.map((i) => i.id))).toEqual(new Set(expected.map((i) => i.id)))
  })

  it('healthGoals — exactly the health goals used by active products, bilingual labels', async () => {
    const expected = await testPrisma.healthGoal.findMany({
      where: { products: { some: { product: { isActive: true } } } },
      select: { id: true, nameHe: true, nameEn: true },
    })
    const res = await fetch(`${baseUrl}/api/catalog/facets`)
    const body = (await res.json()) as FacetsEnvelope
    expect(new Set(body.healthGoals.map((h) => h.id))).toEqual(new Set(expected.map((h) => h.id)))
    for (const goal of expected) {
      expect(body.healthGoals).toContainEqual({ id: goal.id, labelHe: goal.nameHe, labelEn: goal.nameEn })
    }
  })

  it('dosageForms — exactly the enum values used by active products, bilingual labels', async () => {
    const expected = await testPrisma.product.findMany({
      where: { isActive: true },
      select: { dosageForm: true },
      distinct: ['dosageForm'],
    })
    const res = await fetch(`${baseUrl}/api/catalog/facets`)
    const body = (await res.json()) as FacetsEnvelope
    expect(new Set(body.dosageForms.map((d) => d.value))).toEqual(new Set(expected.map((p) => p.dosageForm)))
    for (const form of body.dosageForms) {
      expect(form.labelHe.length).toBeGreaterThan(0)
      expect(form.labelEn.length).toBeGreaterThan(0)
    }
  })

  it('dietary — exactly the flags carried true by at least one active product (DEC-078/DEC-083)', async () => {
    const [kosher, glutenFree, vegan] = await Promise.all([
      testPrisma.product.count({ where: { isActive: true, isKosher: true } }),
      testPrisma.product.count({ where: { isActive: true, isGlutenFree: true } }),
      testPrisma.product.count({ where: { isActive: true, isVegan: true } }),
    ])
    const expected = new Set(
      [kosher > 0 ? 'kosher' : null, glutenFree > 0 ? 'glutenFree' : null, vegan > 0 ? 'vegan' : null].filter(
        (v): v is string => v !== null,
      ),
    )
    // 🔴 Non-vacuity: batch 1's sourcing means at least the kosher option
    // must exist — an empty expected set would make this test prove nothing.
    expect(expected.size).toBeGreaterThan(0)
    const res = await fetch(`${baseUrl}/api/catalog/facets`)
    const body = (await res.json()) as FacetsEnvelope
    expect(new Set(body.dietary.map((d) => d.value))).toEqual(expected)
    for (const option of body.dietary) {
      expect(option.labelHe.length).toBeGreaterThan(0)
      expect(option.labelEn.length).toBeGreaterThan(0)
    }
  })

  it('a brand with no active products does not leak into the facets — inactive-only usage is never surfaced', async () => {
    // No inactive product exists in the current seed (verified: all active
    // products' referenced brands ARE used-by-active by construction). This
    // test instead proves the invariant structurally: every returned brand id
    // is reachable from an active product via a direct DB check, so a brand
    // whose only products are inactive (none exists today, but the assertion
    // covers the case) could never appear.
    const res = await fetch(`${baseUrl}/api/catalog/facets`)
    const body = (await res.json()) as FacetsEnvelope
    for (const brand of body.brands) {
      const activeCount = await testPrisma.product.count({ where: { isActive: true, brandId: brand.id } })
      expect(activeCount).toBeGreaterThan(0)
    }
  })

  it('rejects a query parameter — the endpoint accepts none', async () => {
    const res = await fetch(`${baseUrl}/api/catalog/facets?foo=1`)
    expect(res.status).toBe(400)
    const body = (await res.json()) as ApiErrorEnvelope
    expect(body.error.code).toBe('UNSUPPORTED_QUERY_PARAMETER')
    expect(body.error.fields).toEqual(['foo'])
  })
})

/**
 * MILESTONE-005 Checkpoint J — `GET /api/products/:slug` (§7), including
 * **TEST-002**: the explicit 16-field contract assertion.
 *
 * 🔴 The field list below is enumerated BY HAND, exactly as §7a requires
 * ("enumerated explicitly in the test, not derived from the DTO type, so a
 * dropped field fails rather than silently shrinking the expectation"). Do
 * not replace it with `Object.keys(dto)` or a type-derived list — that would
 * make the test agree with whatever the code happens to return, which is the
 * opposite of a contract test.
 */
describe('GET /api/products/:slug — Product Details (Checkpoint J)', () => {
  async function firstActiveSlug(): Promise<string> {
    const product = await testPrisma.product.findFirst({
      where: { isActive: true },
      orderBy: { slug: 'asc' },
      select: { slug: true },
    })
    if (!product) throw new Error('fixture assumption failed: vitashop_dev has no active product')
    return product.slug
  }

  /**
   * 🔴 TEST-002's fixture must actually CARRY ingredients (§7a field 13).
   * With an ingredient-less product the field-13 `for...of` below never
   * executes and the only surviving assertion is "is an array" — a
   * regression dropping `amount` from the projection would pass. That is
   * exactly the silent shrink §7a's contract test exists to prevent, so the
   * fixture is selected by the property the test depends on, and the
   * non-empty precondition is asserted rather than assumed.
   */
  async function firstActiveSlugWithIngredients(): Promise<string> {
    const product = await testPrisma.product.findFirst({
      where: { isActive: true, ingredients: { some: {} } },
      orderBy: { slug: 'asc' },
      select: { slug: true },
    })
    if (!product) {
      throw new Error('fixture assumption failed: vitashop_dev has no active product with ingredients (field 13)')
    }
    return product.slug
  }

  it('TEST-002 — the detail DTO carries all 16 Table 1 fields', async () => {
    const slug = await firstActiveSlugWithIngredients()
    const res = await fetch(`${baseUrl}/api/products/${slug}`)
    expect(res.status).toBe(200)
    const dto = (await res.json()) as Record<string, unknown>

    // Field 01 — §7b, Product.id under a public read-only name. Asserted on
    // the same footing as the other fifteen: present and non-empty.
    expect(typeof dto.serialNumber).toBe('string')
    expect((dto.serialNumber as string).length).toBeGreaterThan(0)
    // Field 02
    expect(typeof dto.nameHe).toBe('string')
    expect(typeof dto.nameEn).toBe('string')
    // Field 03
    expect(typeof dto.categoryNameHe).toBe('string')
    expect(typeof dto.categoryNameEn).toBe('string')
    expect(typeof dto.categorySlug).toBe('string')
    // Field 04
    expect(typeof dto.brandName).toBe('string')
    // Field 05
    expect(typeof dto.dosageForm).toBe('string')
    // Field 06
    expect(typeof dto.packageQuantity).toBe('number')
    // Field 07
    expect(typeof dto.usageInstructions).toBe('string')
    // Field 08 — Decimal serialized as a fixed-2 string, never a float.
    expect(typeof dto.price).toBe('string')
    expect(dto.price as string).toMatch(/^\d+\.\d{2}$/)
    // Field 09
    expect(typeof dto.stockQuantity).toBe('number')
    // Field 10 — image basenames, never paths.
    expect(Array.isArray(dto.images)).toBe(true)
    for (const image of dto.images as string[]) {
      expect(typeof image).toBe('string')
      expect(image).not.toContain('/')
    }
    // Field 11
    expect(typeof dto.descriptionHe).toBe('string')
    expect(typeof dto.descriptionEn).toBe('string')
    // Field 12
    expect(typeof dto.warningsAllergens).toBe('string')
    // Field 13 — 🔴 non-empty is asserted BEFORE the loop, so the per-row
    // assertions below cannot go vacuous on an ingredient-less fixture.
    expect(Array.isArray(dto.ingredients)).toBe(true)
    expect((dto.ingredients as unknown[]).length).toBeGreaterThan(0)
    for (const ingredient of dto.ingredients as { name: string; amount: string; unit: string }[]) {
      expect(typeof ingredient.name).toBe('string')
      expect(ingredient.amount).toMatch(/^\d+\.\d{2}$/)
      expect(typeof ingredient.unit).toBe('string')
    }
    // Field 14 — zero or more, bilingual.
    expect(Array.isArray(dto.healthGoals)).toBe(true)
    for (const goal of dto.healthGoals as { nameHe: string; nameEn: string }[]) {
      expect(typeof goal.nameHe).toBe('string')
      expect(typeof goal.nameEn).toBe('string')
    }
    // Field 15 — nullable is a real value, not an omission.
    expect('targetAudience' in dto).toBe(true)
    expect(dto.targetAudience === null || typeof dto.targetAudience === 'string').toBe(true)
    // Field 16 — ISO 8601 string, never a Date instance across the wire.
    expect(typeof dto.createdAt).toBe('string')
    expect(Number.isNaN(Date.parse(dto.createdAt as string))).toBe(false)
  })

  it('matches the database row it claims to describe', async () => {
    const slug = await firstActiveSlug()
    const res = await fetch(`${baseUrl}/api/products/${slug}`)
    const dto = (await res.json()) as Record<string, unknown>

    const row = await testPrisma.product.findUniqueOrThrow({
      where: { slug },
      include: { brand: true, category: true, images: true },
    })
    expect(dto.serialNumber).toBe(row.id)
    expect(dto.slug).toBe(row.slug)
    expect(dto.nameHe).toBe(row.nameHe)
    expect(dto.brandName).toBe(row.brand.name)
    // DEC-080 — pinned END TO END, not only in the mapper unit test: a
    // narrowed brand select would silently null this for every product
    // while both suites stayed green.
    expect(dto.brandNameEn).toBe(row.brand.nameEn)
    expect(dto.price).toBe(row.price.toFixed(2))
    expect(dto.usageInstructions).toBe(row.usageInstructions)
    expect(dto.warningsAllergens).toBe(row.warningsAllergens)
    expect(dto.targetAudience).toBe(row.targetAudience)
    expect(dto.createdAt).toBe(row.createdAt.toISOString())
    expect((dto.images as string[]).length).toBe(row.images.length)
  })

  it('the detail images array starts with exactly the image the list DTO exposes', async () => {
    const slug = await firstActiveSlug()
    const [listRes, detailRes] = await Promise.all([
      fetch(`${baseUrl}/api/products`),
      fetch(`${baseUrl}/api/products/${slug}`),
    ])
    const list = (await listRes.json()) as ProductsEnvelope
    const detail = (await detailRes.json()) as Record<string, unknown>
    const listed = list.items.find((item) => item.slug === slug)

    // One ordering rule (sortOrder, id) shared by both mappers — the list's
    // single image can never disagree with the detail's first.
    expect(listed?.imageFile ?? null).toBe((detail.images as string[])[0] ?? null)
  })

  it('returns 404 PRODUCT_NOT_FOUND for a slug that does not exist', async () => {
    const res = await fetch(`${baseUrl}/api/products/definitely-not-a-real-slug-zzz`)
    expect(res.status).toBe(404)
    const body = (await res.json()) as ApiErrorEnvelope
    expect(body.error.code).toBe('PRODUCT_NOT_FOUND')
  })

  it('returns an IDENTICAL 404 for an inactive product — existence cannot be probed', async () => {
    const inactive = await testPrisma.product.findFirst({
      where: { isActive: false },
      select: { slug: true },
    })

    const absentRes = await fetch(`${baseUrl}/api/products/definitely-not-a-real-slug-zzz`)
    const absentBody = (await absentRes.json()) as ApiErrorEnvelope

    if (!inactive) {
      // The seed currently holds no inactive product, so this case cannot be
      // exercised against live data. Rather than skip (which would silently
      // drop the check), the precondition is asserted explicitly here, and
      // the guarantee itself is proven at the unit level in
      // **catalogProductLookup.test.ts** — which asserts the exact
      // `where: { slug, isActive: true }` sent to Prisma, mirroring
      // catalogIdExistence.test.ts's precedent from Checkpoint D.
      //
      // 🔴 An earlier version of this comment claimed that proof lived in
      // catalogMapper.test.ts "or this route's code". Neither was true: the
      // mapper only runs AFTER a product is found, so it structurally cannot
      // test the lookup, and reading the route is not a test. The proof now
      // named above genuinely exists.
      const inactiveCount = await testPrisma.product.count({ where: { isActive: false } })
      expect(inactiveCount).toBe(0)
      expect(absentRes.status).toBe(404)
      expect(absentBody.error.code).toBe('PRODUCT_NOT_FOUND')
      return
    }

    const inactiveRes = await fetch(`${baseUrl}/api/products/${inactive.slug}`)
    const inactiveBody = (await inactiveRes.json()) as ApiErrorEnvelope

    // Identical status, code and message — no distinguishing signal at all.
    expect(inactiveRes.status).toBe(absentRes.status)
    expect(inactiveBody.error.code).toBe(absentBody.error.code)
    expect(inactiveBody.error.message).toBe(absentBody.error.message)
  })

  it('rejects any query parameter (DEC-042 regression, same as the other read endpoints)', async () => {
    const slug = await firstActiveSlug()
    const res = await fetch(`${baseUrl}/api/products/${slug}?bogus=1`)
    expect(res.status).toBe(400)
    const body = (await res.json()) as ApiErrorEnvelope
    expect(body.error.code).toBe('UNSUPPORTED_QUERY_PARAMETER')
    expect(body.error.fields).toEqual(['bogus'])
  })

  it('does not accept serialNumber as a lookup key — Product.id is not a route identifier (§7b)', async () => {
    const slug = await firstActiveSlug()
    const detail = (await (await fetch(`${baseUrl}/api/products/${slug}`)).json()) as Record<string, unknown>

    const byId = await fetch(`${baseUrl}/api/products/${detail.serialNumber as string}`)
    expect(byId.status).toBe(404)
  })

  it('keeps serialNumber out of the catalogue LIST DTO (§7b)', async () => {
    const res = await fetch(`${baseUrl}/api/products`)
    const body = (await res.json()) as ProductsEnvelope
    for (const item of body.items) {
      expect('serialNumber' in item).toBe(false)
      expect('id' in item).toBe(false)
    }
  })
})
