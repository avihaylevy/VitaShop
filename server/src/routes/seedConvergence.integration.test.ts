import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  INGREDIENTS_CSV_PATH,
  parseCsvFile,
  readVerifiedProductRows,
} from '../lib/productsCsv.js'
import { isTestFixtureSlug } from '../lib/testFixturePrefix.js'
import { isUploadRef } from '../lib/uploadPaths.js'

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

/**
 * 🔴 `syncProductRelations.integration.test.ts` creates and deletes products
 * under this prefix. They are ANOTHER TEST'S FIXTURES, not catalogue drift,
 * and whether they are visible here is a matter of run ordering — so ignoring
 * them is correctness, not a weakened assertion. Verified against the database
 * before this filter was added: the only unexpected row was
 * `zz-synctest-product`, created by that suite.
 *
 * ⚠️ It is a NARROW, NAMED prefix on purpose. A broad "ignore anything
 * unexpected" filter would delete the whole point of a set-equality test.
 */
const isFixture = isTestFixtureSlug

/**
 * 🔴 DEC-089b MADE THE ADMIN A SECOND LEGITIMATE WRITER (ISSUE-154, the
 * user's call, hundred-sixth pass): products created through the admin
 * editor are REAL catalogue rows that the CSV never heard of — the user's
 * own vitamin-c-liposomal is one. They are excluded from the CSV-equality
 * sets by a NARROW, evidence-based discriminator, not a broad allowlist:
 * the seed only ever writes `assets/products/…` image links, so a non-CSV
 * row whose images exist and are ALL external http(s) URLs or upload refs
 * (isUploadRef — THE prefix check, one fact one place) can only have come
 * through the admin channel.
 *
 * ⚠️ TIGHTENED in the hundred-seventh-pass review:
 * · A ZERO-IMAGE non-CSV row is NOT excluded. `[].some()` is false, and the
 *   first draft therefore classified an imageless orphan — the classic
 *   partial-write drift this file exists to police — as admin work. The
 *   exclusion must be EARNED by positive evidence (an image only the admin
 *   channel writes). Trade-off, recorded: an admin-created product saved
 *   with no image will turn these sets red until it gets one.
 * · A non-CSV row with a seed-shaped assets/ link still reds — the family
 *   keeps its teeth (mutation-proved below, both directions).
 *
 * ⚠️ CREATION-ONLY SHIELD, deliberately. Admin EDITS of CSV-seeded rows
 * (dietary flags, deactivation, image swaps) are NOT shielded and will
 * red these sets — whether that is drift or a legal second writer is the
 * user's open decision (ISSUE-187); this file's own precondition ("assume
 * `prisma db seed` has been run against the current CSV") stands.
 *
 * Memoized: five tests, one scan.
 */
