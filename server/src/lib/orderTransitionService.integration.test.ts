import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { applyTransition } from './orderTransitionService.js'
import { createOrder } from './orderService.js'
import { TEST_FIXTURE_SLUG_PREFIX } from './testFixturePrefix.js'

/**
 * MILESTONE-008 Checkpoint E2 — applying a transition, against a real database.
 *
 * 🔴 THE TEST THAT MATTERS IS THE DOUBLE RESTORE. Overselling is loud: someone
 * eventually cannot be shipped. INVENTING inventory is silent — a retried
 * cancellation that restores twice leaves units on the shelf that do not exist,
 * and nothing downstream ever complains. It is INV-01's hazard mirrored, and it
 * is the reason the expected status sits in the update's WHERE.
 *
 * ⚠️ DEC-057 — `.integration.test.ts`, so it runs single-threaded, and every
 * fixture is this suite's own under TEST_FIXTURE_SLUG_PREFIX.
 */

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
})

const SLUG_A = `${TEST_FIXTURE_SLUG_PREFIX}trans-a`
const SLUG_B = `${TEST_FIXTURE_SLUG_PREFIX}trans-b`
const EMAIL = 'zz-transtest@example.test'
const ADMIN_EMAIL = 'zz-transtest-admin@example.test'
const ADDRESS = { line1: 'רחוב הבדיקה 1', city: 'תל אביב', zipCode: '6100000' }

let userId = ''
let adminId = ''

async function wipe(): Promise<void> {
  const orders = await prisma.order.findMany({
    where: { user: { email: { in: [EMAIL, ADMIN_EMAIL] } } },
    select: { id: true },
  })
  if (orders.length > 0) {
    const ids = orders.map((o) => o.id)
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: ids } } })
    await prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } })
    await prisma.order.deleteMany({ where: { id: { in: ids } } })
  }
  const carts = await prisma.cart.findMany({
    where: { user: { email: { in: [EMAIL, ADMIN_EMAIL] } } },
    select: { id: true },
  })
  if (carts.length > 0) {
    const ids = carts.map((c) => c.id)
    await prisma.cartItem.deleteMany({ where: { cartId: { in: ids } } })
    await prisma.cart.deleteMany({ where: { id: { in: ids } } })
  }
}

async function stockOf(slug: string): Promise<number> {
  const p = await prisma.product.findUniqueOrThrow({ where: { slug }, select: { stockQuantity: true } })
  return p.stockQuantity
}

async function setStock(slug: string, stockQuantity: number): Promise<void> {
  await prisma.product.update({ where: { slug }, data: { stockQuantity } })
}

/** Places a real order through `createOrder`, so the frozen items are real. */
async function placeOrder(key: string, lines: readonly { slug: string; quantity: number }[]) {
  const cart = await prisma.cart.upsert({
    where: { userId }, create: { userId }, update: {}, select: { id: true },
  })
  for (const line of lines) {
    const product = await prisma.product.findUniqueOrThrow({
      where: { slug: line.slug }, select: { id: true },
    })
    await prisma.cartItem.upsert({
      where: { cartId_productId: { cartId: cart.id, productId: product.id } },
      create: { cartId: cart.id, productId: product.id, quantity: line.quantity },
      update: { quantity: line.quantity },
      select: { id: true },
    })
  }
  const result = await createOrder(prisma, {
    userId, idempotencyKey: key, deliveryMethod: 'courier', address: ADDRESS,
  })
  if (!result.ok) throw new Error(`fixture order failed: ${result.reason}`)
  return result.orderId
}

/** Forces an order into a status the fixture cannot reach through the flow. */
async function forceStatus(orderId: string, status: 'paid' | 'processing' | 'shipped' | 'delivered' | 'cancelled') {
  await prisma.order.update({ where: { id: orderId }, data: { status } })
}

async function historyOf(orderId: string) {
  return prisma.orderStatusHistory.findMany({
    where: { orderId },
    select: { status: true, changedByUserId: true },
    orderBy: { createdAt: 'asc' },
  })
}

