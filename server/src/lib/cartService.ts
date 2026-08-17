import type { PrismaClient } from '@prisma/client'
import { clampAddition, clampCartQuantity, parseRequestedQuantity } from './cartQuantity.js'
import { isUniqueViolationOn } from './prismaUniqueViolation.js'
import { computeShipping, toAgorot, type ShippingDto } from './shipping.js'
import { isPurchasable } from './purchasability.js'
import { clubSavingsPerUnitAgorot, effectiveUnitPrice, readClubMembership } from './clubPricing.js'
import { toImageRef } from './catalogMapper.js'

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
  /**
   * 🔴 THE CART LINE'S OWN ID — added at Checkpoint G, and it is not a
   * convenience field. `PATCH` and `DELETE /api/cart/items/:id` address a LINE,
   * and Checkpoints C and D shipped a DTO that carried no line id at all, so
   * the two routes were physically unaddressable from any client: D's own tests
   * created the line and held its id in the test, which is why nothing noticed.
   *
   * ⚠️ Exposing it discloses nothing: `findOwnedLine` scopes every lookup to
   * the caller's identity, and a foreign id is already indistinguishable from
   * an absent one (a 404, never a 403).
   */
  id: string
  productId: string
  slug: string
  nameHe: string
  nameEn: string
  /** For the row's brand line. Read live, exactly like the name. */
  brandName: string
  /**
   * ISSUE-129 / DEC-080 — the brand's manufacturer-verified Latin form, so the
   * English UI does not say "Solgar" on the card and "סולגאר" in the cart.
   * Nullable exactly as the catalogue DTO's: no sourced Latin form means none.
   */
  brandNameEn: string | null
  /** For the row's "package quantity" line. */
  packageQuantity: number
  imageFile: string | null
  quantity: number
  /** Live, from the product row. Never stored on the line. */
  unitPrice: string
  /**
   * The user's seventh list, item 2 — the UNDISCOUNTED unit price, always
   * present. For a non-member it equals `unitPrice` byte-for-byte; for a
   * member the client renders it struck through beside the member price.
   * 🔴 The client compares the two STRINGS to decide whether to show it —
   * it never subtracts (§3.4).
   */
  baseUnitPrice: string
  lineTotal: string
  /**
   * 🔴 INV-03: a soft-deleted product does NOT vanish from the response. C4
   * decided struck-through-with-an-explanation; §7.5 puts the RENDERING in the
   * client migration, so C's job is to expose the fact and no more.
   */
  isActive: boolean
  /** So the client can explain a clamp it did not choose. */
  stockQuantity: number
  /** So the row's stock state is the SERVER's threshold, not a client constant. */
  lowStockThreshold: number
}

export type CartDto = {
  items: CartLineDto[]
  totalQuantity: number
  /**
   * MILESTONE-012 Checkpoint C — whether the prices above are MEMBER prices.
   * The client uses it only to choose COPY (a join hint vs a member note);
   * the figures themselves are already computed either way (§3.4).
   */
  clubMember: boolean
  /**
   * The user's seventh list, item 2 — what the club is worth on THIS cart,
   * in shekels, over the PURCHASABLE lines only (the same population as
   * `subtotal`, so the two never disagree about which lines count).
   *
   * 🔴 ONE FIGURE, TWO READINGS, both server-computed (§3.4): for a member
   * it is what the discount is currently saving them; for a non-member it
   * is what joining would save on the same cart. The formula is identical
   * either way — the per-unit delta comes from `clubSavingsPerUnitAgorot`,
   * which derives from the ONE pricing seam rather than restating the 10%.
   */
  clubSavings: string
  /**
   * Sum of live line totals, ALL lines. Recomputed per request, never stored.
   *
   * ⚠️ This INCLUDES withdrawn lines, by C3: the cart must not lie about what
   * was put in it. It is therefore NOT the figure shipping is measured against
   * — see `shipping.basis`, and see `lib/shipping.ts` for why they differ.
   */
  subtotal: string
  /** 🔴 C4: true when any line's product is inactive. Checkout is blocked. */
  hasBlockingLine: boolean
  /**
   * DEC-058. Computed SERVER-SIDE and reported whole, so the client renders
   * money rather than deriving it (§3.4).
   */
  shipping: ShippingDto
}

