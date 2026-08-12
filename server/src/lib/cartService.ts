import type { PrismaClient } from '@prisma/client'
import { clampAddition, clampCartQuantity, parseRequestedQuantity } from './cartQuantity.js'
import { isUniqueViolationOn } from './prismaUniqueViolation.js'

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


/** Runs `attempt`; on ITS constraint only, runs `recover` once instead. */
async function withUniqueRetry(
  constraint: readonly string[],
  attempt: () => Promise<unknown>,
  recover: () => Promise<void>,
): Promise<void> {
  try {
    await attempt()
  } catch (error) {
    if (!isUniqueViolationOn(error, constraint)) throw error
    await recover()
  }
}

/**
 * Create-or-get the identity's single cart. DEC-055 made `userId` and
 * `sessionId` unique, so the loser of a concurrent create gets P2002 on the
 * CART constraint and simply reads the winner's row.
 */
async function getOrCreateCart(
  prisma: PrismaClient,
  identity: CartIdentity,
): Promise<{ id: string }> {
  const existing = await prisma.cart.findFirst({
    where: whereForIdentity(identity),
    select: { id: true },
  })
  if (existing) return existing

  const constraint = identity.userId
    ? ['carts_user_id_key', 'userId', 'user_id']
    : ['carts_session_id_key', 'sessionId', 'session_id']
  let created: { id: string } | null = null

  await withUniqueRetry(
    constraint,
    async () => {
      created = await prisma.cart.create({
        data: identity.userId
          ? { userId: identity.userId }
          : { sessionId: identity.guestCartId as string },
        select: { id: true },
      })
    },
    async () => {
      // Lost the race: the winner's cart is the cart.
      created = await prisma.cart.findFirst({
        where: whereForIdentity(identity),
        select: { id: true },
      })
    },
  )

  if (!created) throw new Error('cart could not be created or found after a unique-constraint retry')
  return created
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

  const cart = await getOrCreateCart(prisma, identity)

  const existing = await prisma.cartItem.findUnique({
    where: { cartId_productId: { cartId: cart.id, productId: product.id } },
    select: { id: true, quantity: true },
  })

  // 🔴 ONE clamp, the proved one. No inline Math.min, no second opinion here.
  const clamped = existing
    ? clampAddition(existing.quantity, requested, product.stockQuantity)
    : clampCartQuantity(requested, product.stockQuantity)

  if (!clamped.ok) {
    return { ok: false, reason: clamped.reason === 'OUT_OF_STOCK' ? 'OUT_OF_STOCK' : 'INVALID_STOCK' }
  }

  // DEC-055: an upsert on the compound key, so there is no read-then-write
  // window for a concurrent request to land in.
  // ⚠️ Prisma's upsert compiles to INSERT ... ON CONFLICT only for simple
  // shapes and otherwise falls back to find-then-write, so the upsert is NOT
  // the guarantee — the P2002 handler below is. Both are kept.
  await withUniqueRetry(
    ['cart_items_cart_id_product_id_key', 'cartId_productId', 'cart_id_product_id'],
    () =>
      prisma.cartItem.upsert({
        where: { cartId_productId: { cartId: cart.id, productId: product.id } },
        create: { cartId: cart.id, productId: product.id, quantity: clamped.quantity },
        update: { quantity: clamped.quantity },
      }),
    async () => {
      // The loser re-reads and re-clamps against what the winner wrote, so the
      // cap and the stock bound still bind on the combined quantity.
      const winner = await prisma.cartItem.findUnique({
        where: { cartId_productId: { cartId: cart.id, productId: product.id } },
        select: { id: true, quantity: true },
      })
      if (!winner) return
      const merged = clampCartQuantity(winner.quantity, product.stockQuantity)
      if (merged.ok) {
        await prisma.cartItem.update({ where: { id: winner.id }, data: { quantity: merged.quantity } })
      }
    },
  )

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

export type UpdateResult =
  | { ok: true; cart: CartDto; quantity: number; removed: boolean; unchanged: boolean
      clampedByCap: boolean; clampedByStock: boolean }
  | { ok: false; reason: 'LINE_NOT_FOUND' | 'INVALID_QUANTITY' | 'OUT_OF_STOCK' | 'INVALID_STOCK' }

/**
 * Checkpoint D — PATCH. §7 decides that **quantity 0 REMOVES the line** rather
 * than being a 400: it is what a quantity stepper produces at its lower bound,
 * and rejecting it would make every client implement the same special case.
 *
 * 🔴 THE LOOKUP IS SCOPED TO THE IDENTITY. A line belonging to another session
 * must be indistinguishable from one that does not exist — see `deleteLine`.
 */
export async function updateLine(
  prisma: PrismaClient,
  identity: CartIdentity,
  lineId: string,
  rawQuantity: unknown,
): Promise<UpdateResult> {
  if (rawQuantity === 0) {
    const removed = await deleteLine(prisma, identity, lineId)
    return removed.ok
      ? { ok: true, cart: removed.cart, quantity: 0, removed: true, unchanged: false,
          clampedByCap: false, clampedByStock: false }
      : { ok: false, reason: 'LINE_NOT_FOUND' }
  }

  const requested = parseRequestedQuantity(rawQuantity)
  if (typeof requested !== 'number') return { ok: false, reason: 'INVALID_QUANTITY' }

  const line = await findOwnedLine(prisma, identity, lineId)
  if (!line) return { ok: false, reason: 'LINE_NOT_FOUND' }

  const clamped = clampCartQuantity(requested, line.product.stockQuantity)
  if (!clamped.ok) {
    return { ok: false, reason: clamped.reason === 'OUT_OF_STOCK' ? 'OUT_OF_STOCK' : 'INVALID_STOCK' }
  }

  if (clamped.quantity !== line.quantity) {
    await prisma.cartItem.update({ where: { id: line.id }, data: { quantity: clamped.quantity } })
  }

  return {
    ok: true,
    cart: await getCart(prisma, identity),
    quantity: clamped.quantity,
    removed: false,
    // The alreadyAtMaximum precedent: a no-op must not read as a real change.
    unchanged: clamped.quantity === line.quantity,
    clampedByCap: clamped.clampedByCap,
    clampedByStock: clamped.clampedByStock,
  }
}

/**
 * Checkpoint D — DELETE. **IDEMPOTENT**: deleting a line that is already gone
 * succeeds and leaves the cart unchanged. A 404 there would make a retried
 * request look like a failure.
 *
 * ⚠️ INV-03 governs **Product and Order**, not cart lines. Removing a CART LINE
 * is a real row deletion and is correct — there is nothing to preserve for an
 * audit trail in a shopper's own basket. Stated here so nobody later "fixes"
 * it into a soft delete.
 *
 * 🔴 SCOPED TO THE IDENTITY, and a foreign line returns the SAME shape as an
 * absent one. Never a 403: a 403 confirms the line exists, which is the IDOR
 * disclosure M-009 has a rule about.
 */
export async function deleteLine(
  prisma: PrismaClient,
  identity: CartIdentity,
  lineId: string,
): Promise<{ ok: true; cart: CartDto; removed: boolean } | { ok: false }> {
  if (!hasIdentity(identity)) return { ok: false }

  const line = await findOwnedLine(prisma, identity, lineId)
  if (line) await prisma.cartItem.delete({ where: { id: line.id } })

  // Idempotent: already gone is a success, not a 404.
  return { ok: true, cart: await getCart(prisma, identity), removed: Boolean(line) }
}

/** A line, but ONLY if the caller's identity owns the cart holding it. */
async function findOwnedLine(prisma: PrismaClient, identity: CartIdentity, lineId: string) {
  if (!hasIdentity(identity)) return null
  return prisma.cartItem.findFirst({
    where: { id: lineId, cart: whereForIdentity(identity) },
    select: { id: true, quantity: true, product: { select: { stockQuantity: true } } },
  })
}
