import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { haltWithCurrentState } from './checkout.js'
import { TEST_FIXTURE_SLUG_PREFIX } from '../lib/testFixturePrefix.js'

/**
 * The shape of a halt raised INSIDE `createOrder`'s transaction.
 *
 * 🔴 THIS FILE EXISTS BECAUSE THE HTTP TEST COULD NOT REACH THAT PATH, and
 * mutation is what proved it: replacing `haltWithCurrentState` with the old
 * pass-through left the integration test green. `setStock` there runs before
 * the request, so the route's step-1 re-quote halts first and the transaction
 * is never entered. Reaching the real window needs a change landing between the
 * route's lock-free re-quote and the transaction's locks, and the route exposes
 * no seam to stand in.
 *
 * ⚠️ So the RESPONSE SHAPER is tested directly rather than left uncovered. That
 * is the whole of what the finding was about: a halt from the transaction
 * arrived without the `quote` step 2 documents and without the `lineId`
 * `/validate` carries, so a client written to either contract broke on exactly
 * the path a shopper reaches when stock moves mid-checkout.
 */

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
})

const SLUG = `${TEST_FIXTURE_SLUG_PREFIX}halt-shape`
const EMAIL = 'zz-halttest@example.test'
let userId = ''

/** The two fields the helper touches, captured instead of sent. */
function fakeResponse() {
  const captured: { status?: number; body?: Record<string, unknown> } = {}
  const res = {
    status(code: number) {
      captured.status = code
      return this
    },
    json(body: Record<string, unknown>) {
      captured.body = body
      return this
    },
  }
  return { res: res as never, captured }
}

async function cartWith(quantity: number): Promise<void> {
  const product = await prisma.product.findUniqueOrThrow({ where: { slug: SLUG }, select: { id: true } })
  const cart = await prisma.cart.upsert({
    where: { userId }, create: { userId }, update: {}, select: { id: true },
  })
  await prisma.cartItem.upsert({
    where: { cartId_productId: { cartId: cart.id, productId: product.id } },
    create: { cartId: cart.id, productId: product.id, quantity },
    update: { quantity },
    select: { id: true },
  })
}

async function wipe(): Promise<void> {
  const carts = await prisma.cart.findMany({ where: { user: { email: EMAIL } }, select: { id: true } })
  if (carts.length > 0) {
    const ids = carts.map((c) => c.id)
    await prisma.cartItem.deleteMany({ where: { cartId: { in: ids } } })
    await prisma.cart.deleteMany({ where: { id: { in: ids } } })
  }
}

beforeAll(async () => {
  const seeded = await prisma.product.findFirstOrThrow({
    where: { isActive: true }, select: { categoryId: true, brandId: true },
  })
  await prisma.product.upsert({
    where: { slug: SLUG },
    create: {
      slug: SLUG, nameHe: 'בדיקת עצירה', nameEn: 'Halt test',
      categoryId: seeded.categoryId, brandId: seeded.brandId,
      dosageForm: 'CAPSULE', packageQuantity: 60, usageInstructions: 'בדיקה',
      price: '50.00', stockQuantity: 100,
      descriptionHe: 'בדיקה', descriptionEn: 'test', warningsAllergens: '',
      isActive: true,
    },
    update: { price: '50.00', stockQuantity: 100, isActive: true },
    select: { id: true },
  })
  await prisma.user.upsert({
    where: { email: EMAIL },
    create: {
      email: EMAIL, firstName: 'Halt', lastName: 'Test',
      passwordHash: 'x', termsAcceptedAt: new Date(),
    },
    update: {},
    select: { id: true },
  })
  userId = (await prisma.user.findUniqueOrThrow({ where: { email: EMAIL }, select: { id: true } })).id
})

afterEach(async () => {
  await wipe()
  await prisma.product.update({ where: { slug: SLUG }, data: { stockQuantity: 100, isActive: true } })
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

describe('🔴 a halt always carries something the client can act on', () => {
  it('a blocked line comes back WITH its lineId — the same shape /validate sends', async () => {
    await cartWith(5)
    await prisma.product.update({ where: { slug: SLUG }, data: { stockQuantity: 2 } })
    const line = await prisma.cartItem.findFirstOrThrow({
      where: { cart: { userId } }, select: { id: true },
    })

    const { res, captured } = fakeResponse()
    await haltWithCurrentState(res, prisma, userId, 'courier', 'INSUFFICIENT_STOCK')

    expect(captured.status).toBe(409)
    const error = captured.body?.error as { code: string; lines?: { lineId: string }[] }
    expect(error.code).toBe('UNPURCHASABLE_LINE')
    // 🔴 THE POINT OF THE FINDING. ISSUE-080 is that a client must be able to
    // point at the offending ROW; passing `orderService`'s answer through gave
    // the same code with no id on it.
    expect(error.lines?.[0]?.lineId).toBe(line.id)
    // The transaction's own reason survives for a support log, even though the
    // current state may describe it differently.
    expect(captured.body?.haltedBy).toBe('INSUFFICIENT_STOCK')
  })

  it('🔴 when the world has RECOVERED, it still halts — with a fresh QUOTE', async () => {
    // The condition that stopped the transaction can clear before this runs
    // (another shopper's order rolled back, stock restored). That is not
    // success: something moved under a confirmed checkout, so the shopper
    // re-confirms against the new figures.
    await cartWith(1)

    const { res, captured } = fakeResponse()
    await haltWithCurrentState(res, prisma, userId, 'courier', 'CHECKOUT_CHANGED')

    expect(captured.status).toBe(409)
    expect((captured.body?.error as { code: string }).code).toBe('CHECKOUT_CHANGED')
    // 🔴 THE OTHER HALF OF THE FINDING: step 2's halt documents a `quote`, and
    // this path returned none, so a client doing `body.quote.totalAmount` got a
    // TypeError on exactly this response.
    const quote = captured.body?.quote as { totalAmount: string; fingerprint: string }
    expect(quote.totalAmount).toBe('80.00') // ₪50 goods + ₪30 shipping
    expect(quote.fingerprint).toMatch(/^[0-9a-f]{64}$/)
  })

  it('an emptied cart halts as EMPTY_CART rather than pretending to quote', async () => {
    const { res, captured } = fakeResponse()
    await haltWithCurrentState(res, prisma, userId, 'courier', 'CHECKOUT_CHANGED')

    expect(captured.status).toBe(409)
    expect((captured.body?.error as { code: string }).code).toBe('EMPTY_CART')
    expect(captured.body?.quote).toBeUndefined()
  })
})
