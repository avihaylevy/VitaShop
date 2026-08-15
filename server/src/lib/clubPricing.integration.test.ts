import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getCart } from './cartService.js'
import { quoteCheckout } from './checkoutService.js'
import { createOrder } from './orderService.js'
import { TEST_FIXTURE_SLUG_PREFIX } from './testFixturePrefix.js'

/**
 * MILESTONE-012 Checkpoint A — DEC-086's club pricing, against a real
 * database, across ALL THREE seams at once: the cart DTO, the checkout
 * quote, and the order freeze.
 *
 * 🔴 THE LOAD-BEARING TEST IS THE FINGERPRINT ROUND-TRIP: the quote prices
 * from the cart DTO while createOrder RE-DERIVES from live product rows.
 * A member placing an order with the quote's own fingerprint proves the two
 * sides applied the SAME discount — a one-sided discount fails it with
 * CHECKOUT_CHANGED, which is exactly how the mutation control below goes
 * red. Own fixtures, TEST_FIXTURE_SLUG_PREFIX, single-threaded (DEC-057).
 */

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
})

const SLUG = `${TEST_FIXTURE_SLUG_PREFIX}club-a`
const MEMBER_EMAIL = 'zz-clubtest-member@example.test'
const PLAIN_EMAIL = 'zz-clubtest-plain@example.test'

let memberId = ''
let plainId = ''

async function wipe(): Promise<void> {
  const orders = await prisma.order.findMany({
    where: { user: { email: { in: [MEMBER_EMAIL, PLAIN_EMAIL] } } },
    select: { id: true },
  })
  if (orders.length > 0) {
    const ids = orders.map((o) => o.id)
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: ids } } })
    await prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } })
    await prisma.order.deleteMany({ where: { id: { in: ids } } })
  }
  const carts = await prisma.cart.findMany({
    where: { user: { email: { in: [MEMBER_EMAIL, PLAIN_EMAIL] } } },
    select: { id: true },
  })
  if (carts.length > 0) {
    const ids = carts.map((c) => c.id)
    await prisma.cartItem.deleteMany({ where: { cartId: { in: ids } } })
    await prisma.cart.deleteMany({ where: { id: { in: ids } } })
  }
}

async function cartWith(userId: string, quantity: number): Promise<void> {
  const product = await prisma.product.findUniqueOrThrow({ where: { slug: SLUG }, select: { id: true } })
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
}

beforeAll(async () => {
  const seeded = await prisma.product.findFirstOrThrow({
    where: { isActive: true },
    select: { categoryId: true, brandId: true },
  })

  // 🔴 ₪94.90 IS CHOSEN so the member price needs real rounding:
  // 9490 agorot * 0.9 = 8541 -> ₪85.41 — a value no float path lands on by
  // accident, which is what makes the equality assertions below sharp.
  await prisma.product.upsert({
    where: { slug: SLUG },
    create: {
      slug: SLUG, nameHe: `בדיקה ${SLUG}`, nameEn: `Test ${SLUG}`,
      categoryId: seeded.categoryId, brandId: seeded.brandId,
      dosageForm: 'CAPSULE', packageQuantity: 60,
      usageInstructions: 'בדיקה', price: '94.90', stockQuantity: 100,
      descriptionHe: 'בדיקה', descriptionEn: 'test', warningsAllergens: '',
      isActive: true,
    },
    update: { price: '94.90', stockQuantity: 100, isActive: true },
    select: { id: true },
  })

  for (const [email, isClubMember] of [
    [MEMBER_EMAIL, true],
    [PLAIN_EMAIL, false],
  ] as const) {
    await prisma.user.upsert({
      where: { email },
      create: {
        email, firstName: 'Test', lastName: 'Club',
        passwordHash: 'x', termsAcceptedAt: new Date(), isClubMember,
        clubJoinedAt: isClubMember ? new Date() : null,
      },
      update: { isClubMember },
      select: { id: true },
    })
  }
  memberId = (await prisma.user.findUniqueOrThrow({ where: { email: MEMBER_EMAIL }, select: { id: true } })).id
  plainId = (await prisma.user.findUniqueOrThrow({ where: { email: PLAIN_EMAIL }, select: { id: true } })).id
})

afterEach(async () => {
  await wipe()
  await prisma.user.update({ where: { id: memberId }, data: { isClubMember: true } })
})

afterAll(async () => {
  try {
    await wipe()
    await prisma.product.deleteMany({ where: { slug: SLUG } })
    await prisma.user.deleteMany({ where: { email: { in: [MEMBER_EMAIL, PLAIN_EMAIL] } } })
  } finally {
    await prisma.$disconnect()
  }
})

