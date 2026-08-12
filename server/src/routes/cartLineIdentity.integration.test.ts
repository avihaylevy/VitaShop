import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { addItem, deleteLine, getCart, updateLine } from '../lib/cartService.js'

/**
 * MILESTONE-007 Checkpoint G — 🔴 THE DTO IS THE ONLY THING A CLIENT CAN SEE.
 *
 * Checkpoint D's suite proves `updateLine`/`deleteLine` work. It does NOT prove
 * a client can REACH them, because every one of its cases reads the line id
 * straight out of Prisma:
 *
 *   const cart = await prisma.cartItem.findFirst({ ... select: { id: true } })
 *
 * That is both sides of the identifier supplied by the test — the exact shape
 * that let Checkpoints E and F ship INERT (ISSUE-069). The DTO carried no `id`
 * at all, so `PATCH`/`DELETE /api/cart/items/:id` were unaddressable from any
 * real client, and every server test passed.
 *
 * 🔴 EVERY ASSERTION BELOW TAKES THE ID FROM `getCart`'s DTO AND NOWHERE ELSE.
 * Removing `id` from `CartLineDto` must make this file fail to compile or fail
 * to run — that is what it is for. It reaches Prisma only to WIPE.
 */

let prisma: PrismaClient
const OWNER = 'zz-carttest-g-owner'
const STRANGER = 'zz-carttest-g-stranger'
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

/** One line in the owner's cart, and its id AS THE DTO REPORTS IT. */
async function seedAndReadLineIdFromDto(quantity = 2): Promise<string> {
  await wipe()
  await addItem(prisma, { guestCartId: OWNER }, LOW_STOCK_3, quantity)
  const dto = await getCart(prisma, { guestCartId: OWNER })
  const id = dto.items[0]?.id
  if (!id) throw new Error('the cart DTO exposed no line id — a client cannot address PATCH or DELETE')
  return id
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

describe('🔴 the id a client reads from the DTO is the id the routes accept', () => {
  it('PATCH addressed with the DTO id actually changes that line', async () => {
    const lineId = await seedAndReadLineIdFromDto(2)

    const result = await updateLine(prisma, { guestCartId: OWNER }, lineId, 3)

    expect(result.ok).toBe(true)
    expect(result.ok && result.quantity).toBe(3)
    // Read back through the DTO too — the round trip is the claim.
    const after = await getCart(prisma, { guestCartId: OWNER })
    expect(after.items[0]?.quantity).toBe(3)
    expect(after.items[0]?.id).toBe(lineId)
  })

  it('DELETE addressed with the DTO id actually removes that line', async () => {
    const lineId = await seedAndReadLineIdFromDto(1)

    const result = await deleteLine(prisma, { guestCartId: OWNER }, lineId)

    expect(result.ok && result.removed).toBe(true)
    expect((await getCart(prisma, { guestCartId: OWNER })).items).toEqual([])
  })

  it('🔴 the id is STABLE across reads — a client may hold it between renders', async () => {
    const first = await seedAndReadLineIdFromDto(1)
    const second = (await getCart(prisma, { guestCartId: OWNER })).items[0]?.id
    expect(second).toBe(first)
  })

  it('🔴 a STRANGER cannot use an id they read from their own DTO against the owner', async () => {
    const ownerLine = await seedAndReadLineIdFromDto(1)

    // The stranger's own cart, and its own line id — nothing borrowed.
    await addItem(prisma, { guestCartId: STRANGER }, LOW_STOCK_3, 1)
    const strangerLine = (await getCart(prisma, { guestCartId: STRANGER })).items[0]?.id
    expect(strangerLine).toBeDefined()
    expect(strangerLine).not.toBe(ownerLine)

    // The owner's id, presented by the stranger: absent, not forbidden.
    const stolen = await updateLine(prisma, { guestCartId: STRANGER }, ownerLine, 5)
    expect(stolen).toEqual({ ok: false, reason: 'LINE_NOT_FOUND' })

    // And the owner's line is untouched.
    const owner = await getCart(prisma, { guestCartId: OWNER })
    expect(owner.items[0]?.quantity).toBe(1)
  })
})

describe('🔴 the DTO carries what the cart row RENDERS, live from the product', () => {
  it('brand, package quantity and the low-stock threshold are present and are the product row', async () => {
    await seedAndReadLineIdFromDto(1)
    const line = (await getCart(prisma, { guestCartId: OWNER })).items[0]

    const product = await prisma.product.findFirst({
      where: { slug: LOW_STOCK_3 },
      select: { packageQuantity: true, lowStockThreshold: true, brand: { select: { name: true } } },
    })
    if (!product) throw new Error(`fixture assumption failed: ${LOW_STOCK_3} is not seeded`)

    // 🔴 Compared against the DATABASE, not against a literal. A literal here
    // would pass with the join deleted and a hardcoded default returned.
    expect(line?.brandName).toBe(product.brand.name)
    expect(line?.packageQuantity).toBe(product.packageQuantity)
    expect(line?.lowStockThreshold).toBe(product.lowStockThreshold)
    expect(line?.brandName?.length).toBeGreaterThan(0)
  })
})
