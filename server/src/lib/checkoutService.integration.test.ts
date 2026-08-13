import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { quoteCheckout } from './checkoutService.js'
import { createOrder } from './orderService.js'
import { checkoutFingerprint } from './checkoutFingerprint.js'
import { TEST_FIXTURE_SLUG_PREFIX } from './testFixturePrefix.js'

/**
 * MILESTONE-008 Checkpoint D1 — the checkout quote, against a real database.
 *
 * 🔴 THIS SUITE'S OWN FIXTURES, like `orderService.integration.test.ts`.
 * Nothing touches a seeded product; the slugs carry TEST_FIXTURE_SLUG_PREFIX so
 * `seedConvergence` and `check-catalogue-facts.py` ignore them by the rule they
 * already use.
 *
 * ⚠️ DEC-057 — `.integration.test.ts` because it constructs a PrismaClient, so
 * it runs single-threaded. `dbTestNaming.test.ts` enforces the name.
 */

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
})

const SLUG_A = `${TEST_FIXTURE_SLUG_PREFIX}checkout-a`
const SLUG_B = `${TEST_FIXTURE_SLUG_PREFIX}checkout-b`
const EMAIL = 'zz-checkouttest-1@example.test'

let categoryId = ''
let brandId = ''
let userId = ''

async function wipe(): Promise<void> {
  const orders = await prisma.order.findMany({
    where: { user: { email: EMAIL } },
    select: { id: true },
  })
  if (orders.length > 0) {
    const ids = orders.map((o) => o.id)
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: ids } } })
    await prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } })
    await prisma.order.deleteMany({ where: { id: { in: ids } } })
  }
  const carts = await prisma.cart.findMany({
    where: { user: { email: EMAIL } },
    select: { id: true },
  })
  if (carts.length > 0) {
    const ids = carts.map((c) => c.id)
    await prisma.cartItem.deleteMany({ where: { cartId: { in: ids } } })
    await prisma.cart.deleteMany({ where: { id: { in: ids } } })
  }
}

async function setStock(slug: string, stockQuantity: number): Promise<void> {
  await prisma.product.update({ where: { slug }, data: { stockQuantity } })
}

async function setActive(slug: string, isActive: boolean): Promise<void> {
  await prisma.product.update({ where: { slug }, data: { isActive } })
}

/** Puts `quantity` of `slug` in the shopper's cart. Returns the cart id. */
async function cartWith(slug: string, quantity: number): Promise<string> {
  const product = await prisma.product.findUniqueOrThrow({ where: { slug }, select: { id: true } })
  const cart = await prisma.cart.upsert({
    where: { userId },
    create: { userId },
    update: {},
    select: { id: true },
  })
  await prisma.cartItem.upsert({
    where: { cartId_productId: { cartId: cart.id, productId: product.id } },
    create: { cartId: cart.id, productId: product.id, quantity },
    update: { quantity },
    select: { id: true },
  })
  return cart.id
}

beforeAll(async () => {
  const seeded = await prisma.product.findFirstOrThrow({
    where: { isActive: true },
    select: { categoryId: true, brandId: true },
  })
  categoryId = seeded.categoryId
  brandId = seeded.brandId

  // 🔴 ₪24.50 IS CHOSEN, NOT ARBITRARY: 2 x ₪100.00 + 2 x ₪24.50 is ₪249.00
  // EXACTLY, so the free-shipping boundary test below can actually stand on the
  // boundary. With B at ₪25.50 that cart came to ₪251 and the test passed
  // without ever touching the number in its own name.
  for (const [slug, price] of [[SLUG_A, '100.00'], [SLUG_B, '24.50']] as const) {
    await prisma.product.upsert({
      where: { slug },
      create: {
        slug, nameHe: `בדיקה ${slug}`, nameEn: `Test ${slug}`,
        categoryId, brandId, dosageForm: 'CAPSULE', packageQuantity: 60,
        usageInstructions: 'בדיקה', price, stockQuantity: 100,
        descriptionHe: 'בדיקה', descriptionEn: 'test', warningsAllergens: '',
        isActive: true,
      },
      update: { price, stockQuantity: 100, isActive: true },
      select: { id: true },
    })
  }

  await prisma.user.upsert({
    where: { email: EMAIL },
    create: {
      email: EMAIL, firstName: 'Test', lastName: 'Checkout',
      passwordHash: 'x', termsAcceptedAt: new Date(),
    },
    update: {},
    select: { id: true },
  })
  userId = (await prisma.user.findUniqueOrThrow({ where: { email: EMAIL }, select: { id: true } })).id
})

afterEach(async () => {
  await wipe()
  await setStock(SLUG_A, 100)
  await setStock(SLUG_B, 100)
  await setActive(SLUG_A, true)
})

