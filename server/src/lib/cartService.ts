import type { PrismaClient } from '@prisma/client'
import { clampAddition, clampCartQuantity, parseRequestedQuantity } from './cartQuantity.js'

/**
 * MILESTONE-007 Checkpoint C — the cart service.
 *
 * 🔴 THE CART STORES NO PRICE. §7's frozen position: a cart is a QUOTE, and
 * INV-02's freeze of price and name belongs to OrderItem at checkout. Every
 * money figure below is read from the product row at request time, so a price
 * change reaches the shopper immediately. Adding a price column to CartItem
 * "so the DTO is simpler" is the invariant this milestone was warned about.
 *
 * 🔴 THE CLAMP READS STOCK AT REQUEST TIME AND DELIBERATELY DOES NOT RESERVE.
 * Two shoppers may both hold the last unit; that is intended. INV-01 decrements
 * atomically at order creation, and MILESTONE-008's final check HALTS the order
 * if stock has gone. This sentence exists so nobody later "improves" the cart
 * into a reservation system — that would move the invariant out of the one
 * place that can enforce it transactionally.
 *
 * 🔴 Identity comes from Checkpoint B and is NOT re-derived here. The caller
 * passes it in: `ensureGuestCartId` on a write, `peekGuestCartId` on a read.
 */

export type CartIdentity = { userId?: string | null; guestCartId?: string | null }

export type CartLineDto = {
  productId: string
  slug: string
  nameHe: string
  nameEn: string
  imageFile: string | null
  quantity: number
  /** Live, from the product row. Never stored on the line. */
  unitPrice: string
  lineTotal: string
  /**
   * 🔴 INV-03: a soft-deleted product does NOT vanish from the response. C4
   * decided struck-through-with-an-explanation; §7.5 puts the RENDERING in the
   * client migration, so C's job is to expose the fact and no more.
   */
  isActive: boolean
  /** So the client can explain a clamp it did not choose. */
  stockQuantity: number
}

export type CartDto = {
  items: CartLineDto[]
  totalQuantity: number
  /** Sum of live line totals. Recomputed per request, never stored. */
  subtotal: string
  /** 🔴 C4: true when any line's product is inactive. Checkout is blocked. */
  hasBlockingLine: boolean
}

export type AddItemResult =
  | { ok: true; cart: CartDto; quantity: number; clampedByCap: boolean; clampedByStock: boolean;
      /** 🔴 Correction 2: the line did not move. A plain success here makes a
       *  shopper tapping "add" three times conclude the site is broken. */
      alreadyAtMaximum: boolean }
  | { ok: false; reason: 'PRODUCT_NOT_FOUND' | 'INVALID_QUANTITY' | 'OUT_OF_STOCK' | 'INVALID_STOCK' }

const EMPTY_CART: CartDto = { items: [], totalQuantity: 0, subtotal: '0.00', hasBlockingLine: false }

/** No identity means no cart — and 🔴 no session row is created to find out. */
function hasIdentity(identity: CartIdentity): boolean {
  return Boolean(identity.userId) || Boolean(identity.guestCartId)
}

function whereForIdentity(identity: CartIdentity) {
  return identity.userId
    ? { userId: identity.userId }
    : { sessionId: identity.guestCartId as string, userId: null }
}

function toDto(
  items: { quantity: number; product: {
    id: string; slug: string; nameHe: string; nameEn: string; isActive: boolean
    stockQuantity: number; price: { toFixed: (d: number) => string }
    images: { url: string }[]
  } }[],
): CartDto {
  const lines = items.map((item) => {
    const unit = Number(item.product.price.toFixed(2))
    return {
      productId: item.product.id,
      slug: item.product.slug,
      nameHe: item.product.nameHe,
      nameEn: item.product.nameEn,
      imageFile: item.product.images[0]?.url.split('/').pop() ?? null,
      quantity: item.quantity,
      unitPrice: item.product.price.toFixed(2),
      lineTotal: (unit * item.quantity).toFixed(2),
      isActive: item.product.isActive,
      stockQuantity: item.product.stockQuantity,
    }
  })

  return {
    items: lines,
    totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
    subtotal: lines.reduce((sum, line) => sum + Number(line.lineTotal), 0).toFixed(2),
    hasBlockingLine: lines.some((line) => !line.isActive),
  }
}

const LINE_SELECT = {
  quantity: true,
  product: {
    select: {
      id: true, slug: true, nameHe: true, nameEn: true, isActive: true,
      stockQuantity: true, price: true,
      images: { select: { url: true }, orderBy: { sortOrder: 'asc' as const }, take: 1 },
    },
  },
}

export async function getCart(prisma: PrismaClient, identity: CartIdentity): Promise<CartDto> {
  if (!hasIdentity(identity)) return EMPTY_CART

  const cart = await prisma.cart.findFirst({
    where: whereForIdentity(identity),
    select: { items: { select: LINE_SELECT, orderBy: { id: 'asc' } } },
  })

  return cart ? toDto(cart.items) : EMPTY_CART
}

export async function addItem(
  prisma: PrismaClient,
  identity: CartIdentity,
  slug: string,
  rawQuantity: unknown,
): Promise<AddItemResult> {
  const requested = parseRequestedQuantity(rawQuantity)
  if (typeof requested !== 'number') return { ok: false, reason: 'INVALID_QUANTITY' }

  // 🔴 A soft-deleted product is a 404, identical to one that never existed —
  // the MILESTONE-005 precedent. It must not be addable.
  const product = await prisma.product.findFirst({
    where: { slug, isActive: true },
    select: { id: true, stockQuantity: true },
  })
  if (!product) return { ok: false, reason: 'PRODUCT_NOT_FOUND' }

  const cart =
    (await prisma.cart.findFirst({ where: whereForIdentity(identity), select: { id: true } })) ??
    (await prisma.cart.create({
      data: identity.userId
        ? { userId: identity.userId }
        : { sessionId: identity.guestCartId as string },
      select: { id: true },
    }))

  const existing = await prisma.cartItem.findFirst({
    where: { cartId: cart.id, productId: product.id },
    select: { id: true, quantity: true },
  })

  // 🔴 ONE clamp, the proved one. No inline Math.min, no second opinion here.
  const clamped = existing
    ? clampAddition(existing.quantity, requested, product.stockQuantity)
    : clampCartQuantity(requested, product.stockQuantity)

  if (!clamped.ok) return { ok: false, reason: clamped.reason === 'OUT_OF_STOCK' ? 'OUT_OF_STOCK' : 'INVALID_STOCK' }

  if (existing) {
    await prisma.cartItem.update({ where: { id: existing.id }, data: { quantity: clamped.quantity } })
  } else {
    await prisma.cartItem.create({
      data: { cartId: cart.id, productId: product.id, quantity: clamped.quantity },
    })
  }

  return {
    ok: true,
    cart: await getCart(prisma, identity),
    quantity: clamped.quantity,
    clampedByCap: clamped.clampedByCap,
    clampedByStock: clamped.clampedByStock,
    // Correction 2: nothing moved, so the response must say so.
    alreadyAtMaximum: existing ? clamped.quantity === existing.quantity : false,
  }
}
