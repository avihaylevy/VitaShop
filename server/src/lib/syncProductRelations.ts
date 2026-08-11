import type { Prisma, PrismaClient } from '@prisma/client'

type Db = PrismaClient | Prisma.TransactionClient

export type SeedIngredient = {
  /**
   * The name written to `ActiveIngredient.name`.
   *
   * 🔴 The HEBREW name — ISSUE-049. DEC-017 pairs `_he`/`_en` columns for CORE
   * fields only (name, description, category, health goal) and puts everything
   * else on a single Hebrew column, so this column is Hebrew by decision, not
   * by accident. The caller picks the value; this module does not translate
   * and must never be given a composed one.
   */
  name: string
  amount: string
  unit: string
}

/**
 * 🔴 THE SHARED RULE FOR EVERY FUNCTION IN THIS FILE — each one reconciles a
 * product's relation to EXACTLY the set it is given, which means it must
 * DELETE what is no longer named, not only add what is new.
 *
 * ⚠️ AUDITED 2026-08-11 after ISSUE-049. Every per-product relation loop in
 * `prisma/seed.ts` had the identical add-only shape, and all of them were
 * unreachable for the identical reason: **nothing had ever been removed from a
 * product's CSV row.** Ingredients was found by accident when a rename made it
 * reachable; images and health goals were found by looking, before batch 5
 * made them reachable too.
 *
 *   ingredients   add-only -> FIXED 86c559a (found by accident, after it bit)
 *   images        add-only -> FIXED here    (latent: change a product's
 *                             image_file and it would keep BOTH rows, so
 *                             which one renders becomes ordering-dependent)
 *   health goals  add-only -> FIXED here    (latent: change health_goals and
 *                             the product stays attached to the old goal —
 *                             it would appear under a filter it no longer
 *                             claims)
 *
 * The taxonomy rows themselves — Category, Brand, HealthGoal, ActiveIngredient
 * — are deliberately NOT pruned. They are lookup-or-create, and an unreferenced
 * one is untidy rather than wrong: `catalogFacets.ts` filters every facet to
 * rows having at least one active product, so orphans never reach the UI.
 */

/**
 * Reconciles one product's ingredient links to EXACTLY the set it is given:
 * adds what is missing, updates amount/unit on what exists, and **removes what
 * is no longer named**.
 *
 * 🔴 EXTRACTED FROM `prisma/seed.ts` 2026-08-11 so the pruning could be tested.
 * `seed.ts` calls `assertLocalDevTarget()` and constructs a `PrismaClient` at
 * module scope, so importing it from a test executes those side effects. The
 * logic had to move to be reachable at all.
 *
 * ⚠️ THE BUG THIS EXISTS TO PREVENT — worth stating, because the old code
 * looked correct. The loop only ever ADDED and UPDATED. It never deleted a
 * link whose ingredient had dropped out of the CSV, so the seed converged only
 * while the data GREW. Nobody had renamed an ingredient before, so the gap was
 * unreachable — until ISSUE-049 changed the key from the English name to the
 * Hebrew one and every product kept its old English link AND gained a Hebrew
 * one. The catalogue filter showed 92 options in two languages where the source
 * data named 46.
 *
 * 🔴 A convergence property that holds only under monotonic growth is NOT
 * idempotency. This catalogue has grown monotonically since it existed, which
 * is exactly why nothing caught it — the same reason ISSUE-041's seed-coupled
 * assertions stayed green for so long. Two latent bugs, one cause.
 */
export async function syncProductIngredients(
  db: Db,
  productId: string,
  ingredients: readonly SeedIngredient[],
): Promise<void> {
  const linkedIngredientIds: string[] = []

  for (const ing of ingredients) {
    const activeIngredient = await db.activeIngredient.upsert({
      where: { name: ing.name },
      update: {},
      create: { name: ing.name },
    })

    const existingLink = await db.productIngredient.findFirst({
      where: { productId, activeIngredientId: activeIngredient.id },
    })
    if (existingLink) {
      await db.productIngredient.update({
        where: { id: existingLink.id },
        data: { amount: ing.amount, unit: ing.unit },
      })
    } else {
      await db.productIngredient.create({
        data: { productId, activeIngredientId: activeIngredient.id, amount: ing.amount, unit: ing.unit },
      })
    }

    linkedIngredientIds.push(activeIngredient.id)
  }

  // 🔴 The prune. Without this the function is add-only and the seed stops
  // converging the moment any ingredient is renamed or removed.
  await db.productIngredient.deleteMany({
    where: { productId, activeIngredientId: { notIn: linkedIngredientIds } },
  })
}


/**
 * Reconciles a product's images to exactly the given URLs.
 *
 * ⚠️ LATENT BUG WHEN WRITTEN — the seed created a `ProductImage` when none
 * matched the URL and never removed the previous one. Nothing had triggered it
 * because no seeded product had ever changed its `image_file`; batch 1 came
 * close, changing four rows from `.png` to `.webp`, but that happened before
 * those rows were first seeded. Verified against the live database at the time
 * of this fix: 27 images for 27 products, no duplicates.
 *
 * Left unfixed, changing `image_file` would leave the product holding TWO
 * image rows and make the rendered one depend on row ordering.
 */
export async function syncProductImages(db: Db, productId: string, urls: readonly string[]): Promise<void> {
  for (const [index, url] of urls.entries()) {
    const existing = await db.productImage.findFirst({ where: { productId, url } })
    if (existing) {
      await db.productImage.update({ where: { id: existing.id }, data: { sortOrder: index } })
    } else {
      await db.productImage.create({ data: { productId, url, sortOrder: index } })
    }
  }

  await db.productImage.deleteMany({ where: { productId, url: { notIn: [...urls] } } })
}

/**
 * Reconciles a product's health-goal links to exactly the given goal ids.
 *
 * ⚠️ LATENT BUG WHEN WRITTEN, and the one with a visible consequence: a
 * product whose `health_goals` value changed would stay linked to the old
 * goal, so it would keep appearing under a health-goal filter it no longer
 * claims. That is a wrong answer in the UI, not just an untidy row.
 */
export async function syncProductHealthGoals(
  db: Db,
  productId: string,
  healthGoalIds: readonly string[],
): Promise<void> {
  for (const healthGoalId of healthGoalIds) {
    const existing = await db.productHealthGoal.findFirst({ where: { productId, healthGoalId } })
    if (!existing) {
      await db.productHealthGoal.create({ data: { productId, healthGoalId } })
    }
  }

  await db.productHealthGoal.deleteMany({
    where: { productId, healthGoalId: { notIn: [...healthGoalIds] } },
  })
}