describe('DEC-086 — club pricing across the three seams', () => {
  it('the cart DTO prices a member line at 10% off, integer-agorot exact', async () => {
    await cartWith(memberId, 2)
    const cart = await getCart(prisma, { userId: memberId, guestCartId: undefined })
    expect(cart.items[0]!.unitPrice).toBe('85.41')
    expect(cart.items[0]!.lineTotal).toBe('170.82')
    expect(cart.subtotal).toBe('170.82')
  })

  it('🔴 CONTROL — a non-member and a guest pay the stored price byte-for-byte', async () => {
    await cartWith(plainId, 2)
    const plain = await getCart(prisma, { userId: plainId, guestCartId: undefined })
    expect(plain.items[0]!.unitPrice).toBe('94.90')
    expect(plain.subtotal).toBe('189.80')
  })

  it('the checkout quote inherits the member price, and the shipping basis measures the DISCOUNTED spend', async () => {
    await cartWith(memberId, 2)
    const result = await quoteCheckout(prisma, { userId: memberId, deliveryMethod: 'courier' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.quote.lines[0]!.unitPrice).toBe('85.41')
    expect(result.quote.basis).toBe('170.82')
  })

  it('🔴 THE ROUND-TRIP — a member order placed with the quote fingerprint SUCCEEDS, and INV-02 freezes the DISCOUNTED price', async () => {
    await cartWith(memberId, 2)
    const quoted = await quoteCheckout(prisma, { userId: memberId, deliveryMethod: 'courier' })
    expect(quoted.ok).toBe(true)
    if (!quoted.ok) return

    const placed = await createOrder(prisma, {
      userId: memberId,
      deliveryMethod: 'courier',
      address: { line1: 'רחוב הבדיקה 1', city: 'תל אביב', zipCode: '6100000' },
      idempotencyKey: `club-roundtrip-${Date.now()}`,
      expectedFingerprint: quoted.quote.fingerprint,
    })
    expect(placed.ok).toBe(true)
    if (!placed.ok) return

    const frozen = await prisma.orderItem.findFirstOrThrow({
      where: { order: { userId: memberId } },
      select: { unitPriceAtPurchase: true },
    })
    expect(frozen.unitPriceAtPurchase.toFixed(2)).toBe('85.41')
  })

  it('the seventh list, item 2 — a member cart carries the base price per line and the savings total', async () => {
    await cartWith(memberId, 2)
    const cart = await getCart(prisma, { userId: memberId, guestCartId: undefined })
    // The struck-through figure beside the member price.
    expect(cart.items[0]!.baseUnitPrice).toBe('94.90')
    expect(cart.items[0]!.unitPrice).toBe('85.41')
    // (9490 - 8541) * 2 = 1898 agorot. Per-unit delta times quantity, so the
    // figure always agrees with the displayed prices — never subtotal maths.
    expect(cart.clubSavings).toBe('18.98')
  })

  it('🔴 CONTROL — a non-member sees base = unit (nothing to strike) and the SAME savings figure as the join incentive', async () => {
    await cartWith(plainId, 2)
    const plain = await getCart(prisma, { userId: plainId, guestCartId: undefined })
    expect(plain.items[0]!.baseUnitPrice).toBe('94.90')
    expect(plain.items[0]!.unitPrice).toBe('94.90')
    // One formula, two readings: for the member it is actual, for the
    // non-member it is what joining would save on this same cart.
    expect(plain.clubSavings).toBe('18.98')
  })

  it('the checkout quote carries clubMember and clubSavings, copied from the cart DTO', async () => {
    await cartWith(memberId, 2)
    const result = await quoteCheckout(prisma, { userId: memberId, deliveryMethod: 'courier' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.quote.clubMember).toBe(true)
    expect(result.quote.clubSavings).toBe('18.98')
    expect(result.quote.lines[0]!.baseUnitPrice).toBe('94.90')
  })

  it('🔴 a NON-member quote carries clubSavings 0.00 — checkout must not receive the join-pitch reading', async () => {
    await cartWith(plainId, 2)
    const result = await quoteCheckout(prisma, { userId: plainId, deliveryMethod: 'courier' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.quote.clubMember).toBe(false)
    // The CART keeps '18.98' as the join incentive; the quote deliberately
    // zeroes it so no checkout consumer can render a discount that is not
    // included (review finding).
    expect(result.quote.clubSavings).toBe('0.00')
  })

  it('🔴 REVOCATION — leaving the club takes effect on the NEXT request, no session involved', async () => {
    await cartWith(memberId, 1)
    const before = await getCart(prisma, { userId: memberId, guestCartId: undefined })
    expect(before.items[0]!.unitPrice).toBe('85.41')

    await prisma.user.update({ where: { id: memberId }, data: { isClubMember: false } })
    const after = await getCart(prisma, { userId: memberId, guestCartId: undefined })
    expect(after.items[0]!.unitPrice).toBe('94.90')
  })
})
