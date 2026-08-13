import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { findStuckPendingPayment, reconcileStuckOrders, STUCK_AFTER_MINUTES } from './orderReconciliation.js'
import { createOrder } from './orderService.js'
import { TEST_FIXTURE_SLUG_PREFIX } from './testFixturePrefix.js'

/**
 * MILESTONE-008 Checkpoint E3 — ISSUE-082's reconciliation, against a real
 * database.
 *
 * ⚠️ DEC-057 — `.integration.test.ts`, single-threaded, own fixtures.
 *
 * 🔴 EVERY CALL HERE IS SCOPED WITH `userId`, AND THAT IS NOT TIDINESS. The
 * unscoped sweep mutates every order in the database past the window — so an
 * unscoped test both asserts a global property of the development database and
 * silently marks somebody else's stuck order `paid` just by running.
 */

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
})

const SLUG = `${TEST_FIXTURE_SLUG_PREFIX}reconcile`
const EMAIL = 'zz-reconcile@example.test'
const ADDRESS = { line1: 'רחוב הבדיקה 1', city: 'תל אביב', zipCode: '6100000' }
let userId = ''

async function wipe(): Promise<void> {
  const orders = await prisma.order.findMany({ where: { user: { email: EMAIL } }, select: { id: true } })
  if (orders.length > 0) {
    const ids = orders.map((o) => o.id)
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: ids } } })
    await prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } })
    await prisma.order.deleteMany({ where: { id: { in: ids } } })
  }
  const carts = await prisma.cart.findMany({ where: { user: { email: EMAIL } }, select: { id: true } })
  if (carts.length > 0) {
    const ids = carts.map((c) => c.id)
    await prisma.cartItem.deleteMany({ where: { cartId: { in: ids } } })
    await prisma.cart.deleteMany({ where: { id: { in: ids } } })
  }
}

/** Places a real order, then ages it so the sweep can see it. */
async function placeOrder(key: string, minutesAgo: number | null): Promise<string> {
  const product = await prisma.product.findUniqueOrThrow({ where: { slug: SLUG }, select: { id: true } })
  const cart = await prisma.cart.upsert({
    where: { userId }, create: { userId }, update: {}, select: { id: true },
  })
  await prisma.cartItem.upsert({
    where: { cartId_productId: { cartId: cart.id, productId: product.id } },
    create: { cartId: cart.id, productId: product.id, quantity: 1 },
    update: { quantity: 1 },
    select: { id: true },
  })
  const result = await createOrder(prisma, {
    userId, idempotencyKey: key, deliveryMethod: 'courier', address: ADDRESS,
  })
  if (!result.ok) throw new Error(`fixture order failed: ${result.reason}`)
  if (minutesAgo !== null) {
    await prisma.order.update({
      where: { id: result.orderId },
      data: { createdAt: new Date(Date.now() - minutesAgo * 60_000) },
    })
  }
  return result.orderId
}

async function statusOf(orderId: string): Promise<string> {
  const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } })
  return o.status
}

beforeAll(async () => {
  const seeded = await prisma.product.findFirstOrThrow({
    where: { isActive: true }, select: { categoryId: true, brandId: true },
  })
  await prisma.product.upsert({
    where: { slug: SLUG },
    create: {
      slug: SLUG, nameHe: 'בדיקת התאמה', nameEn: 'Reconcile test',
      categoryId: seeded.categoryId, brandId: seeded.brandId,
      dosageForm: 'CAPSULE', packageQuantity: 60, usageInstructions: 'בדיקה',
      price: '10.00', stockQuantity: 500,
      descriptionHe: 'בדיקה', descriptionEn: 'test', warningsAllergens: '',
      isActive: true,
    },
    update: { stockQuantity: 500, isActive: true },
    select: { id: true },
  })
  await prisma.user.upsert({
    where: { email: EMAIL },
    create: {
      email: EMAIL, firstName: 'Rec', lastName: 'Test',
      passwordHash: 'x', termsAcceptedAt: new Date(),
    },
    update: {},
    select: { id: true },
  })
  userId = (await prisma.user.findUniqueOrThrow({ where: { email: EMAIL }, select: { id: true } })).id
  await wipe()
})

afterEach(async () => {
  await wipe()
  await prisma.product.update({ where: { slug: SLUG }, data: { stockQuantity: 500 } })
})

afterAll(async () => {
  try {
    await wipe()
    await prisma.product.deleteMany({ where: { slug: SLUG } })
    await prisma.user.deleteMany({ where: { email: EMAIL } })
  } finally {
    await prisma.$disconnect()
  }
})

