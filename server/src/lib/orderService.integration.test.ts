import 'dotenv/config'
import { PrismaClient, type Prisma } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomBytes } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createOrder } from './orderService.js'
import { TEST_FIXTURE_SLUG_PREFIX } from './testFixturePrefix.js'
import { toAgorot } from './shipping.js'

/**
 * MILESTONE-008 Checkpoint C — order creation, proved against a real database.
 *
 * 🔴 EVERY FIXTURE HERE IS THIS SUITE'S OWN. Nothing touches a seeded product,
 * because the stock decrements below would otherwise corrupt the catalogue that
 * `check-catalogue-facts.py` and `seedConvergence` both assert against. Products
 * carry TEST_FIXTURE_SLUG_PREFIX so the convergence test ignores them by the
 * same rule it already uses.
 *
 * ⚠️ DEC-057 — this file is `.integration.test.ts` because it constructs a
 * PrismaClient, so it runs single-threaded. `dbTestNaming.test.ts` enforces that.
 */

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
})

const SLUG_A = `${TEST_FIXTURE_SLUG_PREFIX}order-a`
const SLUG_B = `${TEST_FIXTURE_SLUG_PREFIX}order-b`
const EMAIL_1 = 'zz-ordertest-1@example.test'
const EMAIL_2 = 'zz-ordertest-2@example.test'

let categoryId = ''
let brandId = ''
let userId = ''
let otherUserId = ''

async function wipe(): Promise<void> {
  // 🔴 SCOPED TO THIS SUITE'S OWN ROWS. A blanket delete would take other
  // suites' fixtures with it — that mistake has already been made twice here.
  const mine = await prisma.order.findMany({
    where: { user: { email: { in: [EMAIL_1, EMAIL_2] } } },
    select: { id: true },
  })
  const orderIds = mine.map((o) => o.id)
  if (orderIds.length > 0) {
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } })
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } })
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } })
  }
  const carts = await prisma.cart.findMany({
    where: { user: { email: { in: [EMAIL_1, EMAIL_2] } } },
    select: { id: true },
  })
  if (carts.length > 0) {
    await prisma.cartItem.deleteMany({ where: { cartId: { in: carts.map((c) => c.id) } } })
    await prisma.cart.deleteMany({ where: { id: { in: carts.map((c) => c.id) } } })
  }
}

async function stockOf(slug: string): Promise<number> {
  const p = await prisma.product.findUniqueOrThrow({ where: { slug }, select: { stockQuantity: true } })
  return p.stockQuantity
}

async function setStock(slug: string, stockQuantity: number): Promise<void> {
  await prisma.product.update({ where: { slug }, data: { stockQuantity } })
}

