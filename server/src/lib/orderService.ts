import type { Prisma, PrismaClient } from '@prisma/client'
import { DELIVERY_METHODS, computeShipping, toAgorot, type DeliveryMethodName } from './shipping.js'
import { availableToBuy, unpurchasableReason, type UnpurchasableReason } from './purchasability.js'
import { generateOrderNumber } from './orderNumber.js'
import { isUniqueViolationOn } from './prismaUniqueViolation.js'

/**
 * MILESTONE-008 Checkpoint C — order creation. §8, DEC-059.
 *
 * 🔴 FOUR INVARIANTS MEET IN ONE TRANSACTION, and three of them are here:
 *
 *   INV-01  the order and the stock decrement are ATOMIC, with full rollback.
 *           No overselling.
 *   INV-02  OrderItem stores a FROZEN price and name — never a reference to a
 *           value that can change afterwards.
 *   INV-05  finalization is IDEMPOTENT, in BOTH layers DEC-049 requires.
 *
 * INV-04 (the email, outside the transaction and after the commit) is
 * Checkpoint D's, and this module deliberately performs NO external call —
 * nothing here sends mail, and nothing here may start.
 *
 * §3.4 — every figure is computed HERE. The client supplies a delivery method,
 * an address and an idempotency key, and nothing else it says about money is
 * read.
 */

/** A line that cannot be bought, and how many of it there actually are. */
export type UnpurchasableLine = {
  slug: string
  why: UnpurchasableReason
  /**
   * 🔴 What the shopper could still buy — 0 unless the cause is SHORT_STOCK.
   * See `availableToBuy`: reporting a withdrawn product's remaining shelf stock
   * would send the shopper to lower their quantity, which cannot help.
   */
  available: number
}

export type CreateOrderInput = {
  userId: string
  /** 🔴 CLIENT-SUPPLIED, and scoped to the user by `@@unique([userId, idempotencyKey])`. */
  idempotencyKey: string
  deliveryMethod: DeliveryMethodName
  /** 🔴 Required for courier and pickup point, forbidden for self pickup. */
  address: { line1: string; city: string; zipCode?: string | null } | null
}

export type CreateOrderResult =
  | {
      ok: true
      orderId: string
      orderNumber: string
      totalAmount: string
      shippingCost: string
      /** 🔴 TRUE when this call returned an order a PREVIOUS call created. */
      replayed: boolean
    }
  | { ok: false; reason: 'EMPTY_CART' | 'ADDRESS_REQUIRED' | 'ADDRESS_NOT_ALLOWED' }
  /**
   * 🔴 A blank or absent idempotency key. Refused rather than accepted verbatim:
   * see `USABLE_KEY` for what accepting one costs.
   */
  | { ok: false; reason: 'INVALID_IDEMPOTENCY_KEY' }
  /** A delivery method that is not one of REQ-F-040's three. */
  | { ok: false; reason: 'INVALID_DELIVERY_METHOD' }
  /** 🔴 Names the line, like UNPURCHASABLE_LINE does — see the catch. */
  | { ok: false; reason: 'INSUFFICIENT_STOCK'; slug: string }
  | { ok: false; reason: 'UNPURCHASABLE_LINE'; lines: UnpurchasableLine[] }

/** Shapes a cart line for the shared rule. See `lib/purchasability.ts`. */
function asPurchasabilityInput(line: {
  quantity: number
  product: { isActive: boolean; stockQuantity: number }
}) {
  return {
    quantity: line.quantity,
    isActive: line.product.isActive,
    stockQuantity: line.product.stockQuantity,
  }
}

/** The constraint names and field names for `@@unique([userId, idempotencyKey])`. */
const IDEMPOTENCY_CONSTRAINT = [
  'orders_user_id_idempotency_key_key',
  'idempotencyKey',
  'idempotency_key',
]

/** `Order.orderNumber`'s own `@unique`. See `ORDER_NUMBER_RETRIES`. */
const ORDER_NUMBER_CONSTRAINT = ['orders_order_number_key', 'orderNumber', 'order_number']

