import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { promoteGuestCart } from './promoteGuestCart.js'
import { CART_LINE_MAX } from './cartQuantity.js'
import { TEST_FIXTURE_SLUG_PREFIX } from './testFixturePrefix.js'

/**
 * MILESTONE-007 Checkpoint E — PROMOTE-GUEST-CART, against the real database.
 *
 * 🔴 THE FAILURE PATHS ARE THE POINT. A guest cart moving to a fresh account is
 * the least interesting case. What must hold: a ROLLBACK leaves the guest cart
 * untouched, a guest with no cart creates nothing, a merge re-clamps and leaves
 * ONE cart with no orphans, and an inactive product is not carried over.
 *
 * ⚠️ A red assertion means CHECK THE DATABASE FIRST. Three times in this
 * project the fixtures were stale or impossible and the database was right.
 */

let prisma: PrismaClient
const GUEST = 'zz-promote-guest'
const EMAIL = 'zz-promote-user@example.test'
const LOW_STOCK_3 = 'altman-probiotic-intense-30'

async function wipe() {
  const carts = await prisma.cart.findMany({
    where: { OR: [{ sessionId: GUEST }, { user: { email: EMAIL } }] },
    select: { id: true },
  })
  const ids = carts.map((c) => c.id)
  if (ids.length > 0) {
    await prisma.cartItem.deleteMany({ where: { cartId: { in: ids } } })
    await prisma.cart.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.user.deleteMany({ where: { email: EMAIL } })
}

async function makeUser(): Promise<string> {
  const user = await prisma.user.create({
    data: {
      firstName: 'promote',
      lastName: 'test',
      email: EMAIL,
      passwordHash: 'x',
      termsAcceptedAt: new Date(),
    },
    select: { id: true },
  })
  return user.id
}

async function productId(slug: string): Promise<string> {
  const product = await prisma.product.findFirst({ where: { slug }, select: { id: true } })
  if (!product) throw new Error(`fixture assumption failed: ${slug} is not seeded`)
  return product.id
}

async function makeGuestCart(lines: { productId: string; quantity: number }[]) {
  return prisma.cart.create({
    data: { sessionId: GUEST, items: { create: lines } },
    select: { id: true },
  })
}

beforeAll(async () => {
  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  })
})

beforeEach(wipe)

afterAll(async () => {
  await wipe()
  await prisma.$disconnect()
})

