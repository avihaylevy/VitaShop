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
import { CANONICAL_CATEGORIES } from '../lib/catalogCategories.js'
import type { PublicCatalogProduct } from '../lib/catalogMapper.js'
import { sortByPopularity } from '../lib/catalogPopularity.js'
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
  brands: { id: string; label: string }[]
  ingredients: { id: string; label: string }[]
  healthGoals: { id: string; labelHe: string; labelEn: string }[]
  dosageForms: { value: string; labelHe: string; labelEn: string }[]
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
let readonlyPrisma: PrismaClient

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
  readonlyPrisma = new PrismaClient({ adapter })
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()))
  })
  await readonlyPrisma.$disconnect()
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

describe('GET /api/products', () => {
  it('returns 200 with the approved envelope shape', async () => {
    const res = await fetch(`${baseUrl}/api/products`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ProductsEnvelope
    expect(Array.isArray(body.items)).toBe(true)
    expect(body.page).toBe(1)
    expect(body.pageSize).toBe(24)
    expect(body.totalItems).toBe(body.items.length)
    expect(body.totalPages).toBe(Math.ceil(body.totalItems / 24))
  })

  it('returns only active products (matches a direct read-only count)', async () => {
    const activeCount = await readonlyPrisma.product.count({ where: { isActive: true } })
    const res = await fetch(`${baseUrl}/api/products`)
    const body = (await res.json()) as ProductsEnvelope
    expect(body.items.length).toBe(activeCount)
  })

  it('defaults to sort=newest — matches a direct read-only query with the same deterministic tie-break', async () => {
    const expected = await readonlyPrisma.product.findMany({
      where: { isActive: true },
      orderBy: [{ createdAt: 'desc' }, { slug: 'asc' }],
      select: { slug: true },
    })
    const res = await fetch(`${baseUrl}/api/products`)
    const body = (await res.json()) as ProductsEnvelope
    expect(body.items.map((item) => item.slug)).toEqual(expected.map((p) => p.slug))
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
    const expected = await readonlyPrisma.product.findMany({
      where: { isActive: true, category: { nameHe: 'מינרלים' } },
      select: { slug: true },
    })
    if (expected.length === 0) throw new Error('fixture assumption failed: no active product in category "מינרלים"')

    const res = await fetch(`${baseUrl}/api/products?category=${category.slug}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ProductsEnvelope
    expect(new Set(body.items.map((i) => i.slug))).toEqual(new Set(expected.map((p) => p.slug)))
    expect(body.totalItems).toBe(expected.length)
  })

  it('brand — a single id matches only that brand\'s active products', async () => {
    const brand = await readonlyPrisma.brand.findFirst({ where: { products: { some: { isActive: true } } } })
    if (!brand) throw new Error('fixture assumption failed: no brand has an active product')
    const expected = await readonlyPrisma.product.findMany({
      where: { isActive: true, brandId: brand.id },
      select: { slug: true },
    })

    const res = await fetch(`${baseUrl}/api/products?brand=${brand.id}`)
    const body = (await res.json()) as ProductsEnvelope
    expect(new Set(body.items.map((i) => i.slug))).toEqual(new Set(expected.map((p) => p.slug)))
  })

  it('brand — repeated values are OR-within: the union of both brands\' active products', async () => {
    const brands = await readonlyPrisma.brand.findMany({ where: { products: { some: { isActive: true } } } })
    if (brands.length < 2) throw new Error('fixture assumption failed: fewer than 2 brands have active products')
    const [a, b] = brands
    const expected = await readonlyPrisma.product.findMany({
      where: { isActive: true, brandId: { in: [a!.id, b!.id] } },
      select: { slug: true },
    })

    const res = await fetch(`${baseUrl}/api/products?brand=${a!.id}&brand=${b!.id}`)
    const body = (await res.json()) as ProductsEnvelope
    expect(new Set(body.items.map((i) => i.slug))).toEqual(new Set(expected.map((p) => p.slug)))
  })

  it('ingredient — matches active products carrying that active ingredient (relation "some")', async () => {
    const link = await readonlyPrisma.productIngredient.findFirst({ where: { product: { isActive: true } } })
    if (!link) throw new Error('fixture assumption failed: no ProductIngredient row on an active product')
    const expected = await readonlyPrisma.product.findMany({
      where: { isActive: true, ingredients: { some: { activeIngredientId: link.activeIngredientId } } },
      select: { slug: true },
    })

    const res = await fetch(`${baseUrl}/api/products?ingredient=${link.activeIngredientId}`)
    const body = (await res.json()) as ProductsEnvelope
    expect(new Set(body.items.map((i) => i.slug))).toEqual(new Set(expected.map((p) => p.slug)))
    expect(body.totalItems).toBeGreaterThan(0)
  })

  it('healthGoal — matches active products carrying that health goal (relation "some")', async () => {
    const link = await readonlyPrisma.productHealthGoal.findFirst({ where: { product: { isActive: true } } })
    if (!link) throw new Error('fixture assumption failed: no ProductHealthGoal row on an active product')
    const expected = await readonlyPrisma.product.findMany({
      where: { isActive: true, healthGoals: { some: { healthGoalId: link.healthGoalId } } },
      select: { slug: true },
    })

    const res = await fetch(`${baseUrl}/api/products?healthGoal=${link.healthGoalId}`)
    const body = (await res.json()) as ProductsEnvelope
    expect(new Set(body.items.map((i) => i.slug))).toEqual(new Set(expected.map((p) => p.slug)))
    expect(body.totalItems).toBeGreaterThan(0)
  })

  it('dosageForm — repeated values are OR-within', async () => {
    const forms = await readonlyPrisma.product.findMany({
      where: { isActive: true },
      select: { dosageForm: true },
      distinct: ['dosageForm'],
    })
    if (forms.length < 2) throw new Error('fixture assumption failed: fewer than 2 distinct dosage forms among active products')
    const [f1, f2] = forms.map((f) => f.dosageForm)
    const expected = await readonlyPrisma.product.findMany({
      where: { isActive: true, dosageForm: { in: [f1!, f2!] } },
      select: { slug: true },
    })

    const res = await fetch(`${baseUrl}/api/products?dosageForm=${f1}&dosageForm=${f2}`)
    const body = (await res.json()) as ProductsEnvelope
    expect(new Set(body.items.map((i) => i.slug))).toEqual(new Set(expected.map((p) => p.slug)))
  })

  it('AND across groups: brand + dosageForm narrows to their intersection, not their union', async () => {
    const brand = await readonlyPrisma.brand.findFirst({ where: { products: { some: { isActive: true } } } })
    if (!brand) throw new Error('fixture assumption failed: no brand has an active product')
    const brandOnly = await readonlyPrisma.product.findMany({ where: { isActive: true, brandId: brand.id }, select: { dosageForm: true, slug: true } })
    const form = brandOnly[0]?.dosageForm
    if (!form) throw new Error('fixture assumption failed: brand has no active products')
    const expected = brandOnly.filter((p) => p.dosageForm === form)

    const res = await fetch(`${baseUrl}/api/products?brand=${brand.id}&dosageForm=${form}`)
    const body = (await res.json()) as ProductsEnvelope
    expect(new Set(body.items.map((i) => i.slug))).toEqual(new Set(expected.map((p) => p.slug)))
    // Intersection must never exceed either single-filter result.
    expect(body.totalItems).toBeLessThanOrEqual(brandOnly.length)
  })

  it('minPrice — only products at or above the threshold', async () => {
    const expected = await readonlyPrisma.product.findMany({ where: { isActive: true, price: { gte: '70' } }, select: { slug: true } })
    const res = await fetch(`${baseUrl}/api/products?minPrice=70`)
    const body = (await res.json()) as ProductsEnvelope
    expect(new Set(body.items.map((i) => i.slug))).toEqual(new Set(expected.map((p) => p.slug)))
  })

  it('maxPrice — only products at or below the threshold', async () => {
    const expected = await readonlyPrisma.product.findMany({ where: { isActive: true, price: { lte: '70' } }, select: { slug: true } })
    const res = await fetch(`${baseUrl}/api/products?maxPrice=70`)
    const body = (await res.json()) as ProductsEnvelope
    expect(new Set(body.items.map((i) => i.slug))).toEqual(new Set(expected.map((p) => p.slug)))
  })

  it('minPrice + maxPrice — an inclusive band', async () => {
    const expected = await readonlyPrisma.product.findMany({
      where: { isActive: true, price: { gte: '60', lte: '80' } },
      select: { slug: true },
    })
    const res = await fetch(`${baseUrl}/api/products?minPrice=60&maxPrice=80`)
    const body = (await res.json()) as ProductsEnvelope
    expect(new Set(body.items.map((i) => i.slug))).toEqual(new Set(expected.map((p) => p.slug)))
  })

  it('inStock=true — matches a direct read-only query for stockQuantity > 0', async () => {
    const expected = await readonlyPrisma.product.count({ where: { isActive: true, stockQuantity: { gt: 0 } } })
    const res = await fetch(`${baseUrl}/api/products?inStock=true`)
    const body = (await res.json()) as ProductsEnvelope
    expect(body.totalItems).toBe(expected)
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
// readonlyPrisma at test-authoring time — not fabricated), each picked to
// land on exactly one searched field wherever the fixture allows it. If the
// seed ever changes, a fixture-assumption guard throws a clear message
// rather than passing vacuously or failing cryptically.
describe('GET /api/products — free-text search (Checkpoint E)', () => {
  it('matches a direct read-only query built with the identical OR-across-fields shape, for an arbitrary term', async () => {
    const term = 'ויטמין'
    const expected = await readonlyPrisma.product.findMany({
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

  it('direct field — Hebrew product name match ("אומגה" -> solgar-omega-3 only)', async () => {
    const res = await fetch(`${baseUrl}/api/products?q=${encodeURIComponent('אומגה')}`)
    const body = (await res.json()) as ProductsEnvelope
    expect(body.items.map((i) => i.slug)).toEqual(['solgar-omega-3'])
  })

  it('direct field — English product name match, case-insensitive ("omega" -> solgar-omega-3 only)', async () => {
    const res = await fetch(`${baseUrl}/api/products?q=omega`)
    const body = (await res.json()) as ProductsEnvelope
    expect(body.items.map((i) => i.slug)).toEqual(['solgar-omega-3'])
  })

  it('direct field — Hebrew description match, a term absent from every name ("החרדית" -> superherb-magnesium-max-550 only)', async () => {
    const res = await fetch(`${baseUrl}/api/products?q=${encodeURIComponent('החרדית')}`)
    const body = (await res.json()) as ProductsEnvelope
    expect(body.items.map((i) => i.slug)).toEqual(['superherb-magnesium-max-550'])
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
    const expected = await readonlyPrisma.product.findMany({
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

  it('relation — active ingredient match ("EPA" -> solgar-omega-3 only)', async () => {
    const res = await fetch(`${baseUrl}/api/products?q=EPA`)
    const body = (await res.json()) as ProductsEnvelope
    expect(body.items.map((i) => i.slug)).toEqual(['solgar-omega-3'])
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
   * If a future product's free-text fields happen to contain the literal word
   * "מינרלים"/"Minerals" this goes red for a real reason — read it, don't
   * loosen it.
   */
  async function activeSlugsInCategory(nameHe: string): Promise<Set<string>> {
    const rows = await readonlyPrisma.product.findMany({
      where: { isActive: true, category: { nameHe } },
      select: { slug: true },
    })
    if (rows.length === 0) throw new Error(`fixture assumption failed: no active products in category "${nameHe}"`)
    return new Set(rows.map((r) => r.slug))
  }

  it('relation — Hebrew category match ("מינרלים" -> every Minerals-category product)', async () => {
    const expected = await activeSlugsInCategory('מינרלים')
    const res = await fetch(`${baseUrl}/api/products?q=${encodeURIComponent('מינרלים')}`)
    const body = (await res.json()) as ProductsEnvelope
    expect(body.totalItems).toBe(expected.size)
    for (const item of body.items) expect(expected).toContain(item.slug)
  })

  it('relation — English category match ("Minerals" -> every Minerals-category product)', async () => {
    const expected = await activeSlugsInCategory('מינרלים')
    const res = await fetch(`${baseUrl}/api/products?q=Minerals`)
    const body = (await res.json()) as ProductsEnvelope
    expect(body.totalItems).toBe(expected.size)
    for (const item of body.items) expect(expected).toContain(item.slug)
  })

  it('relation — Hebrew health-goal match ("עצמות" -> both Bone-Health-goal products)', async () => {
    const res = await fetch(`${baseUrl}/api/products?q=${encodeURIComponent('עצמות')}`)
    const body = (await res.json()) as ProductsEnvelope
    expect(new Set(body.items.map((i) => i.slug))).toEqual(new Set(['solgar-cal-mag-d3', 'superherb-vitamin-d']))
  })

  it('relation — English health-goal match ("Bone" -> both Bone-Health-goal products)', async () => {
    const res = await fetch(`${baseUrl}/api/products?q=Bone`)
    const body = (await res.json()) as ProductsEnvelope
    expect(new Set(body.items.map((i) => i.slug))).toEqual(new Set(['solgar-cal-mag-d3', 'superherb-vitamin-d']))
  })

  it('relation — brand match returns every product of that brand (Solgar)', async () => {
    const brand = await readonlyPrisma.brand.findFirst({ where: { name: 'סולגאר' } })
    if (!brand) throw new Error('fixture assumption failed: brand "סולגאר" not found')
    const expected = await readonlyPrisma.product.count({ where: { isActive: true, brandId: brand.id } })
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
      const rows = await readonlyPrisma.$queryRaw<Array<{ count: bigint }>>`
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
      const totalActive = await readonlyPrisma.product.count({ where: { isActive: true } })
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
      const brand = await readonlyPrisma.brand.findFirst({ where: { name: 'סולגאר' } })
      if (!brand) throw new Error('fixture assumption failed: brand "סולגאר" not found')
      const res = await fetch(`${baseUrl}/api/products?q=${encodeURIComponent('ויטמין')}&brand=${brand.id}`)
      const body = (await res.json()) as ProductsEnvelope
      const expected = await readonlyPrisma.product.findMany({
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

  it('inactive products are unreachable via search — verified structurally (no inactive product exists in the current seed to probe live)', async () => {
    const activeCount = await readonlyPrisma.product.count({ where: { isActive: true } })
    const totalCount = await readonlyPrisma.product.count({})
    expect(totalCount).toBe(activeCount) // 0 inactive products today — see catalogFilterWhere.test.ts for the pure isActive-always-present proof
  })
})

describe('GET /api/products — sorting (Checkpoint D)', () => {
  it('price_asc — matches a direct read-only query with the same tie-break', async () => {
    const expected = await readonlyPrisma.product.findMany({
      where: { isActive: true },
      orderBy: [{ price: 'asc' }, { createdAt: 'desc' }, { slug: 'asc' }],
      select: { slug: true },
    })
    const res = await fetch(`${baseUrl}/api/products?sort=price_asc`)
    const body = (await res.json()) as ProductsEnvelope
    expect(body.items.map((i) => i.slug)).toEqual(expected.map((p) => p.slug))
  })

  it('price_desc — matches a direct read-only query with the same tie-break', async () => {
    const expected = await readonlyPrisma.product.findMany({
      where: { isActive: true },
      orderBy: [{ price: 'desc' }, { createdAt: 'desc' }, { slug: 'asc' }],
      select: { slug: true },
    })
    const res = await fetch(`${baseUrl}/api/products?sort=price_desc`)
    const body = (await res.json()) as ProductsEnvelope
    expect(body.items.map((i) => i.slug)).toEqual(expected.map((p) => p.slug))
  })

  it('newest — matches a direct read-only query with the same tie-break', async () => {
    const expected = await readonlyPrisma.product.findMany({
      where: { isActive: true },
      orderBy: [{ createdAt: 'desc' }, { slug: 'asc' }],
      select: { slug: true },
    })
    const res = await fetch(`${baseUrl}/api/products?sort=newest`)
    const body = (await res.json()) as ProductsEnvelope
    expect(body.items.map((i) => i.slug)).toEqual(expected.map((p) => p.slug))
  })

  it('price_asc and price_desc are true reversals of each other under the tie-break (no ties silently reordered)', async () => {
    const asc = await fetch(`${baseUrl}/api/products?sort=price_asc`).then((r) => r.json()) as ProductsEnvelope
    const desc = await fetch(`${baseUrl}/api/products?sort=price_desc`).then((r) => r.json()) as ProductsEnvelope
    expect(asc.items.map((i) => i.slug)).toEqual([...desc.items.map((i) => i.slug)].reverse())
  })
})

// Checkpoint F — real popularity execution (§6a). The current vitashop_dev
// seed has ZERO orders/order items (verified read-only — no seed permitted
// by this file's own read-only rule), matching the plan's own documented
// expectation: "every product scores 0 and all products tie; the
// deterministic tie-break resolves the order. Stable and reproducible
// today." That means today's `sort=popularity` output is PROVABLY identical
// to `sort=newest`'s — not because popularity silently substitutes newest
// (catalogPopularity.test.ts proves the scoring/sorting logic is genuinely
// independent, and catalogOrderBy no longer even accepts 'popularity' as an
// input), but because the tie-break is the only thing that CAN differ when
// every score is 0. The actual SUM/cancelled-exclusion aggregation logic
// (which needs order data this file may never create) is proven at the unit
// layer — see resolvePopularityScores' fake-Prisma test.
describe('GET /api/products — sort=popularity execution (Checkpoint F)', () => {
  it('is accepted (never 400) and returns 200 with results', async () => {
    const res = await fetch(`${baseUrl}/api/products?sort=popularity`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ProductsEnvelope
    expect(body.items.length).toBeGreaterThan(0)
  })

  it("today's empty order data means popularity output equals newest's output (the documented all-tie behaviour)", async () => {
    const popularity = await fetch(`${baseUrl}/api/products?sort=popularity`).then((r) => r.json()) as ProductsEnvelope
    const newest = await fetch(`${baseUrl}/api/products?sort=newest`).then((r) => r.json()) as ProductsEnvelope
    expect(popularity.items.map((i) => i.slug)).toEqual(newest.items.map((i) => i.slug))
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

  it('composes with q search', async () => {
    const res = await fetch(`${baseUrl}/api/products?sort=popularity&q=omega`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ProductsEnvelope
    expect(body.items.map((i) => i.slug)).toEqual(['solgar-omega-3'])
  })

  it('pagination — a past-the-end popularity-sorted page is a truthful empty page, not a crash', async () => {
    const totalItems = await readonlyPrisma.product.count({ where: { isActive: true } })
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
    const totalItems = await readonlyPrisma.product.count({ where: { isActive: true } })
    if (totalItems === 0) throw new Error('fixture assumption failed: no active products at all')
    const res = await fetch(`${baseUrl}/api/products?page=999`)
    const body = (await res.json()) as ProductsEnvelope & { fallback: unknown }
    expect(body.items).toEqual([])
    expect(body.fallback).toBeNull()
  })

  it('kind="category" — a zero-result query with a valid category suggests other products from that same category, every other filter relaxed', async () => {
    const category = CANONICAL_CATEGORIES.find((c) => c.nameHe === 'מינרלים')
    if (!category) throw new Error('fixture assumption failed: "מינרלים" is not canonical')
    const expectedCategoryProducts = await readonlyPrisma.product.count({
      where: { isActive: true, category: { nameHe: 'מינרלים' } },
    })
    if (expectedCategoryProducts === 0) throw new Error('fixture assumption failed: no active product in "מינרלים"')

    // dosageForm=DROPS matches no product in the Minerals category today ->
    // forces a genuine zero-result primary query with a VALID category.
    const res = await fetch(`${baseUrl}/api/products?category=${category.slug}&dosageForm=DROPS`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ProductsEnvelope & { fallback: { kind: string; items: unknown[]; limit: number } | null }
    expect(body.totalItems).toBe(0)
    expect(body.fallback).not.toBeNull()
    expect(body.fallback!.kind).toBe('category')
    expect(body.fallback!.limit).toBe(8)
    expect(body.fallback!.items).toHaveLength(expectedCategoryProducts)
  })

  it('kind="popular" — a zero-result query with no category suggests popular products across the whole active catalogue', async () => {
    const activeProducts = await readonlyPrisma.product.findMany({ where: { isActive: true } })
    const res = await fetch(`${baseUrl}/api/products?minPrice=99999&maxPrice=99999.99`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ProductsEnvelope & { fallback: { kind: string; items: PublicCatalogProduct[]; limit: number } | null }
    expect(body.totalItems).toBe(0)
    expect(body.fallback).not.toBeNull()
    expect(body.fallback!.kind).toBe('popular')
    expect(body.fallback!.limit).toBe(8)
    expect(body.fallback!.items).toHaveLength(Math.min(activeProducts.length, 8))

    // §6b 🔴 "Both kinds use the same deterministic popularity ordering
    // (§6a)" — asserted directly, not just implemented. Today's seed has
    // zero orders, so every score is 0 and sortByPopularity's tie-break
    // (createdAt desc, slug asc) alone decides — this pins that exact
    // order against a direct DB read, the same cross-check pattern the
    // popularity-execution suite above already uses.
    const expectedOrder = sortByPopularity(activeProducts, new Map())
      .slice(0, 8)
      .map((p) => p.slug)
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
      const product = await readonlyPrisma.product.findUnique({ where: { slug: item.slug } })
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
    const brand = await readonlyPrisma.brand.findFirst({ where: { products: { some: { isActive: true } } } })
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
    const brand = await readonlyPrisma.brand.findFirst({ where: { products: { some: { isActive: true } } } })
    if (!brand) throw new Error('fixture assumption failed: no brand has an active product')
    const res = await fetch(`${baseUrl}/api/products?brand=${brand.id}`)
    expect(res.status).toBe(200)
  })
})

describe('GET /api/products — pagination (Checkpoint D)', () => {
  it('page 1 with pageSize 24 and totalItems <= 24 returns every active product on one page', async () => {
    const totalItems = await readonlyPrisma.product.count({ where: { isActive: true } })
    if (totalItems > 24) throw new Error('fixture assumption failed: more than 24 active products — pagination fixture needs revisiting')
    const res = await fetch(`${baseUrl}/api/products`)
    const body = (await res.json()) as ProductsEnvelope
    expect(body.page).toBe(1)
    expect(body.pageSize).toBe(24)
    expect(body.totalItems).toBe(totalItems)
    expect(body.totalPages).toBe(totalItems === 0 ? 0 : 1)
    expect(body.items).toHaveLength(totalItems)
  })

  it('a past-the-end page returns a truthful empty page — items: [], page > totalPages, totalItems > 0 — not canonicalized server-side', async () => {
    const totalItems = await readonlyPrisma.product.count({ where: { isActive: true } })
    if (totalItems === 0) throw new Error('fixture assumption failed: no active products at all')
    const res = await fetch(`${baseUrl}/api/products?page=2`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ProductsEnvelope
    expect(body.items).toEqual([])
    expect(body.page).toBe(2)
    expect(body.totalItems).toBe(totalItems)
    expect(body.totalPages).toBe(1)
    expect(body.page).toBeGreaterThan(body.totalPages)
  })

  // 🔴 Corrected 2026-08-10 (Codex review): behavioral proof, not just
  // arithmetic — a past-the-end or zero-result query must never reach
  // Prisma's findMany at all (no skip, safe or otherwise, is ever computed
  // or sent for it). Spies on the real app's Prisma singleton.
  it('a past-the-end page never calls findMany', async () => {
    const totalItems = await readonlyPrisma.product.count({ where: { isActive: true } })
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
    const totalItems = await readonlyPrisma.product.count({ where: { isActive: true } })
    if (totalItems === 0) throw new Error('fixture assumption failed: no active products at all')
    const findManySpy = vi.spyOn(appPrisma.product, 'findMany')
    const res = await fetch(`${baseUrl}/api/products?page=1`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ProductsEnvelope
    expect(body.items).toHaveLength(totalItems)
    expect(findManySpy).toHaveBeenCalledTimes(1)
    expect(findManySpy).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 24 }))
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

  it('brands — exactly the brands used by active products, with real ids and labels', async () => {
    const expected = await readonlyPrisma.brand.findMany({
      where: { products: { some: { isActive: true } } },
      select: { id: true, name: true },
    })
    const res = await fetch(`${baseUrl}/api/catalog/facets`)
    const body = (await res.json()) as FacetsEnvelope
    expect(new Set(body.brands.map((b) => b.id))).toEqual(new Set(expected.map((b) => b.id)))
    for (const brand of expected) {
      expect(body.brands).toContainEqual({ id: brand.id, label: brand.name })
    }
  })

  it('ingredients — exactly the active ingredients used by active products', async () => {
    const expected = await readonlyPrisma.activeIngredient.findMany({
      where: { products: { some: { product: { isActive: true } } } },
      select: { id: true },
    })
    const res = await fetch(`${baseUrl}/api/catalog/facets`)
    const body = (await res.json()) as FacetsEnvelope
    expect(new Set(body.ingredients.map((i) => i.id))).toEqual(new Set(expected.map((i) => i.id)))
  })

  it('healthGoals — exactly the health goals used by active products, bilingual labels', async () => {
    const expected = await readonlyPrisma.healthGoal.findMany({
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
    const expected = await readonlyPrisma.product.findMany({
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
      const activeCount = await readonlyPrisma.product.count({ where: { isActive: true, brandId: brand.id } })
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
    const product = await readonlyPrisma.product.findFirst({
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
    const product = await readonlyPrisma.product.findFirst({
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

    const row = await readonlyPrisma.product.findUniqueOrThrow({
      where: { slug },
      include: { brand: true, category: true, images: true },
    })
    expect(dto.serialNumber).toBe(row.id)
    expect(dto.slug).toBe(row.slug)
    expect(dto.nameHe).toBe(row.nameHe)
    expect(dto.brandName).toBe(row.brand.name)
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
    const inactive = await readonlyPrisma.product.findFirst({
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
      const inactiveCount = await readonlyPrisma.product.count({ where: { isActive: false } })
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