/**
 * 🔴 THE COLLISION THAT CAN ACTUALLY HAPPEN IS THE ONE THE INNER RETRY CANNOT
 * SEE. `generateOrderNumber` re-draws when its candidate is already COMMITTED —
 * a case with odds around 1e-9. What it cannot see is another transaction's
 * UNCOMMITTED insert: two concurrent checkouts can draw the same suffix, both
 * find it free, and the second then fails on `orders_order_number_key` at
 * INSERT time. Without this outer retry that is a 500 on a checkout that had
 * nothing wrong with it.
 *
 * ⚠️ Bounded, like the inner one, and for the same reason: three collisions in
 * a row is not luck, it is a broken generator, and looping would hide that
 * behind a hung request.
 */
const ORDER_NUMBER_RETRIES = 3

/**
 * This transaction DELIBERATELY WAITS — the idempotency loser blocks until the
 * winner commits, and every contended `updateMany` waits on a row lock. It also
 * issues one round trip per cart line.
 *
 * 🔴 So the timeout is chosen rather than inherited. Prisma's defaults (2s
 * maxWait, 5s timeout) were never picked with this workload in mind, and
 * exceeding them throws P2028, which surfaces to the shopper as a 500 on a
 * checkout that was merely queued behind someone else's.
 */
const TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const

async function readExisting(
  tx: Prisma.TransactionClient,
  userId: string,
  idempotencyKey: string,
): Promise<CreateOrderResult | null> {
  const existing = await tx.order.findUnique({
    // 🔴 SCOPED BY CONSTRUCTION. The composite key means this lookup CANNOT be
    // written without the user — which is the whole reason the unique index is
    // (userId, idempotencyKey) rather than the key alone. A global unique would
    // have made `findUnique({ where: { idempotencyKey } })` the natural call,
    // and a key belonging to another shopper would have matched.
    where: { userId_idempotencyKey: { userId, idempotencyKey } },
    select: { id: true, orderNumber: true, totalAmount: true, shippingCost: true },
  })
  if (!existing) return null
  return {
    ok: true,
    orderId: existing.id,
    orderNumber: existing.orderNumber,
    totalAmount: existing.totalAmount.toFixed(2),
    shippingCost: existing.shippingCost.toFixed(2),
    replayed: true,
  }
}

/** True when the address is present AND actually says something. */
function usableAddress(address: CreateOrderInput['address']): boolean {
  return Boolean(address && address.line1.trim() && address.city.trim())
}

/**
 * 🔴 THE KEY IS CLIENT-SUPPLIED, SO IT IS VALIDATED LIKE ANY OTHER INPUT — and
 * it was not, while the address beside it was trimmed and rejected.
 *
 * ⚠️ What accepting a blank one costs, and it is permanent rather than noisy: a
 * browser on an insecure origin has no `crypto.randomUUID`, the client falls
 * back to something that stringifies to `''`, and the first checkout writes
 * `idempotency_key = ''`. Every LATER checkout by that shopper then matches it
 * at `readExisting`, returns `replayed: true` with the FIRST order, and the
 * shopper can never place another one. Nothing throws; the cart simply stops
 * working, forever, for that account.
 *
 * ⚠️ NO MINIMUM, and the narrowness is deliberate. A first version added an
 * 8-character floor and immediately refused two legitimate keys in this
 * project's own tests — which is the floor telling on itself: the defect was a
 * key that identifies NOTHING, not a key that is short. Policing UUID format
 * would be inventing a policy the client never agreed to, and this service does
 * not get to decide how a caller names its retries.
 *
 * 🔴 A MAXIMUM IS A DIFFERENT RULE, AND IT IS NOT OPTIONAL. The argument above
 * is about what a key MEANS; this one is about where it GOES. The key is a
 * column in `orders_user_id_idempotency_key_key`, a btree index whose rows
 * cannot exceed 2704 bytes. A long key makes the INSERT fail with SQLSTATE
 * 54000 — which is NOT a unique violation, so neither matcher in the catch sees
 * it, the transaction rolls back, and the shopper gets a 500 on every attempt
 * with that key rather than an answer they can act on. Refusing it up front
 * turns an unrecoverable 500 into a plain refusal.
 *
 * ⚠️ AND THE CEILING IS NOT A CLEAN LINE, which is the argument for a cap well
 * below it rather than a check against 2704. btree index tuples are COMPRESSED,
 * so whether an oversized key fails depends on how compressible it happens to
 * be: measured here, `'k'.repeat(3000)` inserts without complaint while 3000
 * characters of random hex fails with `index row size 3016 exceeds btree
 * version 4 maximum 2704`. A limit derived from the byte ceiling would pass or
 * fail on the ENTROPY of a client's key — the worst kind of threshold, since it
 * holds in testing and breaks on the one key nobody generated by hand.
 *
 * ⚠️ 200 characters, well under the byte ceiling rather than at it. The limit is
 * in BYTES and Hebrew is multi-byte in UTF-8, so a character count near 2704
 * would still overflow; 200 characters cannot exceed 800 bytes even at 4 bytes
 * each. A UUID is 36.
 */
