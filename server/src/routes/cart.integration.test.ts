import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { addItem, getCart } from '../lib/cartService.js'
import { CART_LINE_MAX } from '../lib/cartQuantity.js'

/**
 * MILESTONE-007 Checkpoint C — the cart service against the REAL database.
 *
 * 🔴 THE FAILURE PATHS ARE THE POINT. A test that adds one unit of an in-stock
 * product proves the least interesting thing. What must hold: two sessions
 * never see each other's cart (the IDOR shape), a soft-deleted product cannot
 * be added, the clamp binds through the SERVICE and not only in the pure
 * function, and no price is ever stored on a line.
 *
 * ⚠️ A red assertion here means CHECK THE DATABASE FIRST. Twice in this project
 * the fixtures were stale and the database was right.
 */

let prisma: PrismaClient
const GUEST_A = 'zz-carttest-session-a'
const GUEST_B = 'zz-carttest-session-b'

/** Seeded deliberately (DEC-032): stock 3 and stock 0. */
const LOW_STOCK_3 = 'altman-probiotic-intense-30'
const OUT_OF_STOCK = 'altman-fenugreek-chromium-90'

async function wipeTestCarts() {
  const carts = await prisma.cart.findMany({
    where: { sessionId: { in: [GUEST_A, GUEST_B] } },
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
  await wipeTestCarts()
})

afterAll(async () => {
  await wipeTestCarts()
  await prisma.$disconnect()
})

async function stockOf(slug: string): Promise<number> {
  const product = await prisma.product.findFirst({ where: { slug }, select: { stockQuantity: true } })
  if (!product) throw new Error(`fixture assumption failed: ${slug} is not in the database`)
  return product.stockQuantity
}

describe('getCart', () => {
  it('🔴 NO IDENTITY returns an empty cart and touches NOTHING', async () => {
    const before = await prisma.cart.count()
    const cart = await getCart(prisma, { userId: null, guestCartId: null })

    expect(cart).toEqual({ items: [], totalQuantity: 0, subtotal: '0.00', hasBlockingLine: false })
    // Checkpoint B's whole point: a read must not mint anything.
    expect(await prisma.cart.count()).toBe(before)
  })

  it('an identity with no cart yet returns empty, and still creates nothing', async () => {
    const before = await prisma.cart.count()
    expect((await getCart(prisma, { guestCartId: GUEST_A })).items).toEqual([])
    expect(await prisma.cart.count()).toBe(before)
  })
})

describe('addItem — the failure paths', () => {
  it('a slug that does not exist is PRODUCT_NOT_FOUND', async () => {
    const result = await addItem(prisma, { guestCartId: GUEST_A }, 'no-such-product', 1)
    expect(result).toEqual({ ok: false, reason: 'PRODUCT_NOT_FOUND' })
  })

  it('🔴 a SOFT-DELETED product is PRODUCT_NOT_FOUND — identical to absent, per M-005', async () => {
    // 🔴 THIS TEST CREATES ITS OWN FIXTURE, and the database is why. Since
    // `7baac10` taught the seed to REACTIVATE any row that returns to the
    // verified set, all 49 products are active and NO soft-deleted row exists.
    // The database was checked before this test was written: the fixture
    // assumption was impossible, not stale. Skipping instead would have
    // dropped INV-03 coverage at the moment the seed stopped leaving
    // casualties behind — the same trap the soft-delete search probe hit.
    const victim = await prisma.product.findFirst({
      where: { isActive: true },
      select: { id: true, slug: true },
    })
    if (!victim) throw new Error('fixture assumption failed: no active product to soft-delete')

    await prisma.product.update({ where: { id: victim.id }, data: { isActive: false } })
    try {
      expect(await addItem(prisma, { guestCartId: GUEST_A }, victim.slug, 1)).toEqual({
        ok: false,
        reason: 'PRODUCT_NOT_FOUND',
      })
    } finally {
      // Restored even when the assertion throws, or the next run fails on the
      // 49-product convergence assertions with no pointer to the cause.
      await prisma.product.update({ where: { id: victim.id }, data: { isActive: true } })
    }
  })

  it('an OUT-OF-STOCK product is rejected, not added at 0', async () => {
    expect(await stockOf(OUT_OF_STOCK)).toBe(0)
    expect(await addItem(prisma, { guestCartId: GUEST_A }, OUT_OF_STOCK, 1)).toEqual({
      ok: false,
      reason: 'OUT_OF_STOCK',
    })
  })

  it('a bad quantity is rejected THROUGH THE SERVICE, not coerced', async () => {
    for (const bad of ['3', 0, -1, 1.5, undefined, null]) {
      expect(await addItem(prisma, { guestCartId: GUEST_A }, LOW_STOCK_3, bad)).toEqual({
        ok: false,
        reason: 'INVALID_QUANTITY',
      })
    }
  })
})

describe('addItem — the clamp binds through the SERVICE, not only in the pure function', () => {
  it('🔴 STOCK binds: asking for 5 of a 3-stock product yields 3', async () => {
    await wipeTestCarts()
    expect(await stockOf(LOW_STOCK_3)).toBe(3)

    const result = await addItem(prisma, { guestCartId: GUEST_A }, LOW_STOCK_3, 5)
    expect(result.ok && result.quantity).toBe(3)
    expect(result.ok && result.clampedByStock).toBe(true)
  })

  it('🔴 THE CAP binds: asking for 11 of a well-stocked product yields 10', async () => {
    await wipeTestCarts()
    const wellStocked = await prisma.product.findFirst({
      where: { isActive: true, stockQuantity: { gt: CART_LINE_MAX } },
      select: { slug: true },
    })
    if (!wellStocked) throw new Error('fixture assumption failed: no product stocked above the cap')

    const result = await addItem(prisma, { guestCartId: GUEST_A }, wellStocked.slug, CART_LINE_MAX + 1)
    expect(result.ok && result.quantity).toBe(CART_LINE_MAX)
    expect(result.ok && result.clampedByCap).toBe(true)
  })

  it('🔴 adding twice SUMS and the SUM clamps — a per-request cap is not a cap', async () => {
    await wipeTestCarts()
    await addItem(prisma, { guestCartId: GUEST_A }, LOW_STOCK_3, 2)
    const second = await addItem(prisma, { guestCartId: GUEST_A }, LOW_STOCK_3, 2)

    expect(second.ok && second.quantity).toBe(3)
    const cart = await getCart(prisma, { guestCartId: GUEST_A })
    expect(cart.items).toHaveLength(1)
    expect(cart.items[0]?.quantity).toBe(3)
  })

  it('🔴 correction 2 — a NO-OP add reports alreadyAtMaximum, not a plain success', async () => {
    await wipeTestCarts()
    await addItem(prisma, { guestCartId: GUEST_A }, LOW_STOCK_3, 3)
    const noop = await addItem(prisma, { guestCartId: GUEST_A }, LOW_STOCK_3, 1)

    expect(noop.ok && noop.quantity).toBe(3)
    // Without this flag the response is indistinguishable from a real add, and
    // a shopper tapping three times with no visible change concludes the site
    // is broken.
    expect(noop.ok && noop.alreadyAtMaximum).toBe(true)
  })
})

describe('🔴 session isolation — the IDOR shape, and the cart is where it starts', () => {
  it('two guest sessions never see the other cart', async () => {
    await wipeTestCarts()
    await addItem(prisma, { guestCartId: GUEST_A }, LOW_STOCK_3, 1)

    const cartB = await getCart(prisma, { guestCartId: GUEST_B })
    expect(cartB.items).toEqual([])
    expect(cartB.totalQuantity).toBe(0)

    const cartA = await getCart(prisma, { guestCartId: GUEST_A })
    expect(cartA.items).toHaveLength(1)
  })
})

describe('🔴 the cart stores no price — INV-02 belongs to checkout', () => {
  it('CartItem carries quantity only; unitPrice is read LIVE from the product', async () => {
    await wipeTestCarts()
    await addItem(prisma, { guestCartId: GUEST_A }, LOW_STOCK_3, 1)

    const row = await prisma.cartItem.findFirst({ where: { cart: { sessionId: GUEST_A } } })
    // If a price column is ever added to a cart line, this fails — the
    // invariant becomes enforced rather than merely documented.
    expect(row && Object.keys(row).sort()).toEqual(['cartId', 'id', 'productId', 'quantity'])

    const product = await prisma.product.findFirst({
      where: { slug: LOW_STOCK_3 },
      select: { price: true },
    })
    const cart = await getCart(prisma, { guestCartId: GUEST_A })
    expect(cart.items[0]?.unitPrice).toBe(product?.price.toFixed(2))
  })

  it('exposes isActive and stockQuantity so C4 can render a blocked line', async () => {
    await wipeTestCarts()
    await addItem(prisma, { guestCartId: GUEST_A }, LOW_STOCK_3, 1)
    const cart = await getCart(prisma, { guestCartId: GUEST_A })

    expect(cart.items[0]?.isActive).toBe(true)
    expect(cart.items[0]?.stockQuantity).toBe(3)
    expect(cart.hasBlockingLine).toBe(false)
  })
})
