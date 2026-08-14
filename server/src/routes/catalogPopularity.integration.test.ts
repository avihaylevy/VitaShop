// ISSUE-106 — popularity ordering, proven against data THIS FILE OWNS.
//
// 🔴 WHY THIS FILE EXISTS: catalog.integration.test.ts asserted that
// `sort=popularity` output equals `sort=newest` output — true only while the
// ENTIRE database held zero orders. The first real purchase in the project's
// history (the user's, 2026-08-14) turned both popularity tests red with
// nothing wrong. A test must not assert a global property of a shared
// database; this file asserts the RELATIVE order of fixture products whose
// order history it creates itself, so real orders can never break it and it
// keeps its discriminating power even if the database is wiped clean.
//
// The fixtures are built so that every wrong implementation disagrees with
// the expected order, not just "scores ignored":
//   · slug-asc tie-break alone would yield  alpha, beta, mid, zebra
//   · createdAt-desc tie-break alone yields alpha(newest), mid, beta, zebra
//   · counting CANCELLED orders would put   alpha (50 cancelled units) first
//   · ignoring the 30-day window would put  beta  (50 stale units) first
// The correct answer — units sold in the last 30 days, cancelled excluded,
// then createdAt desc, then slug asc — is  zebra(5), mid(2), alpha(0), beta(0).
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TEST_FIXTURE_SLUG_PREFIX } from '../lib/testFixturePrefix.js'

function assertLocalVitashopDevTarget(): void {
  const raw = process.env.DATABASE_URL
  if (!raw) throw new Error('DATABASE_URL is not set. This integration test requires the local "vitashop_dev" database.')
  const url = new URL(raw)
  const database = url.pathname.replace(/^\//, '')
  const isLocalHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (!isLocalHost || database !== 'vitashop_dev') {
    throw new Error(`DATABASE_URL points at "${url.hostname}/${database}" — this test writes fixtures and requires exactly localhost/vitashop_dev.`)
  }
}

assertLocalVitashopDevTarget()

let server: Server
let baseUrl: string
let prisma: PrismaClient

const FIXTURE_EMAIL = 'zz-popularity-fixture@example.test'
const SLUG = {
  zebra: `${TEST_FIXTURE_SLUG_PREFIX}pop-zebra`, // 5 units, paid, in-window  → 1st
  mid: `${TEST_FIXTURE_SLUG_PREFIX}pop-mid`, // 2 units, paid, in-window  → 2nd
  alpha: `${TEST_FIXTURE_SLUG_PREFIX}pop-alpha`, // 50 units but CANCELLED    → score 0
  beta: `${TEST_FIXTURE_SLUG_PREFIX}pop-beta`, // 50 units but 40 DAYS OLD  → score 0
} as const

interface ProductsEnvelope {
  items: { slug: string }[]
  totalPages: number
}

async function fetchAllPopularitySlugs(): Promise<string[]> {
  const first = (await fetch(`${baseUrl}/api/products?sort=popularity&page=1`).then((r) => r.json())) as ProductsEnvelope
  const slugs = first.items.map((i) => i.slug)
  for (let page = 2; page <= first.totalPages; page++) {
    const body = (await fetch(`${baseUrl}/api/products?sort=popularity&page=${page}`).then((r) => r.json())) as ProductsEnvelope
    slugs.push(...body.items.map((i) => i.slug))
  }
  return slugs
}

// Deletes everything this file's fixtures could have left behind — including a
// previous CRASHED run's leftovers, which is why it runs BEFORE creation too.
// INV-03 / DEC-063: a test fixture may remove only rows it created; every row
// touched here is identified by this file's own email or slug prefix.
async function wipeFixtures(): Promise<void> {
  const orders = await prisma.order.findMany({
    where: { user: { email: FIXTURE_EMAIL } },
    select: { id: true },
  })
  if (orders.length > 0) {
    const ids = orders.map((o) => o.id)
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: ids } } })
    await prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } })
    await prisma.order.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.product.deleteMany({ where: { slug: { in: Object.values(SLUG) } } })
  await prisma.user.deleteMany({ where: { email: FIXTURE_EMAIL } })
}