/** Gives `who` a cart holding `quantity` of `slug`. Returns the cart id. */
async function cartWith(who: string, slug: string, quantity: number): Promise<string> {
  const product = await prisma.product.findUniqueOrThrow({ where: { slug }, select: { id: true } })
  const cart = await prisma.cart.upsert({
    where: { userId: who },
    create: { userId: who },
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

/** What a competing cart write ran into. `'not run'` catches a hook that never fired. */
type Contention = 'blocked' | 'applied' | 'not run'

/**
 * 🔴 HOW A ROW LOCK IS PROVED TO BE HELD, and why the write needs its own
 * `lock_timeout`.
 *
 * `createOrder` holds every cart line under `FOR UPDATE` for the whole
 * transaction, so a competing write to one of those rows WAITS. Running that
 * write from inside `afterPrecheck` — the only place a test can stand mid
 * transaction — would therefore hang both sides until TRANSACTION_OPTIONS' 15s
 * timeout fired, and report a confusing P2028 instead of the fact under test.
 *
 * `SET LOCAL lock_timeout` bounds the wait instead: the competing statement is
 * cancelled with 55P03, the hook returns, and the checkout carries on. The
 * return value is then the actual observation — did the lock stop it, or not.
 *
 * ⚠️ Anything that is NOT a lock timeout is rethrown. A matcher that swallowed
 * unrecognised failures would report `'blocked'` for a broken query and turn
 * this into one more check that passes while verifying nothing.
 */
async function contendForCartLines(
  write: (tx: Prisma.TransactionClient) => Promise<unknown>,
): Promise<Contention> {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '1500ms'`)
      await write(tx)
    })
    return 'applied'
  } catch (error) {
    const text = error instanceof Error ? `${error.message}` : String(error)
    if (text.includes('55P03') || /lock timeout/i.test(text)) return 'blocked'
    throw error
  }
}

const ADDRESS = { line1: 'רחוב הבדיקה 1', city: 'תל אביב', zipCode: '6100000' }

beforeAll(async () => {
  const anySeeded = await prisma.product.findFirstOrThrow({
    where: { isActive: true },
    select: { categoryId: true, brandId: true },
  })
  categoryId = anySeeded.categoryId
  brandId = anySeeded.brandId

  for (const [slug, price] of [[SLUG_A, '100.00'], [SLUG_B, '25.50']] as const) {
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

  for (const email of [EMAIL_1, EMAIL_2]) {
    await prisma.user.upsert({
      where: { email },
      create: {
        email, firstName: 'Test', lastName: 'Order',
        passwordHash: 'x', termsAcceptedAt: new Date(),
      },
      update: {},
      select: { id: true },
    })
  }
  userId = (await prisma.user.findUniqueOrThrow({ where: { email: EMAIL_1 }, select: { id: true } })).id
  otherUserId = (await prisma.user.findUniqueOrThrow({ where: { email: EMAIL_2 }, select: { id: true } })).id
})

afterEach(async () => {
  await wipe()
  await setStock(SLUG_A, 100)
  await setStock(SLUG_B, 100)
  await prisma.product.update({ where: { slug: SLUG_A }, data: { isActive: true } })
})

afterAll(async () => {
  // ⚠️ THE `product.deleteMany` BELOW IS A HARD DELETE, AND INV-03 SAYS THERE
  // ARE NONE. Recorded as ISSUE-081 rather than quietly reinterpreted: the
  // invariant protects the CATALOGUE from losing a row an order still refers
  // to, and these fixtures were created by this file seconds earlier under
  // TEST_FIXTURE_SLUG_PREFIX. Soft-deleting them instead would satisfy the
  // wording and defeat the purpose — they would accumulate every run, and
  // `check-catalogue-facts.py` would have to ignore a growing pile. The scope
  // question is the user's to answer.
  //
  // 🔴 THE DISCONNECT IS IN A `finally` BECAUSE THE CLEANUP CAN THROW. The FK
  // from `order_items` to `products` is Restrict, so if any order outside this
  // suite's two emails ever references a fixture, `deleteMany` throws — and on
  // the straight-line version that took `$disconnect()` with it, leaking the
  // connection and leaving the run to hang rather than to fail readably.
  try {
    await wipe()
    await prisma.product.deleteMany({ where: { slug: { in: [SLUG_A, SLUG_B] } } })
    await prisma.user.deleteMany({ where: { email: { in: [EMAIL_1, EMAIL_2] } } })
  } finally {
    await prisma.$disconnect()
  }
})

describe('TEST-044 — the order is created and the world moves with it', () => {
  it('creates the order, freezes the line, decrements stock, and empties the cart', async () => {
    const cartId = await cartWith(userId, SLUG_A, 2)
    const before = await stockOf(SLUG_A)

    const result = await createOrder(prisma, {
      userId, idempotencyKey: 'key-happy', deliveryMethod: 'courier', address: ADDRESS,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.replayed).toBe(false)

    // 2 x ₪100 = ₪200, under the ₪249 threshold, so ₪30 ships.
    expect(result.shippingCost).toBe('30.00')
    expect(result.totalAmount).toBe('230.00')
    expect(result.orderNumber).toMatch(/^VS-\d{8}-[A-HJ-NP-Z2-9]{6}$/)

    expect(await stockOf(SLUG_A)).toBe(before - 2)

    // 🔴 The cart is EMPTIED, not deleted — DEC-059 answer 7.
    expect(await prisma.cartItem.count({ where: { cartId } })).toBe(0)
    expect(await prisma.cart.findUnique({ where: { id: cartId }, select: { id: true } })).not.toBeNull()

    // The frozen line, and the status history's actor.
    const items = await prisma.orderItem.findMany({ where: { orderId: result.orderId } })
    expect(items).toHaveLength(1)
    expect(items[0]!.unitPriceAtPurchase.toFixed(2)).toBe('100.00')
    expect(items[0]!.productNameHeAtPurchase).toBe(`בדיקה ${SLUG_A}`)
    expect(items[0]!.productNameEnAtPurchase).toBe(`Test ${SLUG_A}`)

    const history = await prisma.orderStatusHistory.findMany({ where: { orderId: result.orderId } })
    expect(history).toHaveLength(1)
    expect(history[0]!.status).toBe('pending_payment')
    expect(history[0]!.changedByUserId).toBe(userId)
  })

  it('🔴 INV-02 — a later price change does NOT move a placed order', async () => {
    await cartWith(userId, SLUG_A, 1)
    const result = await createOrder(prisma, {
      userId, idempotencyKey: 'key-freeze', deliveryMethod: 'self_pickup', address: null,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    await setStock(SLUG_A, 100)
    await prisma.product.update({ where: { slug: SLUG_A }, data: { price: '999.00' } })
    try {
      const order = await prisma.order.findUniqueOrThrow({
        where: { id: result.orderId },
        select: { totalAmount: true, items: { select: { unitPriceAtPurchase: true } } },
      })
      // 🔴 Self pickup ships free, so the total is the goods alone — and it is
      // the price AT PURCHASE, not the price now.
      expect(order.totalAmount.toFixed(2)).toBe('100.00')
      expect(order.items[0]!.unitPriceAtPurchase.toFixed(2)).toBe('100.00')
    } finally {
      await prisma.product.update({ where: { slug: SLUG_A }, data: { price: '100.00' } })
    }
  })

  it('self pickup ships free and is NOT reported as earned free shipping', async () => {
    await cartWith(userId, SLUG_A, 1)
    const result = await createOrder(prisma, {
      userId, idempotencyKey: 'key-pickup', deliveryMethod: 'self_pickup', address: null,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.shippingCost).toBe('0.00')
    expect(result.totalAmount).toBe('100.00')
  })

  it('the ₪249 threshold is measured on the goods, and ₪249 exactly ships free', async () => {
    // 🔴 The BOUNDARY. DEC-058 says "₪249 or more", so exactly ₪249 is free —
    // an off-by-one here charges ₪30 to the shopper who hit the number.
    await prisma.product.update({ where: { slug: SLUG_B }, data: { price: '249.00' } })
    try {
      await cartWith(userId, SLUG_B, 1)
      const result = await createOrder(prisma, {
        userId, idempotencyKey: 'key-boundary', deliveryMethod: 'courier', address: ADDRESS,
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.shippingCost).toBe('0.00')
      expect(result.totalAmount).toBe('249.00')
    } finally {
      await prisma.product.update({ where: { slug: SLUG_B }, data: { price: '25.50' } })
    }
  })
})

describe('TEST-044b — INV-01 atomicity, and REQ-F-045 seen from the shopper', () => {
  it('🔴 short stock creates NO order, touches NO stock, and PRESERVES the cart', async () => {
    await setStock(SLUG_A, 1)
    const cartId = await cartWith(userId, SLUG_A, 5)

    const result = await createOrder(prisma, {
      userId, idempotencyKey: 'key-short', deliveryMethod: 'courier', address: ADDRESS,
    })

    // ⚠️ REPORTED BY THE PRE-CHECK, NOT BY THE DECREMENT — and the difference
    // is deliberate. `unpurchasable` compares against the LINE'S QUANTITY, the
    // same rule the cart uses, so a cart the cart already called blocking is
    // refused before a single row is written, and EVERY offending line is named
    // at once. Reporting it from the decrement instead named one line per
    // attempt, so a shopper with three short lines fixed one, retried, failed
    // on the next, three times over.
    // 🔴 SHORT_STOCK, not SOLD_OUT — there is 1 on the shelf. "Sold out" would
    // send the shopper to REMOVE the line; `available` tells them the move that
    // actually works, which is to ask for 1.
    expect(result).toEqual({
      ok: false,
      reason: 'UNPURCHASABLE_LINE',
      lines: [{ slug: SLUG_A, why: 'SHORT_STOCK', available: 1 }],
    })
    expect(await stockOf(SLUG_A)).toBe(1)
    expect(await prisma.order.count({ where: { userId } })).toBe(0)
    expect(await prisma.cartItem.count({ where: { cartId } })).toBe(1)
  })

  it('a multi-line cart with one short line is refused BEFORE any write', async () => {
    // ⚠️ RENAMED, BECAUSE IT NO LONGER TESTS WHAT IT SAID. This was "a SECOND
    // line failing rolls the FIRST line's decrement back". Once `unpurchasable`
    // became quantity-aware the pre-check refuses this setup before a single
    // row is written, so `stockOf(SLUG_A) === 50` passes because nothing was
    // decremented — not because a decrement was undone.
    // 🔴 The rollback it used to cover now lives in the seam test above, which
    // uses a two-line cart for exactly this reason.
    await setStock(SLUG_A, 50)
    await setStock(SLUG_B, 1)
    const cart = await cartWith(userId, SLUG_A, 2)
    const productB = await prisma.product.findUniqueOrThrow({ where: { slug: SLUG_B }, select: { id: true } })
    await prisma.cartItem.create({ data: { cartId: cart, productId: productB.id, quantity: 5 } })

    const result = await createOrder(prisma, {
      userId, idempotencyKey: 'key-partial', deliveryMethod: 'courier', address: ADDRESS,
    })

    // Both lines are reported together — see the note above. The first line is
    // fine, so only the second is named.
    expect(result).toEqual({
      ok: false,
      reason: 'UNPURCHASABLE_LINE',
      lines: [{ slug: SLUG_B, why: 'SHORT_STOCK', available: 1 }],
    })
    expect(await stockOf(SLUG_A)).toBe(50)
    expect(await stockOf(SLUG_B)).toBe(1)
    expect(await prisma.order.count({ where: { userId } })).toBe(0)
    expect(await prisma.cartItem.count({ where: { cartId: cart } })).toBe(2)
  })

  it('🔴 INV-01 — stock vanishing AFTER the pre-check is caught by the guarded write', async () => {
    // 🔴 THIS IS THE ONLY TEST THAT REACHES INV-01'S GUARD, and it exists
    // because its absence was MEASURED: once `unpurchasable` became
    // quantity-aware, the pre-check caught every short-stock case the other
    // tests set up, and deleting `stockQuantity: { gte }` from the decrement's
    // WHERE left ALL 21 TESTS GREEN. The invariant this milestone is built
    // around was guarded by nothing a test could see.
    //
    // The seam lets the test stand exactly where the race would: the pre-check
    // has passed (stock 5 >= 5), and stock then drops before the write.
    // 🔴 TWO LINES, AND THE SECOND ONE IS THE POINT. A single-line cart proves
    // the guard fires; it does NOT prove the transaction rolls back a decrement
    // that already succeeded. The decrement loop walks the cart by productId
    // ascending, so the first line's stock is taken BEFORE the second line
    // fails — and if the rollback were not real, that first product would be
    // left short by an order which does not exist.
    //
    // 🔴 WHICH SLUG SORTS FIRST IS DECIDED AT RUNTIME, NOT ASSUMED, and this
    // test used to assume it. `productId` is a random UUID and the fixtures are
    // dropped and recreated by `afterAll`, so the ordering was a fresh coin flip
    // every run. On the half of runs where the VANISHING line sorted first, the
    // loop failed on its very first `updateMany`, the other product was never
    // decremented, and `stockOf(...) === 5` passed because nothing had happened
    // rather than because a decrement was undone — the exact vacuous shape this
    // file already documents twice, reached a third way.
    //


    // Sort the two fixtures the way the loop will, then make the SECOND one
    // vanish. The first is now guaranteed to be decremented before the failure.
    const ids = await prisma.product.findMany({
      where: { slug: { in: [SLUG_A, SLUG_B] } },
      select: { id: true, slug: true },
      orderBy: { id: 'asc' },
    })
    const [firstLine, vanishingLine] = ids
    if (!firstLine || !vanishingLine) throw new Error('both fixtures must exist')
    //
    // ⚠️ This case USED to be covered by "a SECOND line failing rolls the FIRST
    // line's decrement back". It is not any more: once `unpurchasable` became
    // quantity-aware, that setup is refused by the pre-check before a single
    // write, so its `stockOf(SLUG_A) === 50` now passes because nothing was
    // decremented rather than because a decrement was undone. Same shape as the
    // vacuous oversell test earlier in this file, one layer out.
    await setStock(SLUG_A, 5)
    await setStock(SLUG_B, 5)
    const cartId = await cartWith(userId, firstLine.slug, 5)
    await prisma.cartItem.create({ data: { cartId, productId: vanishingLine.id, quantity: 5 } })

    const result = await createOrder(
      prisma,
      { userId, idempotencyKey: 'key-vanish', deliveryMethod: 'self_pickup', address: null },
      // Both lines pass the pre-check at stock 5. Only the SECOND one vanishes.
      { afterPrecheck: async () => { await setStock(vanishingLine.slug, 1) } },
    )

    // The guard matched nothing for the second line, so the WHOLE transaction
    // rolled back.
    expect(result).toEqual({ ok: false, reason: 'INSUFFICIENT_STOCK', slug: vanishingLine.slug })
    expect(await prisma.order.count({ where: { userId } })).toBe(0)
    // 🔴 THE ASSERTION THAT NEEDS THE ROLLBACK: the first line WAS decremented
    // inside this transaction and is back at 5. Without the rollback it reads 0.
    expect(await stockOf(firstLine.slug)).toBe(5)
    // The second is where the interloper left it — untouched by us.
    expect(await stockOf(vanishingLine.slug)).toBe(1)
    // REQ-F-045 from the shopper's side: the cart is preserved, both lines.
    expect(await prisma.cartItem.count({ where: { cartId } })).toBe(2)
  })

  it('🔴 a product WITHDRAWN after the pre-check is caught by the guarded write too', async () => {
    // The decrement's WHERE carries `isActive: true` beside the stock guard,
    // and the catch re-reads to tell the two causes apart — 🔴 and NOTHING
    // exercised either. The seam was used only for stock, so `isActive: true`
    // and the whole WithdrawnMidFlightError path could be deleted with the
    // suite staying green: the identical measured hole that justified building
    // the seam in the first place.
    await setStock(SLUG_A, 10)
    const cartId = await cartWith(userId, SLUG_A, 2)

    const result = await createOrder(
      prisma,
      { userId, idempotencyKey: 'key-withdraw-race', deliveryMethod: 'self_pickup', address: null },
      {
        afterPrecheck: async () => {
          await prisma.product.update({ where: { slug: SLUG_A }, data: { isActive: false } })
        },
      },
    )

    // 🔴 Reported as WITHDRAWN, not as "insufficient stock" — there are 10 on
    // the shelf, and telling the shopper to reduce their quantity would send
    // them to the one action that cannot work.
    expect(result).toEqual({
      ok: false,
      reason: 'UNPURCHASABLE_LINE',
      lines: [{ slug: SLUG_A, why: 'WITHDRAWN', available: 0 }],
    })
    expect(await prisma.order.count({ where: { userId } })).toBe(0)
    expect(await stockOf(SLUG_A)).toBe(10)
    expect(await prisma.cartItem.count({ where: { cartId } })).toBe(1)
  })

  it('🔴 a concurrent QUANTITY EDIT is BLOCKED by the locking read, not detected after it', async () => {
    // 🔴 THE CASE THAT DEFEATED THREE COMPARISONS IN A ROW. `cartService`
    // updates a line IN PLACE, so a quantity edit keeps the row id: a count
    // check, an id check and an (id, quantity) check each missed a different
    // version of this. The locking read does not compare anything — it stops
    // the edit from happening while the order is being built.
    await setStock(SLUG_A, 50)
    const cartId = await cartWith(userId, SLUG_A, 2)
    let contention: Contention = 'not run'

    const result = await createOrder(
      prisma,
      { userId, idempotencyKey: 'key-qty-race', deliveryMethod: 'self_pickup', address: null },
      {
        afterPrecheck: async () => {
          contention = await contendForCartLines((tx) =>
            tx.cartItem.updateMany({ where: { cartId }, data: { quantity: 5 } }),
          )
        },
      },
    )

    // 🔴 THIS IS THE MUTATION PROOF, and it is the assertion to break on
    // purpose: delete `FOR UPDATE OF ci` from the locking read and this reads
    // `'applied'`. Every other assertion below stays green without the lock,
    // which is precisely why they are not the guard's evidence.
    expect(contention).toBe('blocked')

    // The checkout is unaffected — it was holding the row the whole time.
    expect(result.ok).toBe(true)
    const items = await prisma.orderItem.findMany({
      where: { order: { userId } },
      select: { quantity: true },
    })
    expect(items).toEqual([{ quantity: 2 }])
    // 🔴 The two units that were PRICED are the two that were SOLD. That
    // agreement is the whole point: the shopper is never charged for a quantity
    // the order does not contain, and never shipped one they never paid for.
    expect(await stockOf(SLUG_A)).toBe(48)
    expect(await prisma.cartItem.count({ where: { cartId } })).toBe(0)
  })

  it('two shoppers race for the last unit — one wins, stock never goes negative', async () => {
    // ⚠️ WHAT THIS TEST ACTUALLY PROVES, and it is NOT what its first version
    // claimed. It was written as "no overselling under concurrency" and
    // MUTATION-PROVING SHOWED IT PASSING WITH THE `gte` GUARD REMOVED — so it
    // was not testing the guard at all.
    //
    // The reason: the two transactions SERIALISE. The first commits, stock hits
    // 0, and the second is then stopped by the UNPURCHASABLE PRE-CHECK
    // (`stockQuantity <= 0` -> SOLD_OUT) before it ever reaches the decrement.
    // Real behaviour, worth pinning — but it is the pre-check's behaviour, not
    // INV-01's.
    //
    // 🔴 INV-01'S ATOMIC GUARD IS PROVED BY THE TWO SHORT-STOCK TESTS ABOVE,
    // which DO go red when the guard is removed: there the pre-check passes
    // (stock > 0) and only the guarded UPDATE can catch the shortfall. This
    // test is kept for the behaviour it really covers, renamed to say so.
    await setStock(SLUG_A, 1)
    await cartWith(userId, SLUG_A, 1)
    await cartWith(otherUserId, SLUG_A, 1)

    const [a, b] = await Promise.all([
      createOrder(prisma, { userId, idempotencyKey: 'race-1', deliveryMethod: 'self_pickup', address: null }),
      createOrder(prisma, { userId: otherUserId, idempotencyKey: 'race-2', deliveryMethod: 'self_pickup', address: null }),
    ])

    const winners = [a, b].filter((r) => r.ok)
    expect(winners).toHaveLength(1)
    // 🔴 The assertion that survives whichever way the two interleave: one unit
    // existed, one unit was sold, and stock never went below zero.
    expect(await stockOf(SLUG_A)).toBe(0)
    const loser = [a, b].find((r) => !r.ok)
    expect(loser).toBeDefined()
  })
})

describe('TEST-IDEM — INV-05, and DEC-049 requires BOTH layers', () => {
  it('001 — a sequential retry returns the SAME order and creates no second one', async () => {
    await cartWith(userId, SLUG_A, 1)
    const first = await createOrder(prisma, {
      userId, idempotencyKey: 'key-replay', deliveryMethod: 'self_pickup', address: null,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const second = await createOrder(prisma, {
      userId, idempotencyKey: 'key-replay', deliveryMethod: 'self_pickup', address: null,
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return

    expect(second.orderId).toBe(first.orderId)
    expect(second.replayed).toBe(true)
    expect(await prisma.order.count({ where: { userId } })).toBe(1)
    // 🔴 And the retry did NOT decrement stock a second time.
    expect(await stockOf(SLUG_A)).toBe(99)
  })

  it('002 — a DIFFERENT key is a different order', async () => {
    await cartWith(userId, SLUG_A, 1)
    const first = await createOrder(prisma, {
      userId, idempotencyKey: 'key-one', deliveryMethod: 'self_pickup', address: null,
    })
    await cartWith(userId, SLUG_A, 1)
    const second = await createOrder(prisma, {
      userId, idempotencyKey: 'key-two', deliveryMethod: 'self_pickup', address: null,
    })
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(second.orderId).not.toBe(first.orderId)
    expect(await prisma.order.count({ where: { userId } })).toBe(2)
  })

  it('🔴 003 — THE KEY IS SCOPED TO THE USER: another shopper reusing it gets THEIR OWN order', async () => {
    // The IDOR this constraint exists to make impossible. A GLOBAL unique made
    // the natural lookup `findUnique({ idempotencyKey })`, with no user filter,
    // so a key belonging to another shopper matched and the retry handed back
    // THEIR order. The key is client-supplied, so its value is chosen by them.
    await cartWith(userId, SLUG_A, 1)
    const mine = await createOrder(prisma, {
      userId, idempotencyKey: 'shared-key', deliveryMethod: 'self_pickup', address: null,
    })
    expect(mine.ok).toBe(true)
    if (!mine.ok) return

    await cartWith(otherUserId, SLUG_B, 1)
    const theirs = await createOrder(prisma, {
      userId: otherUserId, idempotencyKey: 'shared-key', deliveryMethod: 'self_pickup', address: null,
    })
    expect(theirs.ok).toBe(true)
    if (!theirs.ok) return

    expect(theirs.orderId).not.toBe(mine.orderId)
    expect(theirs.replayed).toBe(false)
    const theirOrder = await prisma.order.findUniqueOrThrow({
      where: { id: theirs.orderId }, select: { userId: true },
    })
    expect(theirOrder.userId).toBe(otherUserId)
  })

  it('004 — CONCURRENT retries produce ONE order, and the LOCK is what serialises them', async () => {
    // 🔴 RENAMED, BECAUSE THE MUTATION SAID SO — the third time in this file
    // that a test has been caught claiming a layer it does not reach.
    //
    // It was called "whichever layer answers", and its stated subject was the
    // database constraint: two requests carrying one key both find nothing
    // before either commits, so the unique index picks a winner. That was true
    // when the replay lookup ran before any lock. It is not true now. The
    // locking read makes the loser WAIT at the transaction's first statement,
    // so by the time it looks anything up the winner has committed and it
    // replays at layer one — `order.create` is never reached and the constraint
    // never fires.
    //
    // ⚠️ MEASURED, NOT REASONED. Disabling the P2002 catch leaves this test —
    // and all 30 in this file — GREEN. The old comment here claimed the
    // opposite ("disabling the P2002 catch turns this red") and cited a mutation
    // run BEFORE the lock reordering. A recorded result that is not re-run after
    // the code moves underneath it is not evidence any more.
    //
    // What this test does prove, and it is worth pinning: two concurrent
    // same-key requests yield exactly ONE order and one stock decrement.
    //
    // Repeating the race widens the window rather than closing it. Kept honest
    // instead of dressed up: what IS guaranteed is the invariant below — one
    // key, one order, one decrement, however the two interleave.
    await cartWith(userId, SLUG_A, 1)
    const [a, b] = await Promise.all([
      createOrder(prisma, { userId, idempotencyKey: 'concurrent', deliveryMethod: 'self_pickup', address: null }),
      createOrder(prisma, { userId, idempotencyKey: 'concurrent', deliveryMethod: 'self_pickup', address: null }),
    ])

    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    expect(a.orderId).toBe(b.orderId)
    expect(await prisma.order.count({ where: { userId } })).toBe(1)
    // 🔴 One order means ONE decrement. Two would be a silent oversell.
    expect(await stockOf(SLUG_A)).toBe(99)
  })
})

describe('DEC-059 answer 3 — "unpurchasable" is ONE condition with TWO causes', () => {
  it('a WITHDRAWN line blocks checkout and says why', async () => {
    await cartWith(userId, SLUG_A, 1)
    await prisma.product.update({ where: { slug: SLUG_A }, data: { isActive: false } })
    const result = await createOrder(prisma, {
      userId, idempotencyKey: 'key-withdrawn', deliveryMethod: 'self_pickup', address: null,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('UNPURCHASABLE_LINE')
    expect(result).toMatchObject({ lines: [{ slug: SLUG_A, why: 'WITHDRAWN' }] })
  })

  it('🔴 a SOLD-OUT line blocks checkout too — ISSUE-076, and the cause differs', async () => {
    await cartWith(userId, SLUG_A, 1)
    await setStock(SLUG_A, 0)
    const result = await createOrder(prisma, {
      userId, idempotencyKey: 'key-soldout', deliveryMethod: 'self_pickup', address: null,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('UNPURCHASABLE_LINE')
    // The two causes read differently to a shopper: one is gone for good, the
    // other may come back.
    expect(result).toMatchObject({ lines: [{ slug: SLUG_A, why: 'SOLD_OUT' }] })
  })

  it('🔴 a WITHDRAWN product reports available: 0 even with stock on the shelf', async () => {
    // `available` exists so a client can say "there are N — ask for fewer".
    // That sentence is only true for SHORT_STOCK. Reporting the raw shelf stock
    // for a withdrawn product sends the shopper to lower their quantity, which
    // cannot possibly work — and the two paths that report this same condition
    // disagreed: the pre-check said 10, the mid-flight catch said 0.
    await cartWith(userId, SLUG_A, 1)
    await setStock(SLUG_A, 10)
    await prisma.product.update({ where: { slug: SLUG_A }, data: { isActive: false } })

    const result = await createOrder(prisma, {
      userId, idempotencyKey: 'key-withdrawn-stocked', deliveryMethod: 'self_pickup', address: null,
    })
    expect(result).toEqual({
      ok: false,
      reason: 'UNPURCHASABLE_LINE',
      lines: [{ slug: SLUG_A, why: 'WITHDRAWN', available: 0 }],
    })
  })

  it('an empty cart is refused', async () => {
    const result = await createOrder(prisma, {
      userId, idempotencyKey: 'key-empty', deliveryMethod: 'self_pickup', address: null,
    })
    expect(result).toEqual({ ok: false, reason: 'EMPTY_CART' })
  })

  it('🔴 an empty cart AND a missing address reports the EMPTY CART', async () => {
    // The address rules used to run first, so this answered ADDRESS_REQUIRED —
    // sending the shopper to fix an address when the real blocker was that
    // there was nothing to buy. An error should name the step that actually
    // unblocks them.
    const result = await createOrder(prisma, {
      userId, idempotencyKey: 'key-empty-noaddr', deliveryMethod: 'courier', address: null,
    })
    expect(result).toEqual({ ok: false, reason: 'EMPTY_CART' })
  })

  it('🔴 an unknown delivery method is refused, not charged as courier', async () => {
    // Untrusted input: any other string falls through computeShipping's courier
    // path — ₪30 charged, threshold applied — and fails later at the Prisma
    // enum as a 500 rather than a refusal.
    await cartWith(userId, SLUG_A, 1)
    const result = await createOrder(prisma, {
      userId,
      idempotencyKey: 'key-badmethod',
      deliveryMethod: 'drone' as unknown as 'courier',
      address: ADDRESS,
    })
    expect(result).toEqual({ ok: false, reason: 'INVALID_DELIVERY_METHOD' })
    expect(await prisma.order.count({ where: { userId } })).toBe(0)
  })

  it('🔴 a key differing only in WHITESPACE is the same key', async () => {
    // Validated trimmed, then stored and looked up RAW: 'k7f2 ' and 'k7f2' were
    // two keys, so a retry from a proxy or a form that trims on resend created
    // a SECOND order with a second stock decrement.
    await cartWith(userId, SLUG_A, 1)
    const first = await createOrder(prisma, {
      userId, idempotencyKey: ' key-space ', deliveryMethod: 'self_pickup', address: null,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const retry = await createOrder(prisma, {
      userId, idempotencyKey: 'key-space', deliveryMethod: 'self_pickup', address: null,
    })
    expect(retry.ok).toBe(true)
    if (!retry.ok) return
    expect(retry.orderId).toBe(first.orderId)
    expect(retry.replayed).toBe(true)
    expect(await prisma.order.count({ where: { userId } })).toBe(1)
    expect(await stockOf(SLUG_A)).toBe(99)
  })
})

describe('the address rule — enforced in the service, and tested BOTH ways', () => {
  it('courier without an address is refused', async () => {
    await cartWith(userId, SLUG_A, 1)
    const result = await createOrder(prisma, {
      userId, idempotencyKey: 'key-noaddr', deliveryMethod: 'courier', address: null,
    })
    expect(result).toEqual({ ok: false, reason: 'ADDRESS_REQUIRED' })
  })

  it('🔴 self pickup WITH an address is refused — the other direction', async () => {
    // An address on a pickup order is a delivery address for a delivery that
    // will never happen. A one-sided check would pass this and store it.
    await cartWith(userId, SLUG_A, 1)
    const result = await createOrder(prisma, {
      userId, idempotencyKey: 'key-pickupaddr', deliveryMethod: 'self_pickup', address: ADDRESS,
    })
    expect(result).toEqual({ ok: false, reason: 'ADDRESS_NOT_ALLOWED' })
  })

  it('🔴 a PICKUP POINT is a delivery — it costs ₪30 and it REQUIRES an address', async () => {
    // The whole point of the method parameter is that a pickup POINT is not
    // self pickup: goods are still transported, to a locker or a shop. Until
    // this test existed, `pickup_point` was asserted NOWHERE — deleting the
    // enum member or making it behave like self_pickup would have left every
    // test green, which is the definition of an untested branch.
    await cartWith(userId, SLUG_A, 1)
    const refused = await createOrder(prisma, {
      userId, idempotencyKey: 'key-point-noaddr', deliveryMethod: 'pickup_point', address: null,
    })
    expect(refused).toEqual({ ok: false, reason: 'ADDRESS_REQUIRED' })

    const result = await createOrder(prisma, {
      userId, idempotencyKey: 'key-point', deliveryMethod: 'pickup_point', address: ADDRESS,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // ₪100 of goods is under ₪249, so it ships at ₪30 exactly like courier —
    // and NOT free, which is what self pickup would have given.
    expect(result.shippingCost).toBe('30.00')
    expect(result.totalAmount).toBe('130.00')
  })

  it('🔴 a BLANK idempotency key is refused, not accepted verbatim', async () => {
    // Accepting one is permanent rather than noisy: a browser without
    // `crypto.randomUUID` falls back to something that stringifies to '', the
    // first checkout writes it, and every LATER checkout by that shopper then
    // matches at readExisting and replays the first order. Nothing throws — the
    // cart simply stops working for that account, forever.
    // ⚠️ BLANK ONLY. A first version also refused keys shorter than 8
    // characters and immediately rejected two legitimate keys elsewhere in this
    // file — the floor telling on itself. The defect is a key that identifies
    // NOTHING, not a key that is short, and picking a length would be inventing
    // a policy the client never agreed to.
    await cartWith(userId, SLUG_A, 1)
    for (const key of ['', '   ', '\t\n']) {
      expect(
        await createOrder(prisma, {
          userId, idempotencyKey: key, deliveryMethod: 'self_pickup', address: null,
        }),
      ).toEqual({ ok: false, reason: 'INVALID_IDEMPOTENCY_KEY' })
    }
    // Nothing was written by any of them.
    expect(await prisma.order.count({ where: { userId } })).toBe(0)
  })

  it('🔴 an OVERSIZED idempotency key is refused, not handed to the btree index', async () => {
    // 🔴 THE FAILURE THIS PREVENTS IS A 500, NOT A WRONG ANSWER. The key is a
    // column in `orders_user_id_idempotency_key_key`, and a btree row cannot
    // exceed 2704 bytes. A longer key fails the INSERT with SQLSTATE 54000,
    // which is NOT a unique violation — so neither matcher in the catch sees it
    // and the shopper gets a 500 on every attempt with that key.
    await cartWith(userId, SLUG_A, 1)

    // 🔴 RANDOM, NOT `'k'.repeat(3000)`, AND THE FIRST VERSION OF THIS TEST GOT
    // IT WRONG. btree index tuples are COMPRESSED, and three thousand identical
    // characters compress to nothing — measured: that key INSERTS cleanly with
    // the length check removed, so the test would have passed its own mutation
    // while never reaching the failure it names. Random hex does not compress:
    // measured `index row size 3016 exceeds btree version 4 maximum 2704`.
    const incompressible = randomBytes(1500).toString('hex')
    expect(incompressible.length).toBe(3000)
    expect(
      await createOrder(prisma, {
        userId, idempotencyKey: incompressible, deliveryMethod: 'self_pickup', address: null,
      }),
    ).toEqual({ ok: false, reason: 'INVALID_IDEMPOTENCY_KEY' })

    // ⚠️ THE OTHER CONTROL, and it is the one that stops this from becoming a
    // check that rejects everything. A key at the limit must still WORK — a cap
    // that quietly refused ordinary keys would look like diligence and cost
    // real checkouts.
    const atLimit = await createOrder(prisma, {
      userId, idempotencyKey: 'k'.repeat(200), deliveryMethod: 'self_pickup', address: null,
    })
    expect(atLimit.ok).toBe(true)
  })

  it('🔴 a retry whose DELIVERY METHOD is mangled still replays — the key answers, not the payload', async () => {
    // 🔴 THE COST OF GETTING THIS WRONG IS A SECOND STOCK DECREMENT. The first
    // request placed the order and its response was lost. The retry carries a
    // delivery method mangled in transit, or re-derived by a client whose form
    // had reset. Refusing it tells the shopper their delivery method is invalid
    // for an order that already exists — and a client that reacts to a refusal
    // by minting a fresh key places a SECOND order and decrements stock again.
    //
    // The address rule was moved inside the transaction for exactly this
    // reason; the delivery-method check had been left outside it.
    await setStock(SLUG_A, 10)
    await cartWith(userId, SLUG_A, 2)
    const first = await createOrder(prisma, {
      userId, idempotencyKey: 'key-mangled-method', deliveryMethod: 'courier', address: ADDRESS,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(await stockOf(SLUG_A)).toBe(8)

    const retry = await createOrder(prisma, {
      userId,
      idempotencyKey: 'key-mangled-method',
      deliveryMethod: 'COURIER ' as never,
      address: ADDRESS,
    })

    expect(retry.ok).toBe(true)
    if (!retry.ok) return
    expect(retry.orderId).toBe(first.orderId)
    expect(retry.replayed).toBe(true)
    // 🔴 The assertion that names the real damage: stock moved ONCE.
    expect(await stockOf(SLUG_A)).toBe(8)
    expect(await prisma.order.count({ where: { userId } })).toBe(1)

    // ⚠️ THE CONTROL. The check must still REFUSE a bad method on a key that
    // has no order behind it — otherwise this fix would have deleted the rule
    // rather than moved it.
    expect(
      await createOrder(prisma, {
        userId, idempotencyKey: 'key-fresh-bad-method', deliveryMethod: 'COURIER ' as never, address: ADDRESS,
      }),
    ).toEqual({ ok: false, reason: 'INVALID_DELIVERY_METHOD' })
  })

  it('🔴 a concurrent SWAP is half-stopped: the locked line cannot move, the ADDED line is untouched', async () => {
    // 🔴 THE TWO HALVES OF A SWAP ARE NOT SYMMETRIC, and this is the test that
    // says so. `FOR UPDATE` locks rows that EXIST, so the other tab's REMOVAL
    // of X waits — but its INSERT of Y does not, and nothing can make it. The
    // right answer is therefore not "refuse the checkout": it is to order
    // exactly the locked lines and leave the new one alone.
    await setStock(SLUG_A, 50)
    await setStock(SLUG_B, 50)
    const cartId = await cartWith(userId, SLUG_A, 1)
    const productA = await prisma.product.findUniqueOrThrow({ where: { slug: SLUG_A }, select: { id: true } })
    const productB = await prisma.product.findUniqueOrThrow({ where: { slug: SLUG_B }, select: { id: true } })
    let removal: Contention = 'not run'

    const result = await createOrder(
      prisma,
      { userId, idempotencyKey: 'key-swap-race', deliveryMethod: 'self_pickup', address: null },
      {
        // The other tab: add a different line, then remove the one being
        // ordered. The add lands; the remove hits the lock.
        afterPrecheck: async () => {
          await prisma.cartItem.create({ data: { cartId, productId: productB.id, quantity: 1 } })
          removal = await contendForCartLines((tx) =>
            tx.cartItem.deleteMany({ where: { cartId, productId: productA.id } }),
          )
        },
      },
    )

    // 🔴 THE MUTATION PROOF. Remove `FOR UPDATE OF ci` and this reads
    // `'applied'` — the removal wins, and the order ships a line the shopper
    // had already taken out of the cart.
    expect(removal).toBe('blocked')

    expect(result.ok).toBe(true)
    // The order holds ONLY the locked line. Y was added after the lock, so it
    // was never read, never priced and never charged.
    const items = await prisma.orderItem.findMany({
      where: { order: { userId } },
      select: { productId: true },
    })
    expect(items).toEqual([{ productId: productA.id }])
    expect(await stockOf(SLUG_A)).toBe(49)
    expect(await stockOf(SLUG_B)).toBe(50)
    // 🔴 And Y SURVIVES IN THE CART. A `deleteMany({ cartId })` on success would
    // have destroyed it — a line the shopper added, never ordered and never
    // paid for. The clearing delete names the locked ids for exactly this.
    const remaining = await prisma.cartItem.findMany({ where: { cartId }, select: { productId: true } })
    expect(remaining).toEqual([{ productId: productB.id }])
  })

  it('🔴 an address of empty strings is NOT an address', async () => {
    // `{ line1: '', city: '' }` is a present object, so a presence check
    // accepts it and freezes a blank delivery address onto the order forever —
    // and this module is billed as enforcing the rule itself.
    await cartWith(userId, SLUG_A, 1)
    const result = await createOrder(prisma, {
      userId, idempotencyKey: 'key-blank', deliveryMethod: 'courier',
      address: { line1: '   ', city: '', zipCode: null },
    })
    expect(result).toEqual({ ok: false, reason: 'ADDRESS_REQUIRED' })
  })

  it('🔴 a retry is answered by its KEY, even when the payload changed shape', async () => {
    // Validation used to run BEFORE the replay lookup, so a client that trimmed
    // its payload on resend got ADDRESS_REQUIRED instead of the order it had
    // already placed. An idempotent operation must answer the same key the same
    // way, whatever the rest of the request says.
    await cartWith(userId, SLUG_A, 1)
    const first = await createOrder(prisma, {
      userId, idempotencyKey: 'key-shape', deliveryMethod: 'courier', address: ADDRESS,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const retry = await createOrder(prisma, {
      userId, idempotencyKey: 'key-shape', deliveryMethod: 'courier', address: null,
    })
    expect(retry.ok).toBe(true)
    if (!retry.ok) return
    expect(retry.orderId).toBe(first.orderId)
    expect(retry.replayed).toBe(true)
  })

  it('the delivery address is COPIED onto the order, not referenced', async () => {
    await cartWith(userId, SLUG_A, 1)
    const result = await createOrder(prisma, {
      userId, idempotencyKey: 'key-addr', deliveryMethod: 'courier', address: ADDRESS,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: result.orderId },
      select: { shippingLine1: true, shippingCity: true, shippingZipCode: true, deliveryMethod: true },
    })
    expect(order).toEqual({
      shippingLine1: ADDRESS.line1,
      shippingCity: ADDRESS.city,
      shippingZipCode: ADDRESS.zipCode,
      deliveryMethod: 'courier',
    })
  })
})

describe('the money is computed in agorot, not floats', () => {
  it('a quantity that would drift as a float does not', async () => {
    // 25.50 x 3 = 76.50. In float arithmetic 25.5 * 3 is 76.5 exactly, but
    // 0.1 + 0.2 style drift appears as soon as sums accumulate — this pins the
    // integer path rather than trusting it.
    await cartWith(userId, SLUG_B, 3)
    const result = await createOrder(prisma, {
      userId, idempotencyKey: 'key-money', deliveryMethod: 'self_pickup', address: null,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.totalAmount).toBe('76.50')
    expect(toAgorot('76.50')).toBe(7650)
  })
})