afterAll(async () => {
  // 🔴 `finally`, so a cleanup that throws on the Restrict FK still disconnects.
  // See ISSUE-081 for why the fixture delete itself is recorded rather than
  // silently reinterpreted against INV-03.
  try {
    await wipe()
    await prisma.product.deleteMany({ where: { slug: { in: [SLUG_A, SLUG_B] } } })
    await prisma.user.deleteMany({ where: { email: EMAIL } })
  } finally {
    await prisma.$disconnect()
  }
})

const COURIER = { userId: '', deliveryMethod: 'courier' as const }
const ADDRESS = { line1: 'רחוב הבדיקה 1', city: 'תל אביב', zipCode: '6100000' }

/** Live stock of a fixture, for the rollback assertions. */
async function stockOf(slug: string): Promise<number> {
  const p = await prisma.product.findUniqueOrThrow({ where: { slug }, select: { stockQuantity: true } })
  return p.stockQuantity
}

describe('the quote reports what the order would be, computed server-side', () => {
  it('courier under the threshold: goods + ₪30, and the total is their sum', async () => {
    await cartWith(SLUG_A, 1) // ₪100.00
    const result = await quoteCheckout(prisma, { ...COURIER, userId })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.quote.basis).toBe('100.00')
    expect(result.quote.shipping.cost).toBe('30.00')
    expect(result.quote.shipping.isFree).toBe(false)
    expect(result.quote.totalAmount).toBe('130.00')
  })

  it('🔴 ₪249 EXACTLY ships free — DEC-058 says "or more"', async () => {
    // The boundary DEC-058 names: an off-by-one charges ₪30 to the shopper who
    // hit the number precisely.
    //
    // ⚠️ THE FIRST VERSION OF THIS TEST NEVER REACHED THE BOUNDARY — it built a
    // ₪251 cart and asserted free shipping, which `>` and `>=` both satisfy.
    // The fixture price was changed so the cart lands on ₪249.00 exactly; only
    // then does the assertion distinguish the two.
    await cartWith(SLUG_A, 2) // ₪200.00
    await cartWith(SLUG_B, 2) // + ₪49.00 = ₪249.00 exactly
    const result = await quoteCheckout(prisma, { ...COURIER, userId })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.quote.basis).toBe('249.00')
    expect(result.quote.shipping.isFree).toBe(true)
    expect(result.quote.shipping.cost).toBe('0.00')
    expect(result.quote.totalAmount).toBe('249.00')
  })

  it('🔴 SELF PICKUP is ₪0 and is NOT reported as earned free shipping', async () => {
    await cartWith(SLUG_A, 1)
    const result = await quoteCheckout(prisma, { userId, deliveryMethod: 'self_pickup' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.quote.shipping.cost).toBe('0.00')
    // Free shipping is a promotion EARNED by spending ₪249. A pickup order has
    // no delivery to discount, so saying "free" claims something untrue.
    expect(result.quote.shipping.isFree).toBe(false)
    expect(result.quote.shipping.noDeliveryRequired).toBe(true)
    expect(result.quote.totalAmount).toBe('100.00')
  })

  it('🔴 a PICKUP POINT is a delivery — ₪30, and the courier estimate', async () => {
    await cartWith(SLUG_A, 1)
    const result = await quoteCheckout(prisma, { userId, deliveryMethod: 'pickup_point' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.quote.shipping.cost).toBe('30.00')
    expect(result.quote.shipping.noDeliveryRequired).toBe(false)
    expect(result.quote.estimate).toEqual({
      kind: 'delivered_between', minBusinessDays: 3, maxBusinessDays: 5,
    })
  })

  it('self pickup carries the READY-WITHIN estimate, not a range', async () => {
    await cartWith(SLUG_A, 1)
    const result = await quoteCheckout(prisma, { userId, deliveryMethod: 'self_pickup' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.quote.estimate).toEqual({ kind: 'ready_within', businessDays: 2 })
  })
})

describe('🔴 REQ-F-042 — a cart that cannot become an order is REFUSED, by line', () => {
  it('a WITHDRAWN line names itself and reports available 0', async () => {
    await cartWith(SLUG_A, 1)
    await setActive(SLUG_A, false)
    const result = await quoteCheckout(prisma, { ...COURIER, userId })
    expect(result).toMatchObject({
      ok: false,
      reason: 'UNPURCHASABLE_LINE',
      lines: [{ slug: SLUG_A, why: 'WITHDRAWN', available: 0 }],
    })
  })

  it('🔴 a WITHDRAWN product reports available 0 even with stock ON THE SHELF', async () => {
    // Reporting the shelf stock would send the shopper to lower their quantity
    // — the one action that cannot possibly help.
    await cartWith(SLUG_A, 1)
    await setStock(SLUG_A, 50)
    await setActive(SLUG_A, false)
    const result = await quoteCheckout(prisma, { ...COURIER, userId })
    expect(result).toMatchObject({ ok: false, lines: [{ why: 'WITHDRAWN', available: 0 }] })
  })

  it('a SOLD-OUT line is refused, and its cause differs from withdrawn', async () => {
    await cartWith(SLUG_A, 1)
    await setStock(SLUG_A, 0)
    const result = await quoteCheckout(prisma, { ...COURIER, userId })
    expect(result).toMatchObject({
      ok: false, reason: 'UNPURCHASABLE_LINE', lines: [{ why: 'SOLD_OUT', available: 0 }],
    })
  })

  it('🔴 a SHORT-STOCK line reports HOW MANY remain — the only cause where that helps', async () => {
    await cartWith(SLUG_A, 5)
    await setStock(SLUG_A, 3)
    const result = await quoteCheckout(prisma, { ...COURIER, userId })
    expect(result).toMatchObject({
      ok: false, reason: 'UNPURCHASABLE_LINE', lines: [{ why: 'SHORT_STOCK', available: 3 }],
    })
  })

  it('the blocked line carries its LINE id, so the UI can point at the row', async () => {
    // ISSUE-080 is exactly the failure of not doing this: a banner that blocks
    // checkout while naming no line and no action.
    const cartId = await cartWith(SLUG_A, 5)
    await setStock(SLUG_A, 1)
    const line = await prisma.cartItem.findFirstOrThrow({ where: { cartId }, select: { id: true } })
    const result = await quoteCheckout(prisma, { ...COURIER, userId })
    expect(result).toMatchObject({ ok: false, lines: [{ lineId: line.id }] })
  })

  it('an empty cart is refused as EMPTY_CART, not as an unpurchasable line', async () => {
    expect(await quoteCheckout(prisma, { ...COURIER, userId })).toEqual({
      ok: false, reason: 'EMPTY_CART',
    })
  })

  it('🔴 an unknown delivery method is refused, not quoted as courier', async () => {
    await cartWith(SLUG_A, 1)
    expect(
      await quoteCheckout(prisma, { userId, deliveryMethod: 'COURIER ' as never }),
    ).toEqual({ ok: false, reason: 'INVALID_DELIVERY_METHOD' })
  })
})

describe('🔴 DEC-060 — the fingerprint describes THESE figures and no others', () => {
  it('quoting twice with nothing changed gives the SAME fingerprint', async () => {
    await cartWith(SLUG_A, 2)
    const a = await quoteCheckout(prisma, { ...COURIER, userId })
    const b = await quoteCheckout(prisma, { ...COURIER, userId })
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    // 🔴 Two independent database reads. If this were unstable, `/pay` would
    // halt every checkout to show identical figures — a dead end, not a guard.
    expect(a.quote.fingerprint).toBe(b.quote.fingerprint)
  })

  it('🔴 A PRICE CHANGE between quote and re-quote moves the fingerprint', async () => {
    // REQ-F-042's whole purpose, end to end and against a real database.
    await cartWith(SLUG_A, 1)
    const before = await quoteCheckout(prisma, { ...COURIER, userId })
    expect(before.ok).toBe(true)
    if (!before.ok) return

    await prisma.product.update({ where: { slug: SLUG_A }, data: { price: '111.00' } })
    try {
      const after = await quoteCheckout(prisma, { ...COURIER, userId })
      expect(after.ok).toBe(true)
      if (!after.ok) return
      expect(after.quote.fingerprint).not.toBe(before.quote.fingerprint)
      expect(after.quote.totalAmount).toBe('141.00')
    } finally {
      await prisma.product.update({ where: { slug: SLUG_A }, data: { price: '100.00' } })
    }
  })

  it('a QUANTITY change moves it', async () => {
    await cartWith(SLUG_A, 1)
    const before = await quoteCheckout(prisma, { ...COURIER, userId })
    await cartWith(SLUG_A, 2)
    const after = await quoteCheckout(prisma, { ...COURIER, userId })
    expect(before.ok && after.ok).toBe(true)
    if (!before.ok || !after.ok) return
    expect(after.quote.fingerprint).not.toBe(before.quote.fingerprint)
  })

  it('🔴 a DIFFERENT DELIVERY METHOD moves it — the shipping charge is part of what was confirmed', async () => {
    await cartWith(SLUG_A, 1)
    const courier = await quoteCheckout(prisma, { ...COURIER, userId })
    const pickup = await quoteCheckout(prisma, { userId, deliveryMethod: 'self_pickup' })
    expect(courier.ok && pickup.ok).toBe(true)
    if (!courier.ok || !pickup.ok) return
    expect(courier.quote.fingerprint).not.toBe(pickup.quote.fingerprint)
  })

  it('🔴 THE GATE HOLDS INSIDE THE TRANSACTION — the window the route cannot see', async () => {
    // 🔴 THE TOCTOU THIS CLOSES. `quoteCheckout` is a LOCK-FREE read and the
    // route compares fingerprints against it; `createOrder` then opens its own
    // transaction, takes its locks, and recomputes the money from live rows.
    // Anything landing in between — an admin editing a price, another tab
    // editing the cart — produced an order at figures the shopper never
    // confirmed, while `checkoutFingerprint.ts` claimed "you cannot pay for a
    // state that is not the current one". The claim was false for that window.
    await cartWith(SLUG_A, 1)
    const quote = await quoteCheckout(prisma, { ...COURIER, userId })
    expect(quote.ok).toBe(true)
    if (!quote.ok) return

    // The window opens here — after the shopper confirmed, before the order.
    await prisma.product.update({ where: { slug: SLUG_A }, data: { price: '111.00' } })
    try {
      const order = await createOrder(prisma, {
        userId,
        idempotencyKey: 'toctou-1',
        deliveryMethod: 'courier',
        address: ADDRESS,
        expectedFingerprint: quote.quote.fingerprint,
      })

      expect(order).toEqual({ ok: false, reason: 'CHECKOUT_CHANGED' })
      // 🔴 ROLLED BACK, not merely refused: no order, no decrement, cart intact.
      expect(await prisma.order.count({ where: { userId } })).toBe(0)
      expect(await stockOf(SLUG_A)).toBe(100)
      expect(await prisma.cartItem.count({ where: { cart: { userId } } })).toBe(1)
    } finally {
      await prisma.product.update({ where: { slug: SLUG_A }, data: { price: '100.00' } })
    }
  })

  it('a MATCHING fingerprint passes straight through — the gate is not a wall', async () => {
    // ⚠️ THE CONTROL. A gate that refused everything would satisfy the test
    // above and break every checkout — the all-reject shape this project
    // already recorded once, where a screen rejected all eight candidates and
    // read as diligence.
    await cartWith(SLUG_A, 1)
    const quote = await quoteCheckout(prisma, { ...COURIER, userId })
    expect(quote.ok).toBe(true)
    if (!quote.ok) return

    const order = await createOrder(prisma, {
      userId,
      idempotencyKey: 'toctou-2',
      deliveryMethod: 'courier',
      address: ADDRESS,
      expectedFingerprint: quote.quote.fingerprint,
    })

    expect(order.ok).toBe(true)
    if (!order.ok) return
    expect(order.totalAmount).toBe(quote.quote.totalAmount)
    expect(await stockOf(SLUG_A)).toBe(99)
  })

  it('🔴 OMITTING the fingerprint still works — callers that never quoted are not refused', async () => {
    // `createOrder` predates the gate and its own thirty tests place orders
    // directly. Inventing an expectation for a caller that never confirmed
    // anything would refuse it for failing a check it never took.
    await cartWith(SLUG_A, 1)
    const order = await createOrder(prisma, {
      userId, idempotencyKey: 'toctou-3', deliveryMethod: 'courier', address: ADDRESS,
    })
    expect(order.ok).toBe(true)
  })

  // 🔴 THE TWO `markOrderPaid` TESTS THAT LIVED HERE MOVED, WITH THE CODE.
  // Checkpoint E2 replaced `lib/orderPaid.ts` with `applyTransition`, which
  // reads §8.9's table — so the idempotency guard and the wrong-status control
  // are now in `orderTransitionService.integration.test.ts`, alongside the
  // mid-flight race test that D3's version had no way to reach.

  it('🔴 the fingerprint is REPRODUCIBLE from the quote it describes', async () => {
    // ⚠️ THE CONTROL THAT MAKES THE OTHERS MEAN SOMETHING. Every test above
    // asserts the digest CHANGED; a `Math.random()` would satisfy all of them.
    // This one pins that the digest is a function of the figures — which is what
    // lets `/pay` re-derive it from the database rather than store it.
    await cartWith(SLUG_A, 2)
    await cartWith(SLUG_B, 1)
    const result = await quoteCheckout(prisma, { ...COURIER, userId })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const recomputed = checkoutFingerprint({
      userId,
      deliveryMethod: 'courier',
      shippingCost: result.quote.shipping.cost,
      totalAmount: result.quote.totalAmount,
      lines: result.quote.lines.map((line) => ({
        lineId: line.id,
        productId: line.productId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
      })),
    })
    expect(recomputed).toBe(result.quote.fingerprint)
  })
})
