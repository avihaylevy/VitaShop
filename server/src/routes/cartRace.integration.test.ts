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
 * 🔴 THESE TESTS ARE EXPECTED TO FAIL ON TODAY'S CODE. They are the evidence
 * for the schema decision, not a regression suite — see DECISIONS.md.
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

describe('🔴 the check-then-create race — reproduction, not regression', () => {
  it('concurrent adds must not create TWO CARTS for one session', async () => {
    await wipe()

    await Promise.all([
      addItem(prisma, { guestCartId: RACE_SESSION }, LOW_STOCK_3, 1),
      addItem(prisma, { guestCartId: RACE_SESSION }, LOW_STOCK_3, 1),
      addItem(prisma, { guestCartId: RACE_SESSION }, LOW_STOCK_3, 1),
    ])

    const carts = await prisma.cart.count({ where: { sessionId: RACE_SESSION } })
    // getCart uses findFirst, so a second cart is invisible and everything in
    // it silently vanishes from the shopper's view.
    expect(carts).toBe(1)
  })

  it('concurrent adds of ONE product must not create TWO LINES', async () => {
    await wipe()

    await Promise.all([
      addItem(prisma, { guestCartId: RACE_SESSION }, LOW_STOCK_3, 1),
      addItem(prisma, { guestCartId: RACE_SESSION }, LOW_STOCK_3, 1),
      addItem(prisma, { guestCartId: RACE_SESSION }, LOW_STOCK_3, 1),
    ])

    const lines = await prisma.cartItem.count({
      where: { cart: { sessionId: RACE_SESSION } },
    })
    expect(lines).toBe(1)
  })

  it('🔴 the losing racer item is SILENTLY LOST - the consequence that actually occurs', async () => {
    await wipe()

    await Promise.all(
      Array.from({ length: 5 }, () =>
        addItem(prisma, { guestCartId: RACE_SESSION }, LOW_STOCK_3, 3),
      ),
    )

    const carts = await prisma.cart.count({ where: { sessionId: RACE_SESSION } })
    const lines = await prisma.cartItem.count({ where: { cart: { sessionId: RACE_SESSION } } })
    const visible = await getCart(prisma, { guestCartId: RACE_SESSION })
    const visibleTotal = visible.items.reduce((sum, line) => sum + line.quantity, 0)

    // 🔴 MEASURED, 2026-08-12, and it CORRECTS the original finding:
    //   2 concurrent -> 1 cart,  1 line,  visible total 3
    //   3 concurrent -> 2 carts, 2 lines, visible total 3
    //   5 concurrent -> 3 carts, 3 lines, visible total 3
    //
    // The duplicate LINES live in DIFFERENT CARTS, not two lines in one cart.
    // So the predicted "cap becomes per-line, total 6 against stock 3" does
    // NOT occur: getCart's findFirst sees ONE cart, the total stays within
    // min(10, stock), and C2's cap is not visibly breached.
    //
    // What DOES occur is worse in a different way: every row in the losing
    // cart is INVISIBLE and unrecoverable. The shopper's item does not
    // over-count — it disappears, with no error.
    expect(lines).toBe(carts) // one line per cart, never two lines in one
    expect(visibleTotal).toBeLessThanOrEqual(3)
    expect(carts, 'more than one cart per session means items are being lost').toBe(1)
  })
})
