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

    expect(result).toEqual({ promoted: false, merged: false, clampedSlugs: [], dropped: [] })
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
        dropped: [],
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

  // 🔴 THE PAIR THAT STOPS THE TWO PATHS RE-DIVERGING. The same inactive
  // product used to be KEPT when the account had no cart (wholesale reassign)
  // and DROPPED when it did (the merge loop) — one rule, two paths, only one
  // correct. Both branches are now asserted.
  for (const withAccountCart of [false, true]) {
    it(`🔴 an INACTIVE product is dropped AND NAMED — account cart present: ${withAccountCart}`, async () => {
      const userId = await makeUser()
      const shape = await prisma.product.findFirst({
        where: { isActive: true },
        select: { categoryId: true, brandId: true },
      })
      if (!shape) throw new Error('fixture assumption failed: no product to copy shape from')

      const victim = await prisma.product.create({
        data: {
          slug: `${TEST_FIXTURE_SLUG_PREFIX}promote-inactive-${withAccountCart}`,
          nameHe: 'בדיקה', nameEn: 'fixture', categoryId: shape.categoryId, brandId: shape.brandId,
          dosageForm: 'CAPSULE', packageQuantity: 1, usageInstructions: '', price: '1.00',
          stockQuantity: 5, descriptionHe: 'בדיקה', descriptionEn: 'fixture',
          warningsAllergens: '', isActive: false,
        },
        select: { id: true, slug: true },
      })

      try {
        if (withAccountCart) {
          await prisma.cart.create({ data: { userId, items: { create: [] } } })
        }
        await makeGuestCart([{ productId: victim.id, quantity: 1 }])

        const result = await prisma.$transaction((tx) => promoteGuestCart(tx, GUEST, userId))

        expect(await prisma.cartItem.count({ where: { cart: { userId } } })).toBe(0)
        // 🔴 NAMED, not silent. Removal is a larger change than a clamp, and it
        // used to be reported nowhere at all. ISSUE-073: BOTH display names
        // ride along — a dropped line is in no cart, so without them the
        // client could only show the slug.
        expect(result.dropped).toEqual([
          { slug: victim.slug, nameHe: 'בדיקה', nameEn: 'fixture', reason: 'INACTIVE' },
        ])
      } finally {
        await prisma.cartItem.deleteMany({ where: { productId: victim.id } })
        await prisma.product.delete({ where: { id: victim.id } })
      }
    })
  }

  it('🔴 an OUT-OF-STOCK line is dropped and named UNAVAILABLE, not INACTIVE', async () => {
    // The two reasons read differently to a shopper: "we no longer sell it" is
    // not "it is out of stock".
    const userId = await makeUser()
    const pid = await productId('altman-fenugreek-chromium-90') // seeded at stock 0
    await makeGuestCart([{ productId: pid, quantity: 1 }])

    const result = await prisma.$transaction((tx) => promoteGuestCart(tx, GUEST, userId))

    // ISSUE-073: names asserted against the DATABASE row, not retyped here —
    // the seeded Hebrew name changing must not break a test about DROP reasons.
    const row = await prisma.product.findUniqueOrThrow({
      where: { slug: 'altman-fenugreek-chromium-90' },
      select: { nameHe: true, nameEn: true },
    })
    expect(result.dropped).toEqual([
      { slug: 'altman-fenugreek-chromium-90', nameHe: row.nameHe, nameEn: row.nameEn, reason: 'UNAVAILABLE' },
    ])
    expect(await prisma.cartItem.count({ where: { cart: { userId } } })).toBe(0)
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

describe('🔴 registration and login differ ON PURPOSE when the merge fails', () => {
  it('at REGISTRATION a throw rolls the whole thing back — no half-made account', async () => {
    // The merge runs INSIDE registerUser's transaction. A throw must undo the
    // user row too: no account exists yet, so there is nothing to lock anyone
    // out of, and a half-made account is worse than no account.
    //
    // ⚠️ AT LOGIN the opposite is correct and is implemented that way: the
    // credentials have already passed, so a cart failure must NOT deny access.
    // It is caught, logged, and reported as `cart.mergeFailed`. See §7 and
    // auth.login.test.ts. The two are different DELIBERATELY.
    const userId = await makeUser()
    const pid = await productId(LOW_STOCK_3)
    const guestCart = await makeGuestCart([{ productId: pid, quantity: 2 }])

    await expect(
      prisma.$transaction(async (tx) => {
        await promoteGuestCart(tx, GUEST, userId)
        throw new Error('simulated failure after the merge')
      }),
    ).rejects.toThrow('simulated failure after the merge')

    // The guest cart survives, untouched and still reachable.
    const survivor = await prisma.cart.findFirst({
      where: { id: guestCart.id },
      select: { sessionId: true, userId: true },
    })
    expect(survivor?.sessionId).toBe(GUEST)
    expect(survivor?.userId).toBeNull()
    expect(await prisma.cart.count({ where: { userId } })).toBe(0)
  })
})