describe('🔴 the READ changes nothing — it is safe to call anywhere', () => {
  it('finds an order stuck past the window', async () => {
    const orderId = await placeOrder('rec-stuck', STUCK_AFTER_MINUTES + 5)
    const stuck = await findStuckPendingPayment(prisma, { userId })
    expect(stuck.map((o) => o.id)).toContain(orderId)
    // 🔴 And it did NOT move it.
    expect(await statusOf(orderId)).toBe('pending_payment')
  })

  it('🔴 IGNORES AN ORDER STILL IN FLIGHT — the window is the whole safety margin', async () => {
    // A checkout mid-request sits in `pending_payment` for a moment by design.
    // Sweeping it would race the transition that is about to run anyway.
    const orderId = await placeOrder('rec-fresh', null)
    const stuck = await findStuckPendingPayment(prisma, { userId })
    expect(stuck.map((o) => o.id)).not.toContain(orderId)
  })

  it('ignores orders that are not pending_payment', async () => {
    const orderId = await placeOrder('rec-paid', STUCK_AFTER_MINUTES + 5)
    await prisma.order.update({ where: { id: orderId }, data: { status: 'paid' } })
    const stuck = await findStuckPendingPayment(prisma, { userId })
    expect(stuck.map((o) => o.id)).not.toContain(orderId)
  })
})

describe('🔴 the REPAIR moves them through §8.9, as the SYSTEM', () => {
  it('advances a stuck order to paid and records a null actor', async () => {
    const orderId = await placeOrder('rec-repair', STUCK_AFTER_MINUTES + 5)

    const report = await reconcileStuckOrders(prisma, { userId })

    expect(report.repaired).toBeGreaterThanOrEqual(1)
    expect(report.failed).toEqual([])
    expect(await statusOf(orderId)).toBe('paid')

    const history = await prisma.orderStatusHistory.findMany({
      where: { orderId }, select: { status: true, changedByUserId: true },
      orderBy: { createdAt: 'asc' },
    })
    expect(history.map((h) => h.status)).toEqual(['pending_payment', 'paid'])
    // A sweep is not a person, and null means exactly that.
    expect(history[1]?.changedByUserId).toBeNull()
  })

  it('🔴 leaves an IN-FLIGHT order alone — the repair inherits the read’s window', async () => {
    // ⚠️ THE CONTROL THAT MATTERS MOST HERE. A sweep that repaired everything in
    // `pending_payment` would race every checkout in progress, and under this
    // flow it would be marking orders paid that are ABOUT to be marked paid —
    // harmless today, and the exact behaviour that becomes "inventing revenue"
    // the day an order is created before its payment. See the module header.
    const fresh = await placeOrder('rec-inflight', null)

    await reconcileStuckOrders(prisma, { userId })

    expect(await statusOf(fresh)).toBe('pending_payment')
  })

  it('running the sweep TWICE repairs once and reports no failure', async () => {
    const orderId = await placeOrder('rec-twice', STUCK_AFTER_MINUTES + 5)

    const first = await reconcileStuckOrders(prisma, { userId })
    expect(first.repaired).toBeGreaterThanOrEqual(1)

    const second = await reconcileStuckOrders(prisma, { userId })
    // Nothing is stuck any more, so there is nothing to examine.
    expect(second.examined).toBe(0)
    expect(second.failed).toEqual([])

    expect(
      await prisma.orderStatusHistory.count({ where: { orderId, status: 'paid' } }),
    ).toBe(1)
  })

  it('repairs a BATCH — every stuck order, not just the first', async () => {
    // ⚠️ THIS TEST WAS WRITTEN AS "one failure does not abandon the rest" AND IT
    // PROVED NO SUCH THING. It forced an order to `shipped` and then straight
    // back to `pending_payment`, which makes it an ordinary healthy order —
    // nothing failed, and the failure-collection path was never entered.
    //
    // 🔴 THAT PATH IS NOT REACHABLE FROM A TEST. `applyTransition` refuses only
    // when the status is not `pending_payment`, and the sweep selects on exactly
    // that status — so a failure needs the row to change between the select and
    // the repair, which nothing here controls. The per-order try/catch and the
    // `failed` collection are DEFENSIVE, not demonstrated. Do not read this
    // green tick as covering them.
    const first = await placeOrder('rec-batch-1', STUCK_AFTER_MINUTES + 10)
    const second = await placeOrder('rec-batch-2', STUCK_AFTER_MINUTES + 20)
    const third = await placeOrder('rec-batch-3', STUCK_AFTER_MINUTES + 30)

    const report = await reconcileStuckOrders(prisma, { userId })

    expect(report.examined).toBeGreaterThanOrEqual(3)
    expect(report.failed).toEqual([])
    for (const id of [first, second, third]) {
      expect(await statusOf(id), id).toBe('paid')
    }
  })

  it('🔴 the LIMIT takes the OLDEST first — the longest-stuck are repaired soonest', async () => {
    const oldest = await placeOrder('rec-oldest', STUCK_AFTER_MINUTES + 120)
    const newer = await placeOrder('rec-newer', STUCK_AFTER_MINUTES + 5)

    const report = await reconcileStuckOrders(prisma, { userId, limit: 1 })

    expect(report.examined).toBe(1)
    expect(await statusOf(oldest)).toBe('paid')
    // ⚠️ The control: the limit really limited, and it chose by age rather than
    // by whatever order the database felt like returning.
    expect(await statusOf(newer)).toBe('pending_payment')
  })
})