const MAX_IDEMPOTENCY_KEY_LENGTH = 200

function usableIdempotencyKey(key: string): boolean {
  if (typeof key !== 'string') return false
  const trimmed = key.trim()
  return trimmed.length > 0 && trimmed.length <= MAX_IDEMPOTENCY_KEY_LENGTH
}

/**
 * 🔴 A DELIBERATE TEST SEAM, and it exists because a coverage hole was MEASURED
 * rather than suspected.
 *
 * INV-01's guard — `stockQuantity: { gte }` inside the decrement's WHERE — only
 * fires when stock changes BETWEEN this transaction's read and its write. Once
 * `unpurchasable` became quantity-aware (so the cart and checkout share one
 * rule), the pre-check caught every short-stock case the tests could set up,
 * and removing the guard entirely left ALL 21 TESTS GREEN. The invariant that
 * matters most in this milestone was protected by nothing a test could see.
 *
 * ⚠️ The race cannot be forced from outside: the pre-check is a plain SELECT,
 * so nothing blocks, and two concurrent checkouts serialise often enough that a
 * timing-based test would prove nothing on most runs.
 *
 * So the seam is named, empty in production, and called exactly once — the same
 * shape as MILESTONE-007's PROMOTE-GUEST-CART. 🔴 It changes NO behaviour when
 * omitted; it only lets a test stand where the race would.
 */
export type CreateOrderHooks = {
  /**
   * Runs after the purchasability pre-check, before the first write.
   *
   * 🔴 THIS POSITION IS LOAD-BEARING, NOT INCIDENTAL, and what makes it safe
   * changed when the locking read arrived. The transaction now holds the CART
   * ITEM rows — but it holds NO PRODUCT ROW yet, because the pre-check is a
   * plain SELECT. So a test may write the same PRODUCT row over a different
   * connection and commit, which is exactly what the seam exists for.
   *
   * 🔴 A hook that writes a CART ITEM of this cart will BLOCK, by design — that
   * is the locking read doing its job. A test doing so must give its own
   * connection a `lock_timeout`, or the outer write waits on this transaction
   * while this transaction waits on the hook: a self-deadlock that resolves only
   * when TRANSACTION_OPTIONS' 15s timeout fires, surfacing as a confusing P2028
   * rather than an obvious hang. The same trap applies to moving this call below
   * the first `updateMany`, or adding a second hook after it — the product locks
   * are held from there on.
   */
  afterPrecheck?: () => Promise<void>
}

export async function createOrder(
  prisma: PrismaClient,
  input: CreateOrderInput,
  hooks: CreateOrderHooks = {},
): Promise<CreateOrderResult> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await attemptCreateOrder(prisma, input, hooks)
    } catch (error) {
      // See ORDER_NUMBER_RETRIES: the reachable collision is the concurrent
      // one, and it can only be detected at INSERT time.
      if (isUniqueViolationOn(error, ORDER_NUMBER_CONSTRAINT) && attempt < ORDER_NUMBER_RETRIES) {
        continue
      }
      throw error
    }
  }
}

