import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { syncProductIngredients } from './syncProductIngredients.js'

/**
 * 🔴 REGRESSION TEST FOR THE SEED IDEMPOTENCY GAP — added 2026-08-11.
 *
 * The gap was caught by a POST-SEED COUNT typed by hand. A count does not run
 * in CI, so nothing stopped the pruning from regressing. This is that guard.
 *
 * What went wrong: `syncProductIngredients` (then inline in `prisma/seed.ts`)
 * only ADDED and UPDATED links. It never removed one whose ingredient had
 * dropped out of the CSV. Renaming the ingredient key in ISSUE-049 therefore
 * left every product holding its old English link AND a new Hebrew one — the
 * catalogue filter showed 92 options where the source data named 46.
 *
 * 🔴 The reason it hid for so long: the catalogue had only ever GROWN. A
 * convergence property that holds under monotonic growth is not idempotency.
 * The same blind spot produced ISSUE-041's seed-coupled assertions.
 *
 * ⚠️ This test WRITES, unlike `catalog.integration.test.ts`, which is
 * read-only by its own rule. It therefore operates ONLY on fixtures it creates
 * under a reserved slug prefix and removes them in `afterAll` — it never
 * touches seeded catalogue rows.
 */

const FIXTURE_PREFIX = 'zz-synctest-'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

let productId: string
let categoryId: string
let brandId: string

async function cleanup(): Promise<void> {
  const products = await prisma.product.findMany({
    where: { slug: { startsWith: FIXTURE_PREFIX } },
    select: { id: true },
  })
  for (const p of products) {
    await prisma.productIngredient.deleteMany({ where: { productId: p.id } })
    await prisma.product.delete({ where: { id: p.id } })
  }
  await prisma.activeIngredient.deleteMany({ where: { name: { startsWith: FIXTURE_PREFIX } } })
  await prisma.category.deleteMany({ where: { nameHe: { startsWith: FIXTURE_PREFIX } } })
  await prisma.brand.deleteMany({ where: { name: { startsWith: FIXTURE_PREFIX } } })
}

beforeAll(async () => {
  await cleanup()
  // ⚠️ `Category` has no `slug` column — the nameHe -> slug mapping lives in
  // `catalogCategories.ts`, by that file's own note.
  const category = await prisma.category.create({
    data: { nameHe: `${FIXTURE_PREFIX}cat`, nameEn: `${FIXTURE_PREFIX}cat-en` },
  })
  categoryId = category.id
  const brand = await prisma.brand.create({ data: { name: `${FIXTURE_PREFIX}brand` } })
  brandId = brand.id
  const product = await prisma.product.create({
    data: {
      slug: `${FIXTURE_PREFIX}product`,
      nameHe: `${FIXTURE_PREFIX}he`,
      nameEn: `${FIXTURE_PREFIX}en`,
      categoryId,
      brandId,
      dosageForm: 'CAPSULE',
      packageQuantity: 30,
      usageInstructions: 'x',
      price: '1.00',
      stockQuantity: 1,
      descriptionHe: 'x',
      descriptionEn: 'x',
      warningsAllergens: 'x',
      isActive: false, // never let a fixture reach the catalogue
    },
  })
  productId = product.id
})

afterAll(async () => {
  await cleanup()
  await prisma.$disconnect()
})

async function linkedNames(): Promise<string[]> {
  const rows = await prisma.productIngredient.findMany({
    where: { productId },
    select: { activeIngredient: { select: { name: true } } },
  })
  return rows.map((r) => r.activeIngredient.name).sort()
}

describe('syncProductIngredients — the seed must CONVERGE, not merely grow', () => {
  it('creates the links on a first run', async () => {
    await syncProductIngredients(prisma, productId, [
      { name: `${FIXTURE_PREFIX}alpha`, amount: '10', unit: 'mg' },
      { name: `${FIXTURE_PREFIX}beta`, amount: '20', unit: 'mg' },
    ])
    expect(await linkedNames()).toEqual([`${FIXTURE_PREFIX}alpha`, `${FIXTURE_PREFIX}beta`])
  })

  it('is idempotent — re-running with the same set changes nothing', async () => {
    await syncProductIngredients(prisma, productId, [
      { name: `${FIXTURE_PREFIX}alpha`, amount: '10', unit: 'mg' },
      { name: `${FIXTURE_PREFIX}beta`, amount: '20', unit: 'mg' },
    ])
    expect(await linkedNames()).toEqual([`${FIXTURE_PREFIX}alpha`, `${FIXTURE_PREFIX}beta`])
  })

  it('updates amount and unit in place rather than duplicating the link', async () => {
    await syncProductIngredients(prisma, productId, [
      { name: `${FIXTURE_PREFIX}alpha`, amount: '99', unit: 'mcg' },
      { name: `${FIXTURE_PREFIX}beta`, amount: '20', unit: 'mg' },
    ])
    const rows = await prisma.productIngredient.findMany({
      where: { productId, activeIngredient: { name: `${FIXTURE_PREFIX}alpha` } },
      select: { amount: true, unit: true },
    })
    // Exactly ONE row — an update, not a second link alongside the first.
    expect(rows).toHaveLength(1)
    // `amount` is a Prisma Decimal, not a string — compare its value.
    expect(rows[0]?.amount.toString()).toBe('99')
    expect(rows[0]?.unit).toBe('mcg')
  })

  /**
   * 🔴 THE ONE THAT MATTERS. This is the exact shape of the ISSUE-049 failure:
   * the ingredient key is RENAMED, which under the old add-only code left the
   * product linked to both the old and the new name.
   */
  it('RENAMING an ingredient key prunes the old link — no orphaned links survive', async () => {
    await syncProductIngredients(prisma, productId, [
      { name: `${FIXTURE_PREFIX}alpha-renamed`, amount: '10', unit: 'mg' },
      { name: `${FIXTURE_PREFIX}beta`, amount: '20', unit: 'mg' },
    ])

    const names = await linkedNames()
    // Exactly the source set — not a superset.
    expect(names).toEqual([`${FIXTURE_PREFIX}alpha-renamed`, `${FIXTURE_PREFIX}beta`])
    expect(names).not.toContain(`${FIXTURE_PREFIX}alpha`)
    // The count matches the source data — 2 in, 2 linked, never 3.
    expect(names).toHaveLength(2)

    // The renamed-away ActiveIngredient still exists but is unreferenced,
    // which is what keeps it out of the catalogue facets.
    const orphanLinks = await prisma.productIngredient.count({
      where: { activeIngredient: { name: `${FIXTURE_PREFIX}alpha` } },
    })
    expect(orphanLinks).toBe(0)
  })

  it('REMOVING an ingredient prunes it, and emptying the list prunes them all', async () => {
    await syncProductIngredients(prisma, productId, [
      { name: `${FIXTURE_PREFIX}beta`, amount: '20', unit: 'mg' },
    ])
    expect(await linkedNames()).toEqual([`${FIXTURE_PREFIX}beta`])

    await syncProductIngredients(prisma, productId, [])
    expect(await linkedNames()).toEqual([])
  })
})