beforeAll(async () => {
  const seeded = await prisma.product.findFirstOrThrow({
    where: { isActive: true }, select: { categoryId: true, brandId: true },
  })
  for (const [slug, price] of [[SLUG_A, '50.00'], [SLUG_B, '10.00']] as const) {
    await prisma.product.upsert({
      where: { slug },
      create: {
        slug, nameHe: `בדיקה ${slug}`, nameEn: `Test ${slug}`,
        categoryId: seeded.categoryId, brandId: seeded.brandId,
        dosageForm: 'CAPSULE', packageQuantity: 60, usageInstructions: 'בדיקה',
        price, stockQuantity: 100,
        descriptionHe: 'בדיקה', descriptionEn: 'test', warningsAllergens: '',
        isActive: true,
      },
      update: { price, stockQuantity: 100, isActive: true },
      select: { id: true },
    })
  }
  for (const email of [EMAIL, ADMIN_EMAIL]) {
    await prisma.user.upsert({
      where: { email },
      create: {
        email, firstName: 'Trans', lastName: 'Test',
        passwordHash: 'x', termsAcceptedAt: new Date(),
      },
      update: {},
      select: { id: true },
    })
  }
  userId = (await prisma.user.findUniqueOrThrow({ where: { email: EMAIL }, select: { id: true } })).id
  adminId = (await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL }, select: { id: true } })).id
  await wipe()
})

afterEach(async () => {
  await wipe()
  await setStock(SLUG_A, 100)
  await setStock(SLUG_B, 100)
  await prisma.product.update({ where: { slug: SLUG_A }, data: { isActive: true } })
})

afterAll(async () => {
  try {
    await wipe()
    await prisma.product.deleteMany({ where: { slug: { in: [SLUG_A, SLUG_B] } } })
    await prisma.user.deleteMany({ where: { email: { in: [EMAIL, ADMIN_EMAIL] } } })
  } finally {
    await prisma.$disconnect()
  }
})

