import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { addItem, getCart } from '../lib/cartService.js'
import { CART_LINE_MAX } from '../lib/cartQuantity.js'
import { TEST_FIXTURE_SLUG_PREFIX } from '../lib/testFixturePrefix.js'

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
  // 🔴 THE DISCONNECT IS IN A `finally` BECAUSE THE CLEANUP CAN THROW, and a
  // throw here took the disconnect with it, leaking the connection and leaving
  // the run to hang instead of failing readably. Same fix, same reason, in
  // `orderService.integration.test.ts`.
  try {
    await wipeTestCarts()
  } finally {
    await prisma.$disconnect()
  }
})

async function stockOf(slug: string): Promise<number> {
  const product = await prisma.product.findFirst({ where: { slug }, select: { stockQuantity: true } })
  if (!product) throw new Error(`fixture assumption failed: ${slug} is not in the database`)
  return product.stockQuantity
}

describe('getCart', () => {
  it('🔴 NO IDENTITY returns an empty cart and touches NOTHING', async () => {
    const where = { sessionId: { in: [GUEST_A, GUEST_B] } }
    const before = await prisma.cart.count({ where })
    const cart = await getCart(prisma, { userId: null, guestCartId: null })

    // 🔴 The WHOLE shape, deliberately — `toEqual` here is what catches a
    // field silently appearing in the DTO. It did exactly that when DEC-058
    // added `shipping`, which is why this assertion is worth its brittleness.
    expect(cart).toEqual({
      items: [],
      totalQuantity: 0,
      clubMember: false,
      subtotal: '0.00',
      hasBlockingLine: false,
      // No identity means no cart means nothing to ship: no charge, and no
      // free-shipping promise either.
      shipping: {
        basis: '0.00',
        cost: '0.00',
        isFree: false,
        threshold: '249.00',
        remainingForFree: '0.00',
        hasShippableLines: false,
        // Not a pickup order — there is no order at all. The flag means
        // "nothing is being delivered BECAUSE the shopper collects it", which
        // an absent cart is not.
        noDeliveryRequired: false,
      },
    })
    // Checkpoint B's whole point: a read must not mint anything. Scoped, so a
    // sibling suite's carts cannot move the number.
    expect(await prisma.cart.count({ where })).toBe(before)
  })

  it('an identity with no cart yet returns empty, and still creates nothing', async () => {
    // 🔴 SCOPED to this session's carts, not the global count. A global count
    // races the sibling cart suites, which create and delete carts in parallel
    // workers — the assertion would fail for a reason that has nothing to do
    // with what it is testing. Same class as ISSUE-065.
    const where = { sessionId: GUEST_A }
    const before = await prisma.cart.count({ where })
    expect((await getCart(prisma, { guestCartId: GUEST_A })).items).toEqual([])
    expect(await prisma.cart.count({ where })).toBe(before)
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
    // 🔴 ISSUE-065 FIX. This used to soft-delete a REAL seeded product, and
    // vitest runs files in parallel workers — `seedConvergence` could read
    // `isActive` inside that window and fail with 48 active against 49 CSV
    // rows. The database was verified clean (49 active, 0 inactive) before
    // either test was blamed: the `finally` worked, the read simply landed
    // mid-window.
    //
    // The victim is now a product this test CREATES under
    // TEST_FIXTURE_SLUG_PREFIX, which `seedConvergence` already filters out by
    // design — so the shared row is gone rather than the two files being
    // serialised, which would slow every future run to paper over one window.
    const anyProduct = await prisma.product.findFirst({
      where: { isActive: true },
      select: { categoryId: true, brandId: true },
    })
    if (!anyProduct) throw new Error('fixture assumption failed: no product to copy shape from')

    const victim = await prisma.product.create({
      data: {
        slug: `${TEST_FIXTURE_SLUG_PREFIX}cart-inactive`,
        nameHe: 'בדיקה', nameEn: 'fixture', categoryId: anyProduct.categoryId,
        brandId: anyProduct.brandId, dosageForm: 'CAPSULE', packageQuantity: 1,
        usageInstructions: '', price: '1.00', stockQuantity: 5,
        descriptionHe: 'בדיקה', descriptionEn: 'fixture', warningsAllergens: '',
        isActive: false,
      },
      select: { id: true, slug: true },
    })

    try {
      expect(await addItem(prisma, { guestCartId: GUEST_A }, victim.slug, 1)).toEqual({
        ok: false,
        reason: 'PRODUCT_NOT_FOUND',
      })
    } finally {
      await prisma.product.delete({ where: { id: victim.id } })
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

  /**
   * 🔴 DEC-059 ANSWER 3 — "unpurchasable" is ONE condition with TWO causes.
   *
   * ⚠️ THESE TESTS EXIST BECAUSE THEIR ABSENCE WAS INVISIBLE. `shippable` and
   * `hasBlockingLine` tested only `isActive` until 2026-08-13, and changing
   * them to also test stock broke NOTHING in a 582-test suite — which is how a
   * defect this size survives: not because a test failed, but because none
   * existed. ISSUE-076.
   */
  describe('a line short of stock is unpurchasable, exactly as a withdrawn one is', () => {
    /**
     * ⚠️ ITS OWN PRODUCT, NOT A SEEDED ONE. The first version of these tests
     * dropped `altman-probiotic-intense-30` to stock 0 and restored it in a
     * `finally` — which this very file already learned not to do (see the
     * fixture note above): kill the run inside that window and the seeded
     * catalogue is left at 0, breaking unrelated suites and tripping
     * `check-catalogue-facts.py` against a REAL product.
     */
    async function ownProduct(stockQuantity: number): Promise<string> {
      const shape = await prisma.product.findFirst({
        where: { isActive: true },
        select: { categoryId: true, brandId: true },
      })
      if (!shape) throw new Error('fixture assumption failed: no product to copy shape from')
      const slug = `${TEST_FIXTURE_SLUG_PREFIX}cart-shortstock`
      await prisma.product.upsert({
        where: { slug },
        create: {
          slug, nameHe: 'בדיקה', nameEn: 'fixture', categoryId: shape.categoryId,
          brandId: shape.brandId, dosageForm: 'CAPSULE', packageQuantity: 1,
          usageInstructions: '', price: '100.00', stockQuantity,
          descriptionHe: 'בדיקה', descriptionEn: 'fixture', warningsAllergens: '',
          isActive: true,
        },
        update: { stockQuantity, isActive: true, price: '100.00' },
        select: { id: true },
      })
      return slug
    }

    it('SOLD OUT entirely — no basis, and checkout is blocked', async () => {
      await wipeTestCarts()
      const slug = await ownProduct(5)
      try {
        await addItem(prisma, { guestCartId: GUEST_A }, slug, 1)
        const before = await getCart(prisma, { guestCartId: GUEST_A })
        expect(before.hasBlockingLine).toBe(false)
        expect(before.shipping.basis).toBe('100.00')

        // It sells out AFTER being added — the sequence ISSUE-076 names, and
        // one a shopper cannot see coming.
        await prisma.product.update({ where: { slug }, data: { stockQuantity: 0 } })
        const after = await getCart(prisma, { guestCartId: GUEST_A })

        // 🔴 The line still SHOWS — C3: the cart must not lie about what was
        // put in it...
        expect(after.items).toHaveLength(1)

        // ...and as of Checkpoint F1 it COUNTS FOR NOTHING, which is DEC-059
        // answer 3. This assertion previously read `toBe(before.subtotal)`,
        // i.e. ₪100 of sold-out product still in the total; the decision says
        // the subtotal and the basis are one number.
        expect(before.subtotal).toBe('100.00')
        expect(after.subtotal).toBe('0.00')

        // ...and it buys nothing.
        expect(after.shipping.basis).toBe('0.00')
        expect(after.shipping.hasShippableLines).toBe(false)
        expect(after.hasBlockingLine).toBe(true)
      } finally {
        await prisma.cartItem.deleteMany({ where: { product: { slug } } })
        await prisma.product.deleteMany({ where: { slug } })
      }
    })

    it('🔴 SHORT of the quantity asked for — the case `> 0` missed', async () => {
      // The cart rule must be the rule CHECKOUT enforces, `stock >= quantity`,
      // not merely `stock > 0`. With `> 0` this cart of 3 against a stock of 1
      // still promised free shipping on ₪300 and still passed the block check,
      // and checkout still refused it with INSUFFICIENT_STOCK. The shopper then
      // cut the line to 1 and shipping jumped ₪0 -> ₪30 — the same reversal,
      // reached by a different route.
      await wipeTestCarts()
      const slug = await ownProduct(10)
      try {
        await addItem(prisma, { guestCartId: GUEST_A }, slug, 3)
        expect((await getCart(prisma, { guestCartId: GUEST_A })).shipping.basis).toBe('300.00')

        await prisma.product.update({ where: { slug }, data: { stockQuantity: 1 } })
        const after = await getCart(prisma, { guestCartId: GUEST_A })

        expect(after.items[0]?.stockQuantity).toBe(1)
        // 🔴 Not purchasable: 1 in stock cannot satisfy a line of 3 — so as of
        // Checkpoint F1 it leaves the subtotal too, not only the basis. This
        // read `'300.00'` before DEC-059 answer 3 was applied to the DTO.
        expect(after.subtotal).toBe('0.00')
        expect(after.shipping.basis).toBe('0.00')
        expect(after.hasBlockingLine).toBe(true)
      } finally {
        await prisma.cartItem.deleteMany({ where: { product: { slug } } })
        await prisma.product.deleteMany({ where: { slug } })
      }
    })

    /**
     * 🔴 THE CONTROL THE TWO TESTS ABOVE CANNOT BE. Both hold ONE line, so
     * their `subtotal === '0.00'` is equally consistent with "excludes the
     * unpurchasable line" and with "returns zero whenever anything is wrong".
     * A mixed cart is the only shape that tells those two apart, and this
     * milestone has already shipped six assertions that passed while
     * distinguishing nothing.
     */
    it('a MIXED cart counts the purchasable line and ONLY that one', async () => {
      await wipeTestCarts()
      const goodSlug = await ownProduct(10)
      const badSlug = `${TEST_FIXTURE_SLUG_PREFIX}cart-mixed-blocked`
      const shape = await prisma.product.findFirst({
        where: { isActive: true },
        select: { categoryId: true, brandId: true },
      })
      if (!shape) throw new Error('fixture assumption failed: no product to copy shape from')
      await prisma.product.upsert({
        where: { slug: badSlug },
        create: {
          slug: badSlug, nameHe: 'בדיקה', nameEn: 'fixture', categoryId: shape.categoryId,
          brandId: shape.brandId, dosageForm: 'CAPSULE', packageQuantity: 1,
          usageInstructions: '', price: '70.00', stockQuantity: 5,
          descriptionHe: 'בדיקה', descriptionEn: 'fixture', warningsAllergens: '',
          isActive: true,
        },
        update: { stockQuantity: 5, isActive: true, price: '70.00' },
        select: { id: true },
      })

      try {
        await addItem(prisma, { guestCartId: GUEST_A }, goodSlug, 2) // 2 x ₪100
        await addItem(prisma, { guestCartId: GUEST_A }, badSlug, 1) // 1 x ₪70

        const before = await getCart(prisma, { guestCartId: GUEST_A })
        expect(before.subtotal).toBe('270.00')
        expect(before.hasBlockingLine).toBe(false)

        // Only the ₪70 line is withdrawn. The ₪200 line is untouched.
        await prisma.product.update({ where: { slug: badSlug }, data: { isActive: false } })
        const after = await getCart(prisma, { guestCartId: GUEST_A })

        expect(after.items).toHaveLength(2)
        // 🔴 200, not 270 and not 0 — the number no "zero on any problem" bug
        // and no "unchanged total" bug can produce.
        expect(after.subtotal).toBe('200.00')
        // DEC-059's "one number": the subtotal IS the basis now.
        expect(after.subtotal).toBe(after.shipping.basis)
        expect(after.hasBlockingLine).toBe(true)
      } finally {
        await prisma.cartItem.deleteMany({ where: { product: { slug: { in: [goodSlug, badSlug] } } } })
        await prisma.product.deleteMany({ where: { slug: { in: [goodSlug, badSlug] } } })
      }
    })
  })
})