export type AddItemResult =
  | { ok: true; cart: CartDto; quantity: number; clampedByCap: boolean; clampedByStock: boolean;
      /** 🔴 Correction 2: the line did not move. A plain success here makes a
       *  shopper tapping "add" three times conclude the site is broken. */
      alreadyAtMaximum: boolean }
  | { ok: false; reason: 'PRODUCT_NOT_FOUND' | 'INVALID_QUANTITY' | 'OUT_OF_STOCK' | 'INVALID_STOCK' }

const EMPTY_CART: CartDto = {
  items: [],
  totalQuantity: 0,
  clubMember: false,
  clubSavings: '0.00',
  subtotal: '0.00',
  hasBlockingLine: false,
  // Nothing to ship, so no charge and no free-shipping promise.
  shipping: computeShipping(0, false),
}

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
  items: { id: string; quantity: number; product: {
    id: string; slug: string; nameHe: string; nameEn: string; isActive: boolean
    stockQuantity: number; lowStockThreshold: number; packageQuantity: number
    price: { toFixed: (d: number) => string }
    brand: { name: string; nameEn: string | null }
    images: { url: string }[]
  } }[],
  // DEC-086 — the club discount enters HERE and nowhere else in this file:
  // every priced field below derives from the one effective unit price, so
  // a member's cart cannot show a mixed opinion about what a line costs.
  isClubMember: boolean,
): CartDto {
  const lines = items.map((item) => {
    const unitPrice = effectiveUnitPrice(item.product.price, isClubMember)
    const unitAgorot = toAgorot(unitPrice)
    return {
      id: item.id,
      productId: item.product.id,
      slug: item.product.slug,
      nameHe: item.product.nameHe,
      nameEn: item.product.nameEn,
      brandName: item.product.brand.name,
      brandNameEn: item.product.brand.nameEn ?? null,
      packageQuantity: item.product.packageQuantity,
      // DEC-089b — the catalogue's ONE image-ref rule: a basename for the
      // build-time assets, an absolute URL passed through for admin-added
      // products (an inline split('/').pop() here mangled URLs to their
      // last segment).
      imageFile: item.product.images[0] ? toImageRef(item.product.images[0].url) : null,
      quantity: item.quantity,
      unitPrice,
      baseUnitPrice: item.product.price.toFixed(2),
      // Integer-agorot arithmetic — the float multiply this replaces could
      // land a cent off, and the club discount makes odd unit prices common.
      lineTotal: ((unitAgorot * item.quantity) / 100).toFixed(2),
      isActive: item.product.isActive,
      stockQuantity: item.product.stockQuantity,
      lowStockThreshold: item.product.lowStockThreshold,
    }
  })

  // 🔴 DEC-058's basis is the PURCHASABLE lines ONLY, which is why it is summed
  // separately from `subtotal` rather than reused from it. An unpurchasable line
  // blocks checkout, so counting it toward free shipping would promise something
  // about an order that cannot be placed — and the promise would REVERSE when
  // the shopper removes the line the cart told them to remove.
  //
  // 🔴 DEC-059 ANSWER 3 — "UNPURCHASABLE" IS ONE CONDITION WITH TWO CAUSES:
  // inactive OR not enough stock. This filter tested only `isActive` until
  // 2026-08-13, which is ISSUE-076 exactly: a cart holding one active-but-
  // SOLD-OUT product at ₪260 showed FREE SHIPPING and flagged nothing, checkout
  // then refused it, the shopper removed the line because they had no other
  // option, and shipping jumped ₪0 -> ₪30. The reversal `lib/shipping.ts`'s own
  // header says must not happen.
  //
  // 🔴 `>= line.quantity`, NOT `> 0`. The first fix used `> 0` and closed only
  // half the hole, because CHECKOUT'S REAL RULE IS THE QUANTITY — the guarded
  // decrement in `orderService` needs `stockQuantity >= line.quantity`. With
  // `> 0` a cart holding 3 x ₪100 against stock 1 still said "purchasable",
  // still promised free shipping at ₪300, and checkout still refused it with
  // INSUFFICIENT_STOCK. The shopper then cut the line to 1 and shipping jumped
  // ₪0 -> ₪30 — the SAME reversal, reached by a different route.
  //
  // ⚠️ THE RULE MUST MATCH THE ONE CHECKOUT ENFORCES, not merely resemble it.
  // The order side got this first and the cart side followed twice; both times
  // the gap was a cart that promised something checkout would refuse.
  // 🔴 THE SHARED RULE, not a second copy of it. This filter was written out by
  // hand twice and drifted from checkout twice — `isActive` only, then `> 0` —
  // and each drift produced the same shipping reversal. `lib/purchasability.ts`
  // makes the agreement mechanical.
  const purchasable = lines.filter(isPurchasable)
  const basisAgorot = purchasable.reduce((sum, line) => sum + toAgorot(line.lineTotal), 0)

  // The seventh list, item 2 — summed over the SAME `purchasable` array as
  // the basis/subtotal, so the savings row can never claim money about a
  // line the subtotal refuses to count: one filtered population, not two
  // filters kept in lockstep by convention (review finding). The per-unit
  // delta derives from the line's own baseUnitPrice through the one seam.
  const clubSavingsAgorot = purchasable.reduce(
    (sum, line) => sum + clubSavingsPerUnitAgorot(line.baseUnitPrice) * line.quantity,
    0,
  )

  return {
    items: lines,
    clubMember: isClubMember,
    clubSavings: (clubSavingsAgorot / 100).toFixed(2),
    totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
    /*
     * 🔴 MILESTONE-008 CHECKPOINT F1 — DEC-059 ANSWER 3, FINALLY APPLIED HERE.
     * "Such a line contributes to NOTHING — not the subtotal, not the shipping
     * basis", and the decision says in as many words that this "collapses
     * subtotal and basis into one number".
     *
     * Until now `subtotal` summed EVERY line and `basisAgorot` summed the
     * purchasable ones, so the cart showed a total no order could ever be
     * placed for and the checkout quote disagreed with the page that led to
     * it. This is the same figure as the basis, deliberately — if they ever
     * need to diverge again that is a new decision, not a refactor.
     *
     * ⚠️ THE LINE STILL RENDERS. C3 stands: the cart must not lie about what
     * was put in it. What changes is what the line COUNTS toward, and the row
     * is what has to say why — ISSUE-080.
     *
     * Summed in agorot because a float sum of two-decimal strings can land a
     * cent off, and this figure is money.
     */
    subtotal: (basisAgorot / 100).toFixed(2),
    // 🔴 The same shared rule — otherwise the cart lets a shopper proceed into
    // a checkout that will refuse them.
    hasBlockingLine: lines.some((line) => !isPurchasable(line)),
    shipping: computeShipping(basisAgorot, purchasable.length > 0),
  }
}

const LINE_SELECT = {
  // 🔴 The LINE's id, not the product's. PATCH/DELETE address this value.
  id: true,
  quantity: true,
  product: {
    select: {
      id: true, slug: true, nameHe: true, nameEn: true, isActive: true,
      stockQuantity: true, lowStockThreshold: true, packageQuantity: true, price: true,
      brand: { select: { name: true, nameEn: true } },
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

  // DEC-086 — membership is read per request from the user row (DEC-065's
  // revocation pattern); a guest identity is never a member.
  const [cart, isClubMember] = await Promise.all([
    prisma.cart.findFirst({
      where: whereForIdentity(identity),
      select: { items: { select: LINE_SELECT, orderBy: { id: 'asc' } } },
    }),
    readClubMembership(prisma, identity.userId),
  ])

  return cart ? toDto(cart.items, isClubMember) : EMPTY_CART
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