beforeAll(async () => {
  process.env.SESSION_SECRET ??= 'integration-test-only-not-a-real-secret'
  const { app } = await import('../index.js')
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Failed to determine the ephemeral test server port.')
  baseUrl = `http://127.0.0.1:${address.port}`

  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  await wipeFixtures()

  const shape = await prisma.product.findFirstOrThrow({
    where: { isActive: true },
    select: { categoryId: true, brandId: true },
  })
  // createdAt is set EXPLICITLY, old and in a deliberate order (alpha newest …
  // zebra oldest), so a scoring bug cannot hide behind the tie-break — see the
  // header table. Old dates also keep these rows off "newest"-driven surfaces.
  const productDates = {
    zebra: new Date('2020-01-01T00:00:00Z'),
    beta: new Date('2020-01-02T00:00:00Z'),
    mid: new Date('2020-01-03T00:00:00Z'),
    alpha: new Date('2020-01-04T00:00:00Z'),
  } as const
  for (const key of ['zebra', 'mid', 'alpha', 'beta'] as const) {
    await prisma.product.create({
      data: {
        slug: SLUG[key], nameHe: 'בדיקת פופולריות', nameEn: 'Popularity fixture',
        categoryId: shape.categoryId, brandId: shape.brandId,
        dosageForm: 'CAPSULE', packageQuantity: 60, usageInstructions: 'בדיקה',
        price: '10.00', stockQuantity: 100,
        descriptionHe: 'בדיקה', descriptionEn: 'fixture', warningsAllergens: '',
        isActive: true, createdAt: productDates[key],
      },
      select: { id: true },
    })
  }

  const user = await prisma.user.create({
    data: {
      email: FIXTURE_EMAIL, firstName: 'Popularity', lastName: 'Fixture',
      passwordHash: 'not-a-real-hash-never-logged-in', termsAcceptedAt: new Date(),
      status: 'active',
    },
    select: { id: true },
  })

  const productId = async (slug: string): Promise<string> =>
    (await prisma.product.findUniqueOrThrow({ where: { slug }, select: { id: true } })).id

  const daysAgo = (n: number): Date => new Date(Date.now() - n * 24 * 60 * 60 * 1000)
  const orderShape = (n: number) => ({
    orderNumber: `zz-test-pop-${n}`, userId: user.id,
    totalAmount: '10.00', idempotencyKey: `zz-test-pop-${n}`,
    deliveryMethod: 'self_pickup' as const, shippingCost: '0.00',
  })
  const item = async (slug: string, quantity: number) => ({
    productId: await productId(slug), quantity,
    unitPriceAtPurchase: '10.00',
    productNameHeAtPurchase: 'בדיקת פופולריות', productNameEnAtPurchase: 'Popularity fixture',
  })

  // Recent PAID order — the only one that may count: zebra 5, mid 2.
  await prisma.order.create({
    data: { ...orderShape(1), status: 'paid', items: { create: [await item(SLUG.zebra, 5), await item(SLUG.mid, 2)] } },
    select: { id: true },
  })
  // Recent but CANCELLED — 50 units of alpha that must count for nothing.
  await prisma.order.create({
    data: { ...orderShape(2), status: 'cancelled', items: { create: [await item(SLUG.alpha, 50)] } },
    select: { id: true },
  })
  // Paid but 40 days old — 50 units of beta, outside the 30-day window.
  await prisma.order.create({
    data: { ...orderShape(3), status: 'paid', createdAt: daysAgo(40), items: { create: [await item(SLUG.beta, 50)] } },
    select: { id: true },
  })
}, 60_000)

afterAll(async () => {
  await wipeFixtures()
  await prisma.$disconnect()
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()))
  })
})

describe('GET /api/products?sort=popularity — units sold rank fixture products (ISSUE-106)', () => {
  let index: Record<keyof typeof SLUG, number>

  beforeAll(async () => {
    const slugs = await fetchAllPopularitySlugs()
    const find = (slug: string): number => {
      const i = slugs.indexOf(slug)
      if (i === -1) throw new Error(`fixture product missing from the popularity output: ${slug}`)
      return i
    }
    index = {
      zebra: find(SLUG.zebra), mid: find(SLUG.mid),
      alpha: find(SLUG.alpha), beta: find(SLUG.beta),
    }
  })

  it('more units sold ranks higher: zebra (5 units) before mid (2 units)', () => {
    expect(index.zebra).toBeLessThan(index.mid)
  })

  it('CANCELLED orders count for nothing: alpha (50 cancelled units) ranks below mid (2 real units)', () => {
    expect(index.mid).toBeLessThan(index.alpha)
  })

  it('orders OUTSIDE the 30-day window count for nothing: beta (50 stale units) ranks below mid', () => {
    expect(index.mid).toBeLessThan(index.beta)
  })

  it('score-0 products tie and fall back to createdAt desc: alpha (newer) before beta', () => {
    // This is the documented all-tie behaviour the deleted global test used to
    // pin — now asserted between two rows whose createdAt this file controls.
    expect(index.alpha).toBeLessThan(index.beta)
  })
})
