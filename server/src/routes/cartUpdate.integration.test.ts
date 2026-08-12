import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { addItem, deleteLine, getCart, updateLine } from '../lib/cartService.js'
import { CART_LINE_MAX } from '../lib/cartQuantity.js'

/**
 * MILESTONE-007 Checkpoint D — PATCH and DELETE.
 *
 * 🔴 IDEMPOTENCY IS THE POINT OF D, so these test what makes it FAIL: a repeat
 * delete, a no-op update, and the two cross-session cases. A test that updates
 * a line once and reads it back proves the least interesting thing.
 */

let prisma: PrismaClient
const OWNER = 'zz-carttest-d-owner'
const STRANGER = 'zz-carttest-d-stranger'
const LOW_STOCK_3 = 'altman-probiotic-intense-30'

async function wipe() {
  const carts = await prisma.cart.findMany({
    where: { sessionId: { in: [OWNER, STRANGER] } },
    select: { id: true },
  })
  const ids = carts.map((c) => c.id)
  if (ids.length > 0) {
    await prisma.cartItem.deleteMany({ where: { cartId: { in: ids } } })
    await prisma.cart.deleteMany({ where: { id: { in: ids } } })
  }
}

/** Puts one line in the owner's cart and returns its id. */
async function seedOwnerLine(quantity = 2): Promise<string> {
  await wipe()
  await addItem(prisma, { guestCartId: OWNER }, LOW_STOCK_3, quantity)
  const cart = await prisma.cartItem.findFirst({
    where: { cart: { sessionId: OWNER } },
    select: { id: true },
  })
  if (!cart) throw new Error('fixture assumption failed: the owner line was not created')
  return cart.id
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

describe('DELETE — idempotent', () => {
  it('removes the line', async () => {
    const lineId = await seedOwnerLine()
    const result = await deleteLine(prisma, { guestCartId: OWNER }, lineId)

    expect(result.ok && result.removed).toBe(true)
    expect(result.ok && result.cart.items).toEqual([])
  })

  it('🔴 deleting an ALREADY-GONE line SUCCEEDS and leaves the cart unchanged', async () => {
    const lineId = await seedOwnerLine()
    await deleteLine(prisma, { guestCartId: OWNER }, lineId)

    const second = await deleteLine(prisma, { guestCartId: OWNER }, lineId)
    // Not a 404: a retried DELETE is a success. `removed` carries the
    // difference so a caller that cares can still tell.
    expect(second.ok).toBe(true)
    expect(second.ok && second.removed).toBe(false)
    expect(second.ok && second.cart.items).toEqual([])
  })

  it('with NO SESSION it mints nothing and reports no removal', async () => {
    // Scoped, for the same reason as the sibling suite: a global count races
    // the other cart test files running in parallel workers.
    const where = { sessionId: { in: [OWNER, STRANGER] } }
    const before = await prisma.cart.count({ where })
    const result = await deleteLine(prisma, { userId: null, guestCartId: null }, 'any-id')

    expect(result.ok).toBe(false)
    expect(await prisma.cart.count({ where })).toBe(before)
  })
})

describe('PATCH — the clamp and the no-op', () => {
  it('sets a new quantity', async () => {
    const lineId = await seedOwnerLine(1)
    const result = await updateLine(prisma, { guestCartId: OWNER }, lineId, 2)

    expect(result.ok && result.quantity).toBe(2)
    expect(result.ok && result.unchanged).toBe(false)
  })

  it('🔴 setting the quantity it ALREADY HAS is a no-op, and the response SAYS so', async () => {
    const lineId = await seedOwnerLine(2)
    const result = await updateLine(prisma, { guestCartId: OWNER }, lineId, 2)

    expect(result.ok && result.quantity).toBe(2)
    // The alreadyAtMaximum precedent: a response that cannot be told apart
    // from a real change makes a client render a change that did not happen.
    expect(result.ok && result.unchanged).toBe(true)
  })

  it('🔴 quantity 0 REMOVES the line — §7 decided delete, not 400', async () => {
    const lineId = await seedOwnerLine(2)
    const result = await updateLine(prisma, { guestCartId: OWNER }, lineId, 0)

    expect(result.ok && result.removed).toBe(true)
    expect(result.ok && result.cart.items).toEqual([])
  })

  it('clamps ABOVE THE CAP and ABOVE STOCK, through the service', async () => {
    const lineId = await seedOwnerLine(1)

    const overStock = await updateLine(prisma, { guestCartId: OWNER }, lineId, 9)
    expect(overStock.ok && overStock.quantity).toBe(3) // stock 3 binds
    expect(overStock.ok && overStock.clampedByStock).toBe(true)

    const overCap = await updateLine(prisma, { guestCartId: OWNER }, lineId, CART_LINE_MAX + 5)
    expect(overCap.ok && overCap.quantity).toBe(3)
    expect(overCap.ok && overCap.clampedByCap).toBe(true)
  })

  it('rejects a bad quantity rather than coercing it', async () => {
    const lineId = await seedOwnerLine(1)
    for (const bad of ['2', -1, 1.5, undefined, null]) {
      expect(await updateLine(prisma, { guestCartId: OWNER }, lineId, bad)).toEqual({
        ok: false,
        reason: 'INVALID_QUANTITY',
      })
    }
  })
})

describe('🔴 the IDOR shape — a foreign line is INDISTINGUISHABLE from an absent one', () => {
  it('PATCH against another session line is LINE_NOT_FOUND, never a 403', async () => {
    const lineId = await seedOwnerLine(2)

    const result = await updateLine(prisma, { guestCartId: STRANGER }, lineId, 1)
    // 🔴 A 403 would CONFIRM the line exists. The reason must be identical to
    // the one a nonexistent id produces.
    expect(result).toEqual({ ok: false, reason: 'LINE_NOT_FOUND' })
    expect(await updateLine(prisma, { guestCartId: STRANGER }, 'no-such-line', 1)).toEqual(result)

    // And the owner's line is untouched.
    const owner = await getCart(prisma, { guestCartId: OWNER })
    expect(owner.items[0]?.quantity).toBe(2)
  })

  it('DELETE against another session line removes NOTHING', async () => {
    const lineId = await seedOwnerLine(2)

    const result = await deleteLine(prisma, { guestCartId: STRANGER }, lineId)
    expect(result.ok && result.removed).toBe(false)

    const owner = await getCart(prisma, { guestCartId: OWNER })
    expect(owner.items).toHaveLength(1)
  })
})