describe('promoteGuestCart — the paths that matter', () => {
  it('a guest with NO cart creates nothing', async () => {
    const userId = await makeUser()
    const before = await prisma.cart.count({ where: { userId } })

    const result = await prisma.$transaction((tx) => promoteGuestCart(tx, GUEST, userId))

    expect(result).toEqual({ promoted: false, merged: false, clampedSlugs: [] })
    // 🔴 No empty cart per registration: that is a row nobody asked for.
    expect(await prisma.cart.count({ where: { userId } })).toBe(before)
  })

  it('no guest session id at all is a no-op', async () => {
    const userId = await makeUser()
    for (const id of [null, undefined, '']) {
      expect(await prisma.$transaction((tx) => promoteGuestCart(tx, id, userId))).toEqual({
        promoted: false,
        merged: false,
        clampedSlugs: [],
      })
    }
  })

  it('promotes to a fresh account: ONE cart, owned by the user, no session id left', async () => {
    const userId = await makeUser()
    await makeGuestCart([{ productId: await productId(LOW_STOCK_3), quantity: 2 }])

    const result = await prisma.$transaction((tx) => promoteGuestCart(tx, GUEST, userId))

    expect(result.promoted).toBe(true)
    expect(result.merged).toBe(false)
    const carts = await prisma.cart.findMany({ where: { userId }, select: { sessionId: true } })
    expect(carts).toHaveLength(1)
    expect(carts[0]?.sessionId).toBeNull()
    expect(await prisma.cart.count({ where: { sessionId: GUEST } })).toBe(0)
  })

  it('🔴 MERGES into an existing account cart, and ONE cart survives with no orphans', async () => {
    const userId = await makeUser()
    const pid = await productId(LOW_STOCK_3)
    await prisma.cart.create({ data: { userId, items: { create: [{ productId: pid, quantity: 1 }] } } })
    await makeGuestCart([{ productId: pid, quantity: 1 }])

    const result = await prisma.$transaction((tx) => promoteGuestCart(tx, GUEST, userId))

    expect(result.merged).toBe(true)
    // DEC-055: one cart per identity, and the loser is deleted deliberately.
    expect(await prisma.cart.count({ where: { userId } })).toBe(1)
    expect(await prisma.cart.count({ where: { sessionId: GUEST } })).toBe(0)

    const items = await prisma.cartItem.findMany({ where: { cart: { userId } } })
    expect(items).toHaveLength(1)
    expect(items[0]?.quantity).toBe(2) // summed
    // No lines left behind by the deleted cart. (`cartId` is non-nullable, so
    // a true orphan is impossible by FK — what is checked is that the losing
    // cart's items were removed rather than left pointing at a deleted row.)
    expect(await prisma.cartItem.count({ where: { cart: { sessionId: GUEST } } })).toBe(0)
  })

  it('🔴 a merged line past min(cap, stock) is CLAMPED, and the outcome SAYS so', async () => {
    const userId = await makeUser()
    const pid = await productId(LOW_STOCK_3) // stock 3
    await prisma.cart.create({ data: { userId, items: { create: [{ productId: pid, quantity: 2 }] } } })
    await makeGuestCart([{ productId: pid, quantity: 3 }]) // would sum to 5

    const result = await prisma.$transaction((tx) => promoteGuestCart(tx, GUEST, userId))

    const items = await prisma.cartItem.findMany({ where: { cart: { userId } } })
    expect(items[0]?.quantity).toBe(3) // stock binds
    // Silently shrinking the quantity is the failure this reports on.
    expect(result.clampedSlugs).toContain(LOW_STOCK_3)
  })

  it('the cap binds on a merge too, not only stock', async () => {
    const userId = await makeUser()
    const wellStocked = await prisma.product.findFirst({
      where: { isActive: true, stockQuantity: { gt: CART_LINE_MAX } },
      select: { id: true, slug: true },
    })
    if (!wellStocked) throw new Error('fixture assumption failed: no product stocked above the cap')

    await prisma.cart.create({
      data: { userId, items: { create: [{ productId: wellStocked.id, quantity: 7 }] } },
    })
    await makeGuestCart([{ productId: wellStocked.id, quantity: 7 }])

    const result = await prisma.$transaction((tx) => promoteGuestCart(tx, GUEST, userId))

    const items = await prisma.cartItem.findMany({ where: { cart: { userId } } })
    expect(items[0]?.quantity).toBe(CART_LINE_MAX)
    expect(result.clampedSlugs).toContain(wellStocked.slug)
  })

  it('🔴 a product that went INACTIVE mid-flight is NOT carried over', async () => {
    // 🔴 ITS OWN FIXTURE PRODUCT, under the prefix seedConvergence ignores.
    // The first version deactivated a REAL seeded product, and vitest runs
    // files in parallel workers — a sibling cart suite adding that same
    // product inside the window got PRODUCT_NOT_FOUND and went red. Third
    // instance of ISSUE-065's family; the established fix is to stop sharing
    // the row rather than to serialise the files.
    const userId = await makeUser()
    const shape = await prisma.product.findFirst({
      where: { isActive: true },
      select: { categoryId: true, brandId: true },
    })
    if (!shape) throw new Error('fixture assumption failed: no product to copy shape from')

    const victim = await prisma.product.create({
      data: {
        slug: `${TEST_FIXTURE_SLUG_PREFIX}promote-inactive`,
        nameHe: 'בדיקה', nameEn: 'fixture', categoryId: shape.categoryId, brandId: shape.brandId,
        dosageForm: 'CAPSULE', packageQuantity: 1, usageInstructions: '', price: '1.00',
        stockQuantity: 5, descriptionHe: 'בדיקה', descriptionEn: 'fixture',
        warningsAllergens: '', isActive: false,
      },
      select: { id: true },
    })

    try {
      await prisma.cart.create({ data: { userId, items: { create: [] } } })
      await makeGuestCart([{ productId: victim.id, quantity: 1 }])

      await prisma.$transaction((tx) => promoteGuestCart(tx, GUEST, userId))

      // It cannot be ADDED through any other path either, so promoting it
      // would make registration the one way to acquire an inactive product.
      expect(await prisma.cartItem.count({ where: { cart: { userId } } })).toBe(0)
    } finally {
      await prisma.cartItem.deleteMany({ where: { productId: victim.id } })
      await prisma.product.delete({ where: { id: victim.id } })
    }
  })

  it('🔴 ROLLBACK leaves the guest cart UNTOUCHED and still reachable', async () => {
    const userId = await makeUser()
    const pid = await productId(LOW_STOCK_3)
    const guestCart = await makeGuestCart([{ productId: pid, quantity: 2 }])

    await expect(
      prisma.$transaction(async (tx) => {
        await promoteGuestCart(tx, GUEST, userId)
        // Whatever fails after promotion — a duplicate email, a token write —
        // must undo it. A promotion surviving a failed registration hands the
        // cart to an account that does not exist.
        throw new Error('simulated registration failure')
      }),
    ).rejects.toThrow('simulated registration failure')

    const stillGuest = await prisma.cart.findFirst({
      where: { id: guestCart.id },
      select: { sessionId: true, userId: true, items: { select: { quantity: true } } },
    })
    expect(stillGuest?.sessionId).toBe(GUEST)
    expect(stillGuest?.userId).toBeNull()
    expect(stillGuest?.items[0]?.quantity).toBe(2)
    expect(await prisma.cart.count({ where: { userId } })).toBe(0)
  })
})
