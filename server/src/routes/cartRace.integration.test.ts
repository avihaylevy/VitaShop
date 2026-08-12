import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { addItem, getCart } from '../lib/cartService.js'

/**
 * 🔴 REPRODUCTION of the cart's check-then-create race. This file exists to
 * make the defect OBSERVABLE before a fix is proposed — a race nobody has seen
 * is a race nobody can confirm was fixed.
 *
 * `cartService.addItem` does findFirst-then-create TWICE, with no transaction,
 * and the schema backs neither write with a unique constraint:
 * `Cart` has `@@index([userId])` / `@@index([sessionId])` — INDEXES, not
 * `@unique` — and `CartItem` has no `@@unique([cartId, productId])`.
 *
 * ⚠️ SECOND OCCURRENCE OF THIS SHAPE HERE. MILESTONE-006 Checkpoint D had a
 * check-then-create race that surfaced as a 500 and reopened clause 4b's
 * oracle. Same class, different table — and this one fails SILENTLY, which is
 * worse: nothing throws, the item simply disappears or the cap stops binding.
 *
 * ✅ CONVERTED TO A REGRESSION SUITE 2026-08-12, once DEC-055 landed. These
 * tests were committed FAILING as evidence for that decision; they now guard
 * the fix. 🔴 The concurrency levels are UNCHANGED — 2, 3 and 5, exactly what
 * measured the defect. Lowering them to make the suite pass would have been
 * the vacuous shape this project keeps recording.
 */

let prisma: PrismaClient
const RACE_SESSION = 'zz-carttest-race-session'
const LOW_STOCK_3 = 'altman-probiotic-intense-30'

async function wipe() {
  const carts = await prisma.cart.findMany({
    where: { sessionId: RACE_SESSION },
    select: { id: true },
  })
  const ids = carts.map((c) => c.id)
  if (ids.length > 0) {
    await prisma.cartItem.deleteMany({ where: { cartId: { in: ids } } })
    await prisma.cart.deleteMany({ where: { id: { in: ids } } })
  }
}

beforeAll(async () => {
  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  })
  await wipe()
})

afterAll(async () => {
  await wipe()
  await prisma.$disconnect()
})

describe('DEC-055 — the check-then-create race stays fixed', () => {
  for (const concurrency of [2, 3, 5]) {
    it(`${concurrency} concurrent adds: ONE cart, ONE line, total within min(cap, stock)`, async () => {
      await wipe()
      const product = await prisma.product.findFirst({
        where: { slug: LOW_STOCK_3 },
        select: { stockQuantity: true },
      })
      if (!product) throw new Error('fixture assumption failed: the low-stock product is missing')

      await Promise.all(
        Array.from({ length: concurrency }, () =>
          addItem(prisma, { guestCartId: RACE_SESSION }, LOW_STOCK_3, 3),
        ),
      )

      const carts = await prisma.cart.count({ where: { sessionId: RACE_SESSION } })
      const lines = await prisma.cartItem.count({ where: { cart: { sessionId: RACE_SESSION } } })
      const visible = await getCart(prisma, { guestCartId: RACE_SESSION })
      const total = visible.items.reduce((sum, line) => sum + line.quantity, 0)

      // Measured BEFORE the fix: 3 concurrent -> 2 carts, 5 -> 3 carts, with
      // every row in the losing carts invisible and unrecoverable.
      expect(carts, 'more than one cart per session means items are being lost').toBe(1)
      expect(lines).toBe(1)
      expect(total).toBeLessThanOrEqual(product.stockQuantity)
      expect(total).toBeGreaterThan(0)
    })
  }

  it('🔴 the P2002 handler is actually EXERCISED — not dead code behind a lucky upsert', async () => {
    // ⚠️ Prisma's upsert compiles to INSERT ... ON CONFLICT only for simple
    // shapes and otherwise falls back to find-then-write, so the upsert is not
    // the guarantee. This asserts the losing racer is RECOVERED rather than
    // throwing: no rejection escapes, and the end state is still one cart.
    await wipe()
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        addItem(prisma, { guestCartId: RACE_SESSION }, LOW_STOCK_3, 1),
      ),
    )

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true)
    expect(await prisma.cart.count({ where: { sessionId: RACE_SESSION } })).toBe(1)
  })
})