describe('🔴 INV-01 IN REVERSE — the stock goes back exactly ONCE', () => {
  it('a cancellation restores every line', async () => {
    const orderId = await placeOrder('t-cancel', [{ slug: SLUG_A, quantity: 3 }, { slug: SLUG_B, quantity: 2 }])
    expect(await stockOf(SLUG_A)).toBe(97)
    expect(await stockOf(SLUG_B)).toBe(98)

    const result = await applyTransition(prisma, {
      orderId, to: 'cancelled', actor: 'shopper', actorUserId: userId,
    })

    expect(result).toEqual({
      ok: true, moved: true, from: 'pending_payment', to: 'cancelled', restoredStock: true,
    })
    expect(await stockOf(SLUG_A)).toBe(100)
    expect(await stockOf(SLUG_B)).toBe(100)
  })

  it('🔴 A RETRIED CANCELLATION RESTORES NOTHING — inventory is not invented', async () => {
    // THE TEST THIS MODULE EXISTS FOR. Overselling is loud; inventing stock is
    // silent. A read-then-write would let a second cancel add the units again,
    // leaving the shelf claiming inventory that does not exist.
    const orderId = await placeOrder('t-cancel-twice', [{ slug: SLUG_A, quantity: 4 }])
    expect(await stockOf(SLUG_A)).toBe(96)

    const first = await applyTransition(prisma, {
      orderId, to: 'cancelled', actor: 'shopper', actorUserId: userId,
    })
    expect(first).toMatchObject({ ok: true, moved: true, restoredStock: true })
    expect(await stockOf(SLUG_A)).toBe(100)

    const second = await applyTransition(prisma, {
      orderId, to: 'cancelled', actor: 'shopper', actorUserId: userId,
    })
    expect(second).toEqual({ ok: true, moved: false, status: 'cancelled' })

    // 🔴 STILL 100, not 104.
    expect(await stockOf(SLUG_A)).toBe(100)
    // And the append-only log records ONE cancellation.
    expect((await historyOf(orderId)).filter((h) => h.status === 'cancelled')).toHaveLength(1)
  })

  it('🔴 CONCURRENT cancellations restore once between them', async () => {
    const orderId = await placeOrder('t-cancel-race', [{ slug: SLUG_A, quantity: 5 }])
    expect(await stockOf(SLUG_A)).toBe(95)

    const [a, b] = await Promise.all([
      applyTransition(prisma, { orderId, to: 'cancelled', actor: 'shopper', actorUserId: userId }),
      applyTransition(prisma, { orderId, to: 'cancelled', actor: 'admin', actorUserId: adminId }),
    ])

    // Exactly one moved it; the other saw it done or lost the guarded update.
    const movers = [a, b].filter((r) => r.ok && r.moved)
    expect(movers).toHaveLength(1)
    expect(await stockOf(SLUG_A)).toBe(100)
    expect((await historyOf(orderId)).filter((h) => h.status === 'cancelled')).toHaveLength(1)
  })

  it('🔴 A CANCELLATION THAT LANDS MID-FLIGHT RESTORES NOTHING — the real race', async () => {
    // 🔴 THE TEST THE GUARD ACTUALLY NEEDED, and mutation is why it exists.
    // Deleting `status: from` from the update's WHERE left all fourteen other
    // tests GREEN: the sequential retry is answered by the `from === to`
    // short-circuit before the update, and two Promise.all transactions
    // serialise often enough that the second also reads the committed value.
    //
    // The seam stands where the race would: this transaction has READ
    // `pending_payment` and not yet written, and the hook cancels the order
    // over a different connection and commits. Without the guard this
    // transaction would then restore the units a SECOND time.
    const orderId = await placeOrder('t-midflight', [{ slug: SLUG_A, quantity: 7 }])
    expect(await stockOf(SLUG_A)).toBe(93)

    const result = await applyTransition(
      prisma,
      { orderId, to: 'cancelled', actor: 'shopper', actorUserId: userId },
      {
        afterRead: async () => {
          // The other actor gets there first, and commits.
          const winner = await applyTransition(prisma, {
            orderId, to: 'cancelled', actor: 'admin', actorUserId: adminId,
          })
          expect(winner).toMatchObject({ ok: true, moved: true, restoredStock: true })
        },
      },
    )

    // 🔴 THE DAMAGE FIRST, so a failure here names the harm rather than a shape:
    // 100, NOT 107. The units went back once. Seven invented units on the shelf
    // is what removing the guard actually costs.
    expect(await stockOf(SLUG_A)).toBe(100)
    // And this attempt changed nothing and says so.
    expect(result).toEqual({ ok: false, reason: 'CONCURRENT_TRANSITION', from: 'pending_payment' })
    expect((await historyOf(orderId)).filter((h) => h.status === 'cancelled')).toHaveLength(1)
  })

  it('a NON-cancelling transition leaves stock alone', async () => {
    const orderId = await placeOrder('t-processing', [{ slug: SLUG_A, quantity: 3 }])
    await forceStatus(orderId, 'paid')
    expect(await stockOf(SLUG_A)).toBe(97)

    const result = await applyTransition(prisma, {
      orderId, to: 'processing', actor: 'admin', actorUserId: adminId,
    })

    expect(result).toMatchObject({ ok: true, moved: true, restoredStock: false })
    expect(await stockOf(SLUG_A)).toBe(97)
  })

  it('🔴 a WITHDRAWN product still gets its units back', async () => {
    // The decrement requires `isActive`; the restore must not. Units physically
    // exist, and a withdrawn product is exactly the case most likely to be
    // cancelled — requiring isActive would swallow the restore silently.
    const orderId = await placeOrder('t-withdrawn', [{ slug: SLUG_A, quantity: 6 }])
    expect(await stockOf(SLUG_A)).toBe(94)
    await prisma.product.update({ where: { slug: SLUG_A }, data: { isActive: false } })

    await applyTransition(prisma, { orderId, to: 'cancelled', actor: 'admin', actorUserId: adminId })

    expect(await stockOf(SLUG_A)).toBe(100)
  })
})

