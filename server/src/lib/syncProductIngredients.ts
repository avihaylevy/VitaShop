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
