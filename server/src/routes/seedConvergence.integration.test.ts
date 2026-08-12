import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  INGREDIENTS_CSV_PATH,
  parseCsvFile,
  readVerifiedProductRows,
} from '../lib/productsCsv.js'

/**
 * 🔴 SEED CONVERGENCE — the database must EQUAL the CSV's desired state.
 *
 * WHY THIS FILE EXISTS. The seed has now shipped the SAME BUG FOUR TIMES, and
 * every instance was found by accident rather than by a test:
 *
 *   1  ingredient links were never pruned when a row left the CSV   86c559a
 *   2  image and health-goal links, the same shape                  8edd538
 *   3  a product that RETURNED to the verified set stayed
 *      isActive=false — 49 verified rows, 44 visible to shoppers    7baac10
 *   4  ...is already written somewhere, which is the whole point
 *
 * One family: **the seed GROWS but does not CONVERGE.** Each instance was
 * patched individually and the family survived. These assertions are written
 * against the family — SET EQUALITY, not "contains" in either direction,
 * because every one of those bugs passes a containment check from the side it
 * grows on.
 *
 * 🔴 MUTATION-PROVED 2026-08-12, both directions, before this file was
 * reported as done:
 *   · deactivating one verified product by hand  -> RED, naming the slug
 *   · inserting one orphan ingredient link       -> RED, naming the pair
 *   · restoring both                             -> GREEN
 * A test that has never failed has never been shown to test anything.
 *
 * ⚠️ These tests READ the live dev database and assume `prisma db seed` has
 * been run against the current CSV. They do not seed it themselves: the claim
 * under test is about the state the seed LEAVES BEHIND, so seeding inside the
 * test would only prove the seed agrees with itself in one run.
 */

let prisma: PrismaClient

beforeAll(() => {
  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  })
})

afterAll(async () => {
  await prisma.$disconnect()
})

/** Symmetric difference, reported both ways so a failure says WHICH side drifted. */
function diff(actual: Set<string>, expected: Set<string>) {
  return {
    inDatabaseButNotInCsv: [...actual].filter((v) => !expected.has(v)).sort(),
    inCsvButNotInDatabase: [...expected].filter((v) => !actual.has(v)).sort(),
  }
}

const NO_DRIFT = { inDatabaseButNotInCsv: [], inCsvButNotInDatabase: [] }

describe('seed convergence — the database equals the CSV, in both directions', () => {
  it('ACTIVE PRODUCT SLUGS are exactly the verified rows — instance 3 of the family', async () => {
    const expected = new Set(readVerifiedProductRows().map((r) => r.slug ?? ''))
    const actual = new Set(
      (await prisma.product.findMany({ where: { isActive: true }, select: { slug: true } })).map(
        (p) => p.slug,
      ),
    )

    // 🔴 Both directions. `inCsvButNotInDatabase` is the bug 7baac10 fixed —
    // a re-verified row left soft-deleted. `inDatabaseButNotInCsv` is its
    // mirror: a demoted row still on sale.
    expect(diff(actual, expected)).toEqual(NO_DRIFT)
    expect(actual.size).toBe(expected.size)
  })

  it('INGREDIENT LINKS are exactly the verified ingredient rows — instance 1 of the family', async () => {
    const verifiedSlugs = new Set(readVerifiedProductRows().map((r) => r.slug ?? ''))
    const expected = new Set(
      parseCsvFile(INGREDIENTS_CSV_PATH)
        .filter(
          (r) =>
            (r.verified ?? '').trim() === 'yes' &&
            verifiedSlugs.has(r.product_slug ?? '') &&
            (r.ingredient_he ?? '').trim().length > 0,
        )
        .map((r) => `${r.product_slug ?? ''}::${(r.ingredient_he ?? '').trim()}`),
    )

    const actual = new Set(
      (
        await prisma.productIngredient.findMany({
          select: {
            product: { select: { slug: true } },
            activeIngredient: { select: { name: true } },
          },
        })
      ).map((row) => `${row.product.slug}::${row.activeIngredient.name}`),
    )

    expect(diff(actual, expected)).toEqual(NO_DRIFT)
  })

  it('IMAGE LINKS are exactly one per verified row, and the CSV names the file — instance 2', async () => {
    const expected = new Set(
      readVerifiedProductRows().map((r) => `${r.slug ?? ''}::assets/products/${r.image_file ?? ''}`),
    )
    const actual = new Set(
      (
        await prisma.productImage.findMany({
          select: { url: true, product: { select: { slug: true, isActive: true } } },
        })
      )
        .filter((row) => row.product.isActive)
        .map((row) => `${row.product.slug}::${row.url}`),
    )

    expect(diff(actual, expected)).toEqual(NO_DRIFT)
  })

  it('HEALTH-GOAL LINKS are exactly the pipe-separated CSV values — instance 2, second half', async () => {
    const expected = new Set(
      readVerifiedProductRows().flatMap((r) =>
        (r.health_goals ?? '')
          .split('|')
          .map((g) => g.trim())
          .filter((g) => g.length > 0)
          .map((g) => `${r.slug ?? ''}::${g}`),
      ),
    )
    const actual = new Set(
      (
        await prisma.productHealthGoal.findMany({
          select: {
            product: { select: { slug: true, isActive: true } },
            healthGoal: { select: { nameHe: true } },
          },
        })
      )
        .filter((row) => row.product.isActive)
        .map((row) => `${row.product.slug}::${row.healthGoal.nameHe}`),
    )

    expect(diff(actual, expected)).toEqual(NO_DRIFT)
  })

  it('every ACTIVE product has exactly one image — no accumulation, no gap', async () => {
    const counts = await prisma.product.findMany({
      where: { isActive: true },
      select: { slug: true, _count: { select: { images: true } } },
    })
    const wrong = counts.filter((p) => p._count.images !== 1).map((p) => `${p.slug}=${p._count.images}`)
    expect(wrong).toEqual([])
  })

  it('🔴 the fixture itself is non-trivial — a catalogue of zero would satisfy every set above', async () => {
    // Without this, an empty database and an empty CSV agree perfectly and
    // every assertion in this file passes while proving nothing. Same trap as
    // the vacuous checks in .claude/rules/browser-verification.md.
    const verified = readVerifiedProductRows()
    expect(verified.length).toBeGreaterThan(24) // at least a second page's worth
    expect(await prisma.product.count({ where: { isActive: true } })).toBe(verified.length)
  })
})