describe('the table is consulted, not re-decided', () => {
  it('🔴 a shopper cannot cancel once fulfilment has begun', async () => {
    const orderId = await placeOrder('t-forbidden', [{ slug: SLUG_A, quantity: 2 }])
    await forceStatus(orderId, 'processing')

    const result = await applyTransition(prisma, {
      orderId, to: 'cancelled', actor: 'shopper', actorUserId: userId,
    })

    expect(result).toEqual({ ok: false, reason: 'FORBIDDEN_FOR_ACTOR', from: 'processing' })
    // 🔴 NOTHING WAS WRITTEN — not the status, not the stock, not the log.
    expect(await stockOf(SLUG_A)).toBe(98)
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } })
    expect(order.status).toBe('processing')
    expect((await historyOf(orderId)).filter((h) => h.status === 'cancelled')).toHaveLength(0)
  })

  it('an ADMIN can cancel at that same point', async () => {
    // ⚠️ THE CONTROL for the test above: it must be the ACTOR that was refused,
    // not the transition. Without this, forbidding everyone would pass.
    const orderId = await placeOrder('t-admin-cancel', [{ slug: SLUG_A, quantity: 2 }])
    await forceStatus(orderId, 'processing')

    const result = await applyTransition(prisma, {
      orderId, to: 'cancelled', actor: 'admin', actorUserId: adminId,
    })

    expect(result).toMatchObject({ ok: true, moved: true, restoredStock: true })
    expect(await stockOf(SLUG_A)).toBe(100)
  })

  it('a move the table does not contain is refused', async () => {
    const orderId = await placeOrder('t-skip', [{ slug: SLUG_A, quantity: 1 }])
    await forceStatus(orderId, 'paid')
    expect(
      await applyTransition(prisma, { orderId, to: 'shipped', actor: 'admin', actorUserId: adminId }),
    ).toEqual({ ok: false, reason: 'NOT_A_TRANSITION', from: 'paid' })
  })

  it('a TERMINAL order refuses everything', async () => {
    const orderId = await placeOrder('t-terminal', [{ slug: SLUG_A, quantity: 1 }])
    await forceStatus(orderId, 'delivered')
    expect(
      await applyTransition(prisma, { orderId, to: 'cancelled', actor: 'admin', actorUserId: adminId }),
    ).toEqual({ ok: false, reason: 'TERMINAL', from: 'delivered' })
  })
})

describe('🔴 the ACTOR is recorded, and null means SYSTEM', () => {
  it('the payment transition records a NULL actor', async () => {
    const orderId = await placeOrder('t-system', [{ slug: SLUG_A, quantity: 1 }])
    const result = await applyTransition(prisma, { orderId, to: 'paid', actor: 'system' })

    expect(result).toMatchObject({ ok: true, moved: true, restoredStock: false })
    const history = await historyOf(orderId)
    expect(history.map((h) => h.status)).toEqual(['pending_payment', 'paid'])
    expect(history[1]?.changedByUserId).toBeNull()
  })

  it('a human transition records WHO', async () => {
    const orderId = await placeOrder('t-human', [{ slug: SLUG_A, quantity: 1 }])
    await forceStatus(orderId, 'paid')
    await applyTransition(prisma, { orderId, to: 'processing', actor: 'admin', actorUserId: adminId })

    const history = await historyOf(orderId)
    expect(history.at(-1)?.changedByUserId).toBe(adminId)
  })

  it('🔴 `system` carrying a user id is REFUSED, not silently nulled', async () => {
    // Null means "no human moved this". Accepting a user id alongside `system`
    // would let a real person's action be recorded as the system's — the column
    // would answer "who did this?" with a lie rather than a gap.
    const orderId = await placeOrder('t-system-with-user', [{ slug: SLUG_A, quantity: 1 }])
    expect(
      await applyTransition(prisma, { orderId, to: 'paid', actor: 'system', actorUserId: userId }),
    ).toEqual({ ok: false, reason: 'ACTOR_NOT_ALLOWED' })
  })

  it('a human transition with NO user id is refused', async () => {
    const orderId = await placeOrder('t-no-user', [{ slug: SLUG_A, quantity: 1 }])
    expect(
      await applyTransition(prisma, { orderId, to: 'cancelled', actor: 'shopper' }),
    ).toEqual({ ok: false, reason: 'ACTOR_REQUIRED' })
    // Refused BEFORE the transaction — nothing moved.
    expect(await stockOf(SLUG_A)).toBe(99)
  })

  it('an unknown order is refused', async () => {
    expect(
      await applyTransition(prisma, {
        orderId: '00000000-0000-0000-0000-000000000000',
        to: 'cancelled', actor: 'admin', actorUserId: adminId,
      }),
    ).toEqual({ ok: false, reason: 'ORDER_NOT_FOUND' })
  })
})