async function computeAdminCreatedSlugs(): Promise<Set<string>> {
  const csvSlugs = new Set(readVerifiedProductRows().map((r) => r.slug ?? ''))
  const rows = await prisma.product.findMany({
    select: { slug: true, images: { select: { url: true } } },
  })
  const admin = new Set<string>()
  for (const row of rows) {
    if (csvSlugs.has(row.slug) || isFixture(row.slug)) continue
    const adminShaped =
      row.images.length > 0 &&
      row.images.every((i) => /^https?:\/\//.test(i.url) || isUploadRef(i.url))
    if (adminShaped) admin.add(row.slug)
  }
  return admin
}

let adminSlugsPromise: Promise<Set<string>> | null = null
function adminCreatedSlugs(): Promise<Set<string>> {
  adminSlugsPromise ??= computeAdminCreatedSlugs()
  return adminSlugsPromise
}

/** Symmetric difference, reported both ways so a failure says WHICH side drifted. */
function diff(actual: Set<string>, expected: Set<string>) {
  return {
    inDatabaseButNotInCsv: [...actual].filter((v) => !expected.has(v)).sort(),
    inCsvButNotInDatabase: [...expected].filter((v) => !actual.has(v)).sort(),
  }
}

const NO_DRIFT = { inDatabaseButNotInCsv: [], inCsvButNotInDatabase: [] }

/**
 * DEC-076: the rows the CSV states are ON SALE — verified AND not
 * `is_active: no` (blank = yes). Every set below that compares against
 * ACTIVE database state must use this, or a legitimate stated deactivation
 * turns three unrelated assertions red.
 */
function readActiveStatedRows(): Record<string, string>[] {
  return readVerifiedProductRows().filter((r) => (r.is_active ?? '').trim() !== 'no')
}

describe('seed convergence — the database equals the CSV, in both directions', () => {
  it('ACTIVE PRODUCT SLUGS are exactly the verified rows the CSV STATES active — instance 3 + DEC-076', async () => {
    // DEC-076 / ISSUE-064: `is_active` is the CSV's say-so (blank = yes), so
    // a verified row marked `no` must be OFF sale — the seed no longer
    // resurrects a stated deactivation.
    const expected = new Set(readActiveStatedRows().map((r) => r.slug ?? ''))
    const admin = await adminCreatedSlugs()
    const actual = new Set(
      (await prisma.product.findMany({ where: { isActive: true }, select: { slug: true } }))
        .map((p) => p.slug)
        .filter((slug) => !admin.has(slug)),
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
      )
        .filter((row) => !isFixture(row.product.slug))
        .map((row) => `${row.product.slug}::${row.activeIngredient.name}`),
    )

    expect(diff(actual, expected)).toEqual(NO_DRIFT)
  })

  it('IMAGE LINKS are exactly one per verified row, and the CSV names the file — instance 2', async () => {
    // Active-stated rows only: the ACTUAL side filters product.isActive, so
    // the expectation must apply the same DEC-076 rule.
    const expected = new Set(
      readActiveStatedRows().map((r) => `${r.slug ?? ''}::assets/products/${r.image_file ?? ''}`),
    )
    const admin = await adminCreatedSlugs()
    const actual = new Set(
      (
        await prisma.productImage.findMany({
          select: { url: true, product: { select: { slug: true, isActive: true } } },
        })
      )
        .filter(
          (row) =>
            row.product.isActive && !isFixture(row.product.slug) && !admin.has(row.product.slug),
        )
        .map((row) => `${row.product.slug}::${row.url}`),
    )

    expect(diff(actual, expected)).toEqual(NO_DRIFT)
  })

  it('HEALTH-GOAL LINKS are exactly the pipe-separated CSV values — instance 2, second half', async () => {
    // Same DEC-076 scoping as the image set above.
    const admin = await adminCreatedSlugs()
    const expected = new Set(
      readActiveStatedRows().flatMap((r) =>
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
        .filter(
          (row) =>
            row.product.isActive && !isFixture(row.product.slug) && !admin.has(row.product.slug),
        )
        .map((row) => `${row.product.slug}::${row.healthGoal.nameHe}`),
    )

    expect(diff(actual, expected)).toEqual(NO_DRIFT)
  })

  it('every ACTIVE product has exactly one image — no accumulation, no gap', async () => {
    const counts = await prisma.product.findMany({
      where: { isActive: true },
      select: { slug: true, _count: { select: { images: true } } },
    })
    // Seed-owned rows only — an ADMIN row may carry zero images (the image
    // URL is optional in the editor) or an external one; the one-image rule
    // is the SEED's contract.
    const admin = await adminCreatedSlugs()
    const wrong = counts
      .filter((p) => !isFixture(p.slug) && !admin.has(p.slug) && p._count.images !== 1)
      .map((p) => `${p.slug}=${p._count.images}`)
    expect(wrong).toEqual([])
  })

  it('BRAND ROWS are exactly the CSV brands plus brands kept alive by product rows — instance 5, DEC-072', async () => {
    // ISSUE-078: DEC-032 moved a product between brands and the abandoned
    // בריאמיל row sat at 0 products forever — the family's fifth instance,
    // in a table the sets above never watched. The seed now RETIRES a brand
    // row when the CSV no longer references its name AND no product row
    // (active or soft-deleted) still points at it.
    const csvBrands = new Set(readVerifiedProductRows().map((r) => (r.brand ?? '').trim()))
    const brands = await prisma.brand.findMany({
      select: { name: true, _count: { select: { products: true } } },
    })

    // Direction 1 — nothing missing: every CSV brand exists.
    const missing = [...csvBrands].filter((name) => !brands.some((b) => b.name === name))
    expect(missing).toEqual([])

    // Direction 2 — no orphan: a brand row with ZERO product rows that the
    // CSV no longer names is exactly the drift this instance is about.
    const orphans = brands
      .filter((b) => b._count.products === 0 && !csvBrands.has(b.name))
      .map((b) => b.name)
    expect(orphans).toEqual([])
  })

  it('DIETARY FLAGS converge from the CSV tri-state — DEC-083, null means unknown', async () => {
    // Blank cell = null (unknown), yes = true, no = false. Compared per slug
    // and per column so a failure names the exact drifted claim. Retraction
    // is covered by the same equality: a value removed from the CSV must
    // read back as null after the next seed, not fossilize.
    const toTriState = (raw: string | undefined): boolean | null => {
      const v = (raw ?? '').trim()
      return v === '' ? null : v === 'yes'
    }
    const expected = new Map(
      readVerifiedProductRows().map((r) => [
        r.slug ?? '',
        {
          isKosher: toTriState(r.is_kosher),
          isGlutenFree: toTriState(r.is_gluten_free),
          isVegan: toTriState(r.is_vegan),
        },
      ]),
    )
    const rows = await prisma.product.findMany({
      select: { slug: true, isKosher: true, isGlutenFree: true, isVegan: true },
    })
    const drifted = rows
      .filter((p) => !isFixture(p.slug) && expected.has(p.slug))
      .filter((p) => {
        const want = expected.get(p.slug)!
        return (
          p.isKosher !== want.isKosher ||
          p.isGlutenFree !== want.isGlutenFree ||
          p.isVegan !== want.isVegan
        )
      })
      .map((p) => `${p.slug}: db(${p.isKosher},${p.isGlutenFree},${p.isVegan})`)
    expect(drifted).toEqual([])
    // 🔴 The non-vacuity control: the comparison must have visited real rows.
    expect(rows.filter((p) => !isFixture(p.slug) && expected.has(p.slug)).length).toBeGreaterThan(24)
  })

  it('🔴 the fixture itself is non-trivial — a catalogue of zero would satisfy every set above', async () => {
    // Without this, an empty database and an empty CSV agree perfectly and
    // every assertion in this file passes while proving nothing. Same trap as
    // the vacuous checks in .claude/rules/browser-verification.md.
    const stated = readActiveStatedRows()
    expect(stated.length).toBeGreaterThan(24) // at least a second page's worth
    const admin = await adminCreatedSlugs()
    const active = await prisma.product.findMany({ where: { isActive: true }, select: { slug: true } })
    // Seed-owned actives equal the CSV's stated actives; admin-channel rows
    // (DEC-089b) sit OUTSIDE the equality, not inside a padded count.
    expect(active.filter((p) => !isFixture(p.slug) && !admin.has(p.slug))).toHaveLength(stated.length)
  })
})

describe('🔴 the admin-channel discriminator — BOTH controls, mutation-proved live', () => {
  /*
   * The browser-verification rule: a screen needs something that MUST pass
   * and something that MUST fail — all-exclude and all-include are equally
   * broken and equally green-looking. Rows are created INACTIVE (invisible
   * to every storefront read and to this file's isActive-filtered sets),
   * probed through the UNmemoized compute, and removed in finally
   * (fixture-created, DEC-063).
   */
  it('excludes an admin-shaped row, keeps a seed-shaped orphan and an IMAGELESS orphan red-visible', async () => {
    const seeded = await prisma.product.findFirstOrThrow({
      where: { isActive: true },
      select: { categoryId: true, brandId: true },
    })
    const base = {
      categoryId: seeded.categoryId,
      brandId: seeded.brandId,
      nameHe: 'בדיקת מסנן',
      nameEn: 'Discriminator control',
      dosageForm: 'CAPSULE' as const,
      packageQuantity: 10,
      usageInstructions: 'בדיקה',
      price: '10.00',
      stockQuantity: 0,
      descriptionHe: 'בדיקה',
      descriptionEn: 'control',
      warningsAllergens: '',
      isActive: false,
    }
    const slugs = {
      admin: 'zx-discriminator-admin-shaped',
      drift: 'zx-discriminator-seed-shaped',
      bare: 'zx-discriminator-imageless',
    }
    try {
      await prisma.product.create({
        data: {
          ...base,
          slug: slugs.admin,
          images: { create: { url: 'https://example.test/x.webp', sortOrder: 0 } },
        },
      })
      await prisma.product.create({
        data: {
          ...base,
          slug: slugs.drift,
          images: { create: { url: 'assets/products/zx-drift.jpg', sortOrder: 0 } },
        },
      })
      await prisma.product.create({ data: { ...base, slug: slugs.bare } })

      const admin = await computeAdminCreatedSlugs()
      // MUST pass the exclusion: only the admin channel writes this shape.
      expect(admin.has(slugs.admin)).toBe(true)
      // MUST fail it: a seed-shaped asset link on a non-CSV slug is drift.
      expect(admin.has(slugs.drift)).toBe(false)
      // MUST fail it: an imageless orphan earned nothing (the first draft
      // excluded it — `[].some()` is false — and was caught in review).
      expect(admin.has(slugs.bare)).toBe(false)
    } finally {
      await prisma.productImage.deleteMany({
        where: { product: { slug: { in: Object.values(slugs) } } },
      })
      await prisma.product.deleteMany({ where: { slug: { in: Object.values(slugs) } } })
    }
  })
})
