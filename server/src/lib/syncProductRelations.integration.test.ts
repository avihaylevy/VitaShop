import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { syncProductHealthGoals, syncProductImages, syncProductIngredients } from './syncProductRelations.js'

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
    await prisma.productHealthGoal.deleteMany({ where: { productId: p.id } })
    await prisma.productImage.deleteMany({ where: { productId: p.id } })
    await prisma.product.delete({ where: { id: p.id } })
  }
  await prisma.activeIngredient.deleteMany({ where: { name: { startsWith: FIXTURE_PREFIX } } })
  await prisma.healthGoal.deleteMany({ where: { nameHe: { startsWith: FIXTURE_PREFIX } } })
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


/**
 * 🔴 THE SAME PROPERTY, FOR THE RELATIONS FOUND BY AUDIT RATHER THAN BY
 * ACCIDENT. Ingredients bit first and was fixed in 86c559a; images and health
 * goals had the identical add-only shape and were still latent, because no
 * seeded product had ever changed its image_file or its health_goals.
 *
 * The RENAME case is the one that catches it, and SET EQUALITY is the
 * assertion that matters — "contains the new value" passes while the old one
 * is still attached.
 */
describe('syncProductImages — a changed image_file REPLACES, never accumulates', () => {
  async function urls(): Promise<string[]> {
    const rows = await prisma.productImage.findMany({ where: { productId }, select: { url: true } })
    return rows.map((r) => r.url).sort()
  }

  it('creates the image on a first run and is idempotent', async () => {
    await syncProductImages(prisma, productId, [`${FIXTURE_PREFIX}a.webp`])
    await syncProductImages(prisma, productId, [`${FIXTURE_PREFIX}a.webp`])
    expect(await urls()).toEqual([`${FIXTURE_PREFIX}a.webp`])
  })

  it('🔴 changing the filename prunes the old row — exactly one image remains', async () => {
    await syncProductImages(prisma, productId, [`${FIXTURE_PREFIX}b.png`])
    const after = await urls()
    expect(after).toEqual([`${FIXTURE_PREFIX}b.png`])
    expect(after).not.toContain(`${FIXTURE_PREFIX}a.webp`)
    // The failure this guards: two rows, and which one renders depends on
    // ordering. Batch 1 changed four image_file values from .png to .webp and
    // only escaped because those rows had not been seeded yet.
    expect(after).toHaveLength(1)
  })
})

describe('syncProductHealthGoals — a product must not keep a goal it no longer claims', () => {
  let goalA: string
  let goalB: string

  beforeAll(async () => {
    const a = await prisma.healthGoal.create({
      data: { nameHe: `${FIXTURE_PREFIX}goal-a`, nameEn: `${FIXTURE_PREFIX}goal-a-en` },
    })
    const b = await prisma.healthGoal.create({
      data: { nameHe: `${FIXTURE_PREFIX}goal-b`, nameEn: `${FIXTURE_PREFIX}goal-b-en` },
    })
    goalA = a.id
    goalB = b.id
  })

  async function goalNames(): Promise<string[]> {
    const rows = await prisma.productHealthGoal.findMany({
      where: { productId },
      select: { healthGoal: { select: { nameHe: true } } },
    })
    return rows.map((r) => r.healthGoal.nameHe).sort()
  }

  it('links the goals and is idempotent', async () => {
    await syncProductHealthGoals(prisma, productId, [goalA, goalB])
    await syncProductHealthGoals(prisma, productId, [goalA, goalB])
    expect(await goalNames()).toEqual([`${FIXTURE_PREFIX}goal-a`, `${FIXTURE_PREFIX}goal-b`])
  })

  it('🔴 dropping a goal prunes the link — the product stops appearing under it', async () => {
    await syncProductHealthGoals(prisma, productId, [goalB])
    const after = await goalNames()
    expect(after).toEqual([`${FIXTURE_PREFIX}goal-b`])
    expect(after).not.toContain(`${FIXTURE_PREFIX}goal-a`)
  })

  it('clearing health_goals entirely removes every link', async () => {
    await syncProductHealthGoals(prisma, productId, [])
    expect(await goalNames()).toEqual([])
  })
})