async function attemptCreateOrder(
  prisma: PrismaClient,
  input: CreateOrderInput,
  hooks: CreateOrderHooks,
): Promise<CreateOrderResult> {
  const { userId, deliveryMethod, address } = input

  // 🔴 BEFORE the transaction, unlike the address rule. The address check moved
  // INSIDE so a retry with a differently-shaped payload still replays — but a
  // key that cannot identify a checkout cannot replay anything, so there is
  // nothing to preserve by letting it through.
  if (!usableIdempotencyKey(input.idempotencyKey)) {
    return { ok: false, reason: 'INVALID_IDEMPOTENCY_KEY' }
  }

  // 🔴 TRIMMED ONCE, HERE, AND USED EVERYWHERE AFTER. It was validated trimmed
  // and then stored and looked up RAW, so `'k7f2 '` and `'k7f2'` were two
  // different keys: a retry whose key differs only in whitespace — a proxy, a
  // form field, a client that trims on resend — missed `readExisting`, missed
  // the unique index, and created a SECOND order with a second stock decrement.
  // The check and the value it certifies must be the same string.
  const idempotencyKey = input.idempotencyKey.trim()

  try {
    return await prisma.$transaction(async (tx) => {
      // ── The address rule, enforced HERE and not in the database ───────────
      // 🔴 A CHECK constraint would be the stronger home for this, and it was
      // DECLINED deliberately: Prisma cannot express one, so it would be raw
      // SQL that `migrate diff` cannot see, and DEC-055 rejected a partial
      // unique index for exactly that reason — losing the drift check is the
      // larger cost.
      //
      // ⚠️ IT RUNS AFTER THE REPLAY CHECK, not before, and that ordering is the
      // point. Validating first meant a RETRY carrying a differently-shaped
      // payload — a client that trims fields on resend — was answered with
      // ADDRESS_REQUIRED instead of the order it had already created. An
      // idempotent operation must answer the same key the same way.
      //
      // Tested BOTH WAYS: a courier order without a usable address is refused,
      // and a self-pickup order carrying one is refused too. The second
      // direction matters — an address on a pickup order is a delivery address
      // for a delivery that will never happen.
      //
      // ⚠️ `usableAddress`, not merely present: `{ line1: '', city: '' }` is an
      // object, and a presence check would have accepted it and frozen a blank
      // address onto the order forever.
      // ⚠️ `usableAddress` on BOTH sides, not truthiness on one. A checkout form
      // that keeps `{ line1: '', city: '' }` in state and switches to self
      // pickup would otherwise be told ADDRESS_NOT_ALLOWED for an object
      // containing no address — refusing an order over a blank the shopper
      // cannot see.
      // 🔴 THE ADDRESS RULES MOVED BELOW THE CART READ — see after it. They
      // stay after the REPLAY check either way; only their position relative to
      // the cart changed.

      // ── THE LOCKING READ, AND IT REPLACES A COMPARISON ────────────────────
      // 🔴 THIS IS WHERE THE CART STOPS MOVING. Three earlier versions of this
      // checkpoint guarded the cart at DELETE time instead, comparing what was
      // read against what was deleted — first by count, then by line id, then by
      // (id, quantity) pairs. Each patch was defeated by the next case it could
      // not see (a swap of equal size; then a quantity edit, because
      // `cartService` updates a line IN PLACE and the id does not change). That
      // is the shape of the mistake, not the individual misses: a comparison
      // made AFTER the fact can only detect races it was told to look for.
      //
      // A locking read has no such list. `FOR UPDATE` holds every one of these
      // rows until this transaction commits or rolls back, so a concurrent edit
      // BLOCKS rather than being detected afterwards — the order is built from
      // rows nobody else can move, and there is nothing left to compare.
      //
      // ⚠️ Prisma's query API cannot express `FOR UPDATE`, hence `$queryRaw`.
      // The same transaction already reaches for raw SQL to read the database
      // clock, so the shape is established rather than new.
      //
      // 🔴 THE LOCK ORDER IS DELIBERATE AND IT SPANS TWO TABLES.
      //   1. cart_items for THIS cart, ordered by product_id
      //   2. products, one per line, in the same product_id order (the
      //      decrement loop below, which walks `cart.items`)
      // Carts are per-identity (DEC-055), so no two shoppers ever contend for
      // the same cart_items row and step 1 cannot form a cycle between them.
      // Step 2 can, which is why the product locks are taken in a single
      // ascending order by every transaction: two shoppers whose carts both
      // hold P and Q would otherwise lock them P-then-Q and Q-then-P, and
      // Postgres would abort one with 40P01 — a 500 on a checkout that had
      // nothing wrong with it. `cartService` writes cart_items and never writes
      // a product, so it can only ever wait at step 1, never inside a cycle.
      //
      // ⚠️ `FOR UPDATE OF ci` — the cart_items rows only. The carts row is
      // joined to find them, not to be locked.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT ci.id
        FROM cart_items ci
        JOIN carts c ON c.id = ci.cart_id
        WHERE c.user_id = ${userId}
        ORDER BY ci.product_id ASC
        FOR UPDATE OF ci
      `
      const lockedIds = locked.map((row) => row.id)

      // ── INV-05, LAYER ONE: the service guard ───────────────────────────────
      // DEC-049 requires TWO layers, and BOTH are present — but the division of
      // labour between them changed when the locking read arrived, and it is no
      // longer the one this comment used to describe. It once read "this answers
      // the SEQUENTIAL retry, the constraint answers the CONCURRENT one". Sitting
      // below the lock, this lookup now answers BOTH: a concurrent same-key
      // request waits here and then sees the winner's committed order. See the
      // catch for what that leaves layer two doing.
      //
      // 🔴 IT RUNS AFTER THE LOCKING READ, AND IT USED TO RUN BEFORE IT. That
      // ordering was correct only while the cart read took no locks. With the
      // lock in place, two concurrent requests carrying the SAME key behave like
      // this: both find nothing here, the winner locks the cart and commits, and
      // the loser — which had already passed a replay check that saw nothing —
      // unblocks to a cart the winner has emptied and answered EMPTY_CART for a
      // retry whose order exists. A plain retry is not allowed to invent a new
      // outcome.
      //
      // Reading it AFTER the wait fixes that by construction: PostgreSQL's READ
      // COMMITTED gives every statement its own snapshot, so a lookup issued
      // once the lock is granted sees whatever the winner committed. The loser
      // replays the winner's order, which is the whole promise of the key.
      //
      // ⚠️ Locking first costs a replay nothing: a shopper whose order already
      // exists has an empty cart, so the statement above locks zero rows.
      const replay = await readExisting(tx, userId, idempotencyKey)
      if (replay) return replay

      // 🔴 The client supplies this, so it is checked like any other input. An
      // unknown string otherwise falls through `computeShipping`'s courier path
      // — charging ₪30 and applying the threshold — and only fails later at the
      // Prisma enum, surfacing as a 500 rather than a refusal.
      //
      // 🔴 AFTER THE REPLAY CHECK, for the reason the address rule is: an
      // idempotent operation must answer the same key the same way. Validating
      // first meant a RETRY whose delivery method was mangled in transit, or
      // re-derived by a client whose form had reset, was told
      // INVALID_DELIVERY_METHOD instead of being handed the order it had
      // already placed — and a client that reacts to a refusal by minting a
      // fresh key then places a SECOND order with a second stock decrement.
      // The key identifies the checkout; the payload beside it does not get to
      // change that answer.
      //
      // ⚠️ INVALID_IDEMPOTENCY_KEY stays OUTSIDE the transaction, and that is
      // not the same case: a key that cannot identify a checkout cannot replay
      // one, so there is no earlier answer to preserve.
      if (!DELIVERY_METHODS.includes(deliveryMethod)) {
        return { ok: false as const, reason: 'INVALID_DELIVERY_METHOD' as const }
      }

      const cart = await tx.cart.findFirst({
        where: { userId },
        select: {
          id: true,
          items: {
            // 🔴 SCOPED TO THE ROWS THIS TRANSACTION HOLDS, and that scope is
            // load-bearing. `FOR UPDATE` locks rows that EXIST; it cannot stop
            // an INSERT. Another tab adding a product between the statement
            // above and this read would otherwise land an UNLOCKED line in the
            // middle of the order — priced, decremented and deleted while still
            // free to move. Filtering by the locked ids means everything this
            // order is built from is held.
            //
            // A line added after the lock is simply not part of this order: it
            // is not read, not charged, and not deleted below. It stays in the
            // cart, which is what the shopper who added it expects.
            where: { id: { in: lockedIds } },
            // The same ascending order the lock statement used, so the
            // decrement loop takes its product locks in that order too.
            orderBy: { productId: 'asc' },
            select: {
              // The LINE's own id — the clearing delete below names exactly the
              // rows this order was built from.
              id: true,
              quantity: true,
              product: {
                select: {
                  id: true, slug: true, nameHe: true, nameEn: true,
                  price: true, isActive: true, stockQuantity: true,
                },
              },
            },
          },
        },
      })

      // 🔴 EMPTINESS IS CHECKED BEFORE THE ADDRESS, and the order is the point.
      // With the address first, a shopper whose cart was empty AND whose address
      // was missing was told ADDRESS_REQUIRED — sent to fix an address when the
      // actual blocker was that there was nothing to buy. An error should name
      // the step that unblocks the shopper, not the first rule that happened to
      // fail.
      if (!cart || cart.items.length === 0) return { ok: false as const, reason: 'EMPTY_CART' as const }

      // ⚠️ `usableAddress` on BOTH sides, not truthiness on one. A checkout form
      // that keeps `{ line1: '', city: '' }` in state and switches to self
      // pickup would otherwise be told ADDRESS_NOT_ALLOWED for an object
      // containing no address — refusing an order over a blank the shopper
      // cannot see.
      if (deliveryMethod === 'self_pickup' && usableAddress(address)) {
        return { ok: false as const, reason: 'ADDRESS_NOT_ALLOWED' as const }
      }
      if (deliveryMethod !== 'self_pickup' && !usableAddress(address)) {
        return { ok: false as const, reason: 'ADDRESS_REQUIRED' as const }
      }

      const blocked = cart.items
        .map((line) => {
          const input = asPurchasabilityInput(line)
          return {
            slug: line.product.slug,
            why: unpurchasableReason(input),
            // 🔴 0 unless SHORT_STOCK. It used to report the raw shelf stock for
            // every cause, so a WITHDRAWN product with 10 units left told the
            // shopper "10 available" — sending them to lower the quantity, the
            // one action that cannot possibly work.
            available: availableToBuy(input),
          }
        })
        .filter((l): l is UnpurchasableLine => l.why !== null)
      if (blocked.length > 0) {
        return { ok: false as const, reason: 'UNPURCHASABLE_LINE' as const, lines: blocked }
      }

      // ── The money, computed server-side (§3.4) ─────────────────────────────
      // Integer agorot throughout: the ₪249 threshold must not ride on a float,
      // and neither must a total the shopper is charged.
      const subtotalAgorot = cart.items.reduce(
        (sum, line) => sum + toAgorot(line.product.price.toFixed(2)) * line.quantity,
        0,
      )
      const shipping = computeShipping(subtotalAgorot, true, deliveryMethod)
      const shippingAgorot = toAgorot(shipping.cost)
      const totalAgorot = subtotalAgorot + shippingAgorot

      // The seam. Empty in production; see CreateOrderHooks for why it exists.
      if (hooks.afterPrecheck) await hooks.afterPrecheck()

      // 🔴 THE DATE COMES FROM THE DATABASE, formatted BY the database. See
      // `orderNumber.ts`'s header: the app process and Postgres are two
      // different clocks, and `created_at` is a zone-less column defaulted from
      // `CURRENT_TIMESTAMP`. Asking Postgres for `LOCALTIMESTAMP` in the same
      // transaction is the only way the number and `createdAt` agree by
      // construction rather than by the two happening to share a TZ setting.
      // ⚠️ Formatted server-side so no JavaScript `Date` can reinterpret a
      // zone-less timestamp on the way out.
      const [clock] = await tx.$queryRaw<{ d: string }[]>`SELECT to_char(LOCALTIMESTAMP, 'YYYYMMDD') AS d`
      if (!clock?.d) throw new Error('could not read the database clock for the order number')

      const orderNumber = await generateOrderNumber(async (candidate) => {
        const clash = await tx.order.findUnique({ where: { orderNumber: candidate }, select: { id: true } })
        return clash !== null
      }, clock.d)

      const order = await tx.order.create({
        data: {
          orderNumber,
          userId,
          idempotencyKey,
          status: 'pending_payment',
          totalAmount: (totalAgorot / 100).toFixed(2),
          deliveryMethod,
          shippingCost: shipping.cost,
          // 🔴 COPIED, never a foreign key. `Address` is mutable and has no
          // soft-delete flag: editing one would rewrite where a PAST order
          // shipped, and deleting one would leave the order pointing at nothing.
          // 🔴 NULLED OUTRIGHT FOR SELF PICKUP, and TRIMMED otherwise. A blank
          // address object survives the guards above on the pickup path (there
          // is nothing usable to reject), and copying it verbatim froze
          // `shippingLine1: '   '` onto the order — truthy, so a confirmation
          // page or Checkpoint D's email would render an empty delivery block
          // for an order nobody is delivering. The columns are nullable BECAUSE
          // self pickup has no address; they should hold null, not whitespace.
          ...(deliveryMethod === 'self_pickup'
            ? { shippingLine1: null, shippingCity: null, shippingZipCode: null }
            : {
                shippingLine1: address!.line1.trim(),
                shippingCity: address!.city.trim(),
                shippingZipCode: address!.zipCode?.trim() || null,
              }),
          items: {
            create: cart.items.map((line) => ({
              productId: line.product.id,
              quantity: line.quantity,
              // ── INV-02, THE FREEZE ───────────────────────────────────────
              // 🔴 BOTH LANGUAGES. One column could not say which language it
              // held, in a store that sells in two — an English shopper's
              // history would have shown a Hebrew name forever.
              unitPriceAtPurchase: line.product.price,
              productNameHeAtPurchase: line.product.nameHe,
              productNameEnAtPurchase: line.product.nameEn,
            })),
          },
          statusHistory: {
            // DEC-050: append-only, and every row names its actor. The shopper
            // placed this one, so the actor is the shopper — null is reserved
            // for SYSTEM transitions and means exactly that.
            create: [{ status: 'pending_payment', changedByUserId: userId }],
          },
        },
        select: { id: true, orderNumber: true },
      })

      // ── INV-01: THE ATOMIC DECREMENT, AND THE GUARD IS THE WHOLE POINT ─────
      // 🔴 `stockQuantity: { gte: line.quantity }` in the WHERE is what makes
      // overselling impossible. A read-then-write would pass its own check and
      // still oversell under concurrency: two requests both read stock 1, both
      // decide 1 >= 1, and both write 0 having sold two units. This puts the
      // comparison INSIDE the write, where the database holds the row.
      //
      // ⚠️ `updateMany` rather than `update` deliberately — `update` throws when
      // the WHERE matches nothing, and a throw here is indistinguishable from a
      // genuine database failure. The count tells us WHICH happened.
      //
      // 🔴 `isActive: true` IS IN THE WHERE FOR THE SAME REASON. It was checked
      // once, at line ~64, against the snapshot this transaction read — which
      // is exactly the read-then-write shape the paragraph above rejects for
      // stock. An admin withdrawing a product between that read and this update
      // would otherwise commit an order for a withdrawn product. Narrow window,
      // but it is the one case this module's own reasoning says must not be
      // left to a pre-check.
      for (const line of cart.items) {
        const changed = await tx.product.updateMany({
          where: {
            id: line.product.id,
            isActive: true,
            stockQuantity: { gte: line.quantity },
          },
          data: { stockQuantity: { decrement: line.quantity } },
        })
        if (changed.count !== 1) {
          // 🔴 THE WHERE HAS TWO CONDITIONS, SO THE FAILURE HAS TWO CAUSES, and
          // reporting them as one told a shopper to reduce the quantity of a
          // product that had just been withdrawn. Re-read to find out which —
          // the row is locked to nobody, and this path is already failing.
          const current = await tx.product.findUnique({
            where: { id: line.product.id },
            select: { isActive: true },
          })
          if (current && !current.isActive) throw new WithdrawnMidFlightError(line.product.slug)
          // 🔴 Throwing rolls the WHOLE transaction back: no order, no items, no
          // status row, no other line's stock touched. That is INV-01's
          // rollback, and REQ-F-045's "no order created, stock untouched, cart
          // preserved" seen from the shopper's side.
          throw new InsufficientStockError(line.product.slug)
        }
      }

      // ── DEC-059 answer 7: the cart on success ──────────────────────────────
      // 🔴 EMPTY THE LINES, KEEP THE CART ROW. DEC-055 gives one cart per
      // identity and emptying is idempotent; deleting the row would make the
      // next add recreate it.
      // ⚠️ INSIDE the transaction, so a rollback leaves the cart intact — which
      // is REQ-F-045's own requirement, not an extra.
      //
      // 🔴 BY LINE ID, AND WITH NO COUNT CHECK AFTER IT. Every one of these rows
      // has been held under `FOR UPDATE` since before the money was computed, so
      // no other transaction can have edited or removed one: the delete matches
      // all of them by construction, and a comparison here would be a check that
      // can never fail — the thing this guard's three previous versions kept
      // being, more elaborately each round.
      //
      // 🔴 NOT `deleteMany({ cartId })`. The lock cannot stop an INSERT, so a
      // line another tab added mid-checkout is not held — and a cart-wide delete
      // would take it anyway, destroying something that was never ordered or
      // paid for. Naming the locked ids leaves it exactly where the shopper put
      // it.
      //
      // ⚠️ A second concurrent checkout by the same shopper (a double-click on a
      // client that mints a key per click, two tabs) is stopped by the lock, not
      // by this delete: it waits at the locking read above, and once this
      // transaction commits it finds no rows and answers EMPTY_CART — which by
      // then is the truth, because this order took the cart.
      await tx.cartItem.deleteMany({ where: { id: { in: lockedIds } } })

      return {
        ok: true as const,
        orderId: order.id,
        orderNumber: order.orderNumber,
        totalAmount: (totalAgorot / 100).toFixed(2),
        shippingCost: shipping.cost,
        replayed: false,
      }
    }, TRANSACTION_OPTIONS)
  } catch (error) {
    // ── INV-05, LAYER TWO: the database constraint ─────────────────────────
    // 🔴 THIS LAYER IS NOW UNREACHABLE THROUGH THIS FUNCTION, AND SAYING SO IS
    // THE POINT. It was written when the replay lookup ran before any lock:
    // two concurrent same-key requests both found nothing, both proceeded, the
    // unique index let one insert win, and the loser landed here to be handed
    // the winner's order. The locking read removed that interleaving. The loser
    // now waits at the first statement, and by the time it reads anything the
    // winner has committed — so it replays at LAYER ONE and never reaches the
    // insert.
    //
    // ⚠️ MEASURED, NOT ASSUMED, because the claim that used to sit here was
    // false by the time it was written. Disabling this catch leaves ALL 30
    // tests in `orderService.integration.test.ts` GREEN, including the
    // concurrent-retry test that was once cited as its proof. DEC-049's two
    // layers are still both PRESENT, but only one of them is now TESTED; this
    // one is defence in depth against a future caller that reaches
    // `order.create` without holding the cart, not a guarantee any test
    // demonstrates.
    //
    // 🔴 KEPT ANYWAY, and deliberately. The unique index is the only thing that
    // makes double-submission impossible independent of this function's control
    // flow, and deleting the handler would turn its firing — a real 500 — into
    // the one outcome nobody would have planned for.
    //
    // ⚠️ NARROW, matching that ONE constraint. A broad catch would turn a
    // database outage into a fake success and lose an order silently, and this
    // project has already shipped one matcher that could never fire — see
    // ISSUE-067, where the same failure hid an enumeration oracle.
    if (isUniqueViolationOn(error, IDEMPOTENCY_CONSTRAINT)) {
      const existing = await readExisting(prisma as unknown as Prisma.TransactionClient, userId, idempotencyKey)
      if (existing) return existing
      // The constraint fired but the row is not readable. Do NOT invent a
      // success — something is wrong that this function cannot name.
      throw error
    }
    if (error instanceof WithdrawnMidFlightError) {
      // Reported as the same shape the pre-check uses, because it IS the same
      // condition — only later. The shopper is told the product is gone, not
      // that they asked for too many of it.
      return {
        ok: false,
        reason: 'UNPURCHASABLE_LINE',
        lines: [{ slug: error.slug, why: 'WITHDRAWN', available: 0 }],
      }
    }
    if (error instanceof InsufficientStockError) {
      // 🔴 The slug travels with it. The class carries one precisely so the
      // caller can say WHICH line failed, and discarding it told a shopper with
      // a ten-line cart that their order failed without saying which product to
      // reduce. Its sibling failure, UNPURCHASABLE_LINE, already reports slugs.
      return { ok: false, reason: 'INSUFFICIENT_STOCK', slug: error.slug }
    }
    throw error
  }
}

/** Thrown to force INV-01's rollback; never escapes `createOrder`. */
export class InsufficientStockError extends Error {
  constructor(public readonly slug: string) {
    super(`insufficient stock for ${slug}`)
    this.name = 'InsufficientStockError'
  }
}

/**
 * The other reason the guarded decrement can match nothing: the product was
 * withdrawn between this transaction's read and its write. Same rollback, but
 * a different thing to tell the shopper.
 */
export class WithdrawnMidFlightError extends Error {
  constructor(public readonly slug: string) {
    super(`withdrawn mid-flight: ${slug}`)
    this.name = 'WithdrawnMidFlightError'
  }
}
