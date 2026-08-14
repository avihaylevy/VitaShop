import { Router } from 'express'
import type { PrismaClient } from '@prisma/client'
import { applyTransition } from '../lib/orderTransitionService.js'
import { createOrderRateLimiters, type OrderRateLimiters } from '../lib/rateLimit.js'
import { requireShopper } from './requireShopper.js'
import { createRequireActiveShopper, createRequireShopperAccount } from './requireActiveShopper.js'

/**
 * MILESTONE-008 Checkpoint E3 — the shopper's own order actions.
 *
 * 🔴 SHOPPER-ONLY, BY DECISION (user, 2026-08-13). §8.9 gives four transitions
 * to ADMIN ONLY — `paid -> processing`, `processing -> shipped`,
 * `processing -> cancelled`, `shipped -> delivered` — and **there is no admin
 * authorization anywhere in this server**. `UserRole` and `User.role` exist in
 * the schema, nothing reads them, and the session carries only `userId`.
 * Building those routes means building a security guard that gates stock
 * restoration and fulfilment, which is not in Checkpoint E's contract. It is
 * filed as its own issue for MILESTONE-010, the admin/audit milestone the
 * schema notes already point at.
 *
 * ⚠️ THE ADMIN TRANSITIONS ARE ALREADY ENFORCED AND TESTED at the service —
 * they are simply unreachable over HTTP. Nothing here weakens the table.
 *
 * 🔴 THE ROUTE DECIDES NOTHING ABOUT THE STATE MACHINE. Whether a cancellation
 * is legal, who may make it and whether stock returns is `orderTransitions.ts`'s
 * answer; performing it atomically is `orderTransitionService.ts`'s. This file
 * reads a request, checks ownership, and maps an answer to a status code.
 */

export type OrderRouterDeps = {
  prisma: PrismaClient
  /** Injectable so a coverage test can identify the limiter, not merely count it. */
  rateLimiters?: OrderRateLimiters
}

/**
 * One screenful of history. No pagination parameter yet: a shopper's order
 * count is bounded by their own purchases, and the admin list's `?page=` was
 * built because a store-wide list is not. Recorded rather than left implicit —
 * when a shopper passes 50, this needs a page parameter, not a bigger number.
 */
const HISTORY_PAGE_SIZE = 50

/**
 * 🔴 ONE SELECT, SHARED BY THE LIST AND THE DETAIL, so the two cannot drift
 * into showing different figures for one order. The detail adds fields; it
 * never redefines these.
 */
const ORDER_SUMMARY_SELECT = {
  id: true,
  orderNumber: true,
  createdAt: true,
  status: true,
  totalAmount: true,
  shippingCost: true,
  deliveryMethod: true,
  items: {
    /*
     * Stable within an order, for the same reason the list is ordered at all:
     * an unordered read can hand back two renderings of one order.
     *
     * ⚠️ WITH A UNIQUE TIEBREAKER, because the name is not one. NOTHING
     * constrains `productNameEnAtPurchase` to be distinct — two products can
     * ship under the same English name, and the frozen copies then tie and
     * order arbitrarily between requests. The order list below argues exactly
     * this and adds `id`; this select said it and did not. Found in review.
     */
    orderBy: [{ productNameEnAtPurchase: 'asc' as const }, { productId: 'asc' as const }],
    select: {
      productId: true,
      productNameHeAtPurchase: true,
      productNameEnAtPurchase: true,
      quantity: true,
      unitPriceAtPurchase: true,
      product: { select: { slug: true } },
    },
  },
  /*
   * ⚠️ NO `as const` HERE, and the omission is deliberate. It froze the nested
   * `orderBy` ARRAY as readonly, which Prisma's generated types reject — the
   * server BUILD failed while the whole suite stayed green, because vitest does
   * not typecheck. The two sort directions carry their own `as const`, which is
   * all Prisma actually needs.
   */
}

type OrderSummaryRow = {
  id: string
  orderNumber: string
  createdAt: Date
  status: string
  totalAmount: { toFixed: (digits: number) => string }
  shippingCost: { toFixed: (digits: number) => string }
  deliveryMethod: string
  items: {
    productId: string
    productNameHeAtPurchase: string
    productNameEnAtPurchase: string
    quantity: number
    unitPriceAtPurchase: { toFixed: (digits: number) => string }
    product: { slug: string }
  }[]
}

/**
 * ⚠️ EVERY MONEY FIELD LEAVES AS A FIXED STRING. Prisma hands back a Decimal;
 * serialising it directly produces whatever its toJSON does, and turning it
 * into a Number reintroduces the float this schema uses Decimal to avoid.
 */
function toOrderSummary(order: OrderSummaryRow) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    createdAt: order.createdAt.toISOString(),
    status: order.status,
    totalAmount: order.totalAmount.toFixed(2),
    shippingCost: order.shippingCost.toFixed(2),
    deliveryMethod: order.deliveryMethod,
    items: order.items.map((item) => ({
      productId: item.productId,
      // The slug is for LINKING to the product page. It is the live value, not
      // a frozen one — deliberately: a link must point at where the product is
      // now, and the NAME beside it is what was agreed.
      slug: item.product.slug,
      nameHe: item.productNameHeAtPurchase,
      nameEn: item.productNameEnAtPurchase,
      quantity: item.quantity,
      unitPrice: item.unitPriceAtPurchase.toFixed(2),
    })),
  }
}

export function createOrderRouter(deps: OrderRouterDeps): ReturnType<typeof Router> {
  const { prisma } = deps
  const limiters = deps.rateLimiters ?? createOrderRateLimiters()
  const router = Router()
  /*
   * ISSUE-092 — a disabled account kept a working session here. ⚠️ ACTIVE, not
   * VERIFIED: cancelling is not completing an order, and an unverified shopper
   * holding a pending order must be able to get out of it.
   */
  const requireActiveShopper = createRequireActiveShopper(deps.prisma)
  const requireShopperAccount = createRequireShopperAccount(deps.prisma)

  /**
   * 🔴 NO-STORE, ROUTER-LEVEL — the same directive `routes/account.ts` sets,
   * for the same reason, and added at Checkpoint G1 when this router gained its
   * first cacheable GETs.
   *
   * ⚠️ THIS ROUTER USED TO BE POST-ONLY, which browsers do not cache. G1's two
   * reads carry order numbers, an item breakdown, the frozen shipping address
   * and a tracking number: without the directive a browser may serve them back
   * from cache AFTER SIGN-OUT, and a back-navigation on a shared machine
   * re-renders someone's home address.
   *
   * Router-level rather than per-route, so the next personal-data route mounted
   * here cannot forget it — and so the REFUSALS carry it too. A cached 401 or
   * 404 is its own bug: the answer changes the moment somebody else signs in.
   */
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    next()
  })

  /**
   * MILESTONE-008 Checkpoint G1 — REQ-F-050, the order history. TEST-050.
   *
   * 🔴 SCOPED IN THE WHERE, NEVER FETCHED AND COMPARED. `userId` comes from the
   * session and goes into the query, so there is no ownership branch that can
   * be written the wrong way round — the same structural choice the cancel
   * route below makes, and the reason neither needs a filter afterwards.
   *
   * ⚠️ THE ITEMS COME WITH THE LIST, deliberately. REQ-F-050 asks for "each
   * order's status and item breakdown", so a list that answered summaries only
   * would need a second request per row to satisfy its own requirement. Bounded
   * by construction: one page of orders, and `@@unique([orderId, productId])`
   * caps lines at one per product.
   *
   * 🔴 BOTH FROZEN NAMES ARE RETURNED. INV-02 froze `productNameHeAtPurchase`
   * AND `productNameEnAtPurchase`, and returning one of them would pick a
   * language on the server that the shopper can change in the browser — the
   * defect Checkpoint B's migration split the column to prevent, and the same
   * rule that lets the catalogue toggle language without a refetch.
   */
  /*
   * 🔴 DEC-074 — SESSION-ONLY on the two READS, deliberately. ISSUE-101 asked
   * whether a disabled shopper may see what they already bought, and the user
   * answered YES: suspension stops ACTING, not seeing one's own purchase
   * records — a shopper locked out of their receipts has no way to
   * reconstruct what they were charged for. The cancel route below KEEPS
   * `requireActiveShopper`: it is a write.
   * ⚠️ AMENDED after review: `requireShopperAccount`, not the bare session
   * guard — the account must still EXIST. Session-only here left a DELETED
   * account's cookie alive forever, answering `200 []` instead of tearing
   * the phantom session down. Existence was never the thing DEC-074
   * loosened; only `disabled` was.
   */
  router.get('/', limiters.read, requireShopper, requireShopperAccount, async (req, res) => {
    const userId = req.session!.userId!

    try {
      const orders = await prisma.order.findMany({
        where: { userId },
        // Newest first, with `id` as the tiebreaker: Prisma's now() is
        // TRANSACTION-START time, so orders written in one transaction share a
        // byte-identical createdAt and would otherwise order arbitrarily.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        /*
         * 🔴 ONE MORE THAN THE PAGE, so truncation is DETECTABLE rather than
         * silent — ISSUE-100, raised in review. Taking exactly 50 makes a
         * shopper with 51 orders see 50 and receive no way to know the rest
         * exist; the screen cannot even say so honestly, because the response
         * carries no signal at all. The extra row is fetched and dropped.
         */
        take: HISTORY_PAGE_SIZE + 1,
        select: ORDER_SUMMARY_SELECT,
      })

      const hasMore = orders.length > HISTORY_PAGE_SIZE
      res.json({
        orders: orders.slice(0, HISTORY_PAGE_SIZE).map(toOrderSummary),
        // ⚠️ Not pagination — a flag. Full paging follows the admin route's
        // shape when a real shopper needs it; until then the client can say
        // "these are your most recent" instead of implying it is everything.
        hasMore,
      })
    } catch (error) {
      console.error(`[orders] listing history for ${userId} failed`, error)
      res.status(503).json({
        error: { code: 'ORDER_HISTORY_UNAVAILABLE', message: 'Try again shortly.' },
      })
    }
  })

  /**
   * REQ-F-050's detail half, and 🔴 TEST-050b's target.
   *
   * 🔴 ANOTHER SHOPPER'S ORDER IS 404, NOT 403 — DEC-070. A 403 would confirm
   * the id is real, which is an enumeration oracle over every order in the
   * store; and the cancel route below has answered 404 since Checkpoint E3, so
   * a 403 here would let the PAIR be diffed for the same answer. An order that
   * is not yours is indistinguishable from one that does not exist.
   */
  // DEC-074 — existence-only (see the list above). The cancel route below
  // is a WRITE and keeps the full active-shopper guard.
  router.get('/:id', limiters.read, requireShopper, requireShopperAccount, async (req, res) => {
    const userId = req.session!.userId!
    // Narrowed rather than asserted — Express types a path parameter as
    // possibly an array, and an array reaching a Prisma `where` is a malformed
    // query at best.
    const orderId = typeof req.params.id === 'string' ? req.params.id : ''
    if (orderId === '') {
      res.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'No such order.' } })
      return
    }

    try {
      const order = await prisma.order.findFirst({
        where: { id: orderId, userId },
        select: {
          ...ORDER_SUMMARY_SELECT,
          shippingLine1: true,
          shippingCity: true,
          shippingZipCode: true,
          trackingNumber: true,
        },
      })

      if (!order) {
        // 🔴 BYTE-IDENTICAL to the "no such order" answer, because they must be
        // indistinguishable. A different message here would rebuild the oracle
        // the status code closes.
        res.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'No such order.' } })
        return
      }

      res.json({
        ...toOrderSummary(order),
        trackingNumber: order.trackingNumber,
        /*
         * ⚠️ THE FROZEN ADDRESS, not the account's current one — INV-02's other
         * half. `Address` is mutable and has no soft delete, so reading it here
         * would rewrite where a past order shipped.
         *
         * Null for self pickup, which has no delivery address at all: the
         * columns are nullable for exactly that case, and an object of empty
         * strings would render as a blank address rather than as no address.
         */
        shippingAddress:
          order.shippingLine1 === null
            ? null
            : {
                line1: order.shippingLine1,
                city: order.shippingCity,
                zipCode: order.shippingZipCode,
              },
      })
    } catch (error) {
      console.error(`[orders] reading ${orderId} failed`, error)
      res.status(503).json({
        error: { code: 'ORDER_HISTORY_UNAVAILABLE', message: 'Try again shortly.' },
      })
    }
  })

  /**
   * REQ-F-045's sibling: the shopper withdrawing an order they placed.
   *
   * §8.9 permits `pending_payment -> cancelled` and `paid -> cancelled` for a
   * shopper, and stops there — fulfilment begins at `processing`.
   */
  router.post('/:id/cancel', limiters.cancel, requireShopper, requireActiveShopper, async (req, res) => {
    const userId = req.session!.userId!
    // ⚠️ Narrowed rather than asserted. Express types a path parameter as
    // possibly an array, and an array reaching a Prisma `where` is a type error
    // at best and a malformed query at worst.
    const orderId = typeof req.params.id === 'string' ? req.params.id : ''
    if (orderId === '') {
      res.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'No such order.' } })
      return
    }

    // ── OWNERSHIP, AND IT IS ANSWERED AS 404 ───────────────────────────────
    // 🔴 THE IDOR SHAPE, AND THE STATUS CODE IS THE CONTROL. Another shopper's
    // order must be indistinguishable from one that does not exist. A 403 would
    // confirm the id is real — an enumeration oracle over every order in the
    // store, which is exactly the defect ISSUE-067 closed on the auth side and
    // which TEST-050b exists to prevent on this one.
    //
    // ⚠️ Scoped in the WHERE rather than fetched and compared, so there is no
    // branch that can be written the wrong way round.
    const order = await prisma.order.findFirst({
      where: { id: orderId, userId },
      select: { id: true },
    })
    if (!order) {
      res.status(404).json({
        error: { code: 'ORDER_NOT_FOUND', message: 'No such order.' },
      })
      return
    }

    // 🔴 WRAPPED, BECAUSE IT CAN THROW. P2028 when the restore loop waits on a
    // product lock held by an in-flight checkout, a deadlock, a connection
    // reset. Unwrapped, Express 5 forwards the rejection to its BUILT-IN error
    // handler, which answers with an HTML body — not this project's
    // `{ error: { code, message } }` envelope that every client parser expects —
    // and includes the stack whenever NODE_ENV is not 'production'.
    // ⚠️ `routes/checkout.ts` wraps the identical call for exactly this reason.
    let result: Awaited<ReturnType<typeof applyTransition>>
    try {
      result = await applyTransition(prisma, {
        orderId: order.id,
        to: 'cancelled',
        actor: 'shopper',
        actorUserId: userId,
      })
    } catch (error) {
      console.error(`[orders] cancelling ${order.id} threw`, error)
      res.status(500).json({
        error: {
          code: 'CANCELLATION_FAILED',
          message: 'The order could not be cancelled just now. Please try again.',
        },
      })
      return
    }

    if (result.ok) {
      // 🔴 AN ALREADY-CANCELLED ORDER ANSWERS 200, NOT AN ERROR. A shopper who
      // taps twice, or whose first response was dropped, has got what they
      // asked for. Reporting a conflict for a request whose outcome already
      // holds is how a retry becomes a support ticket.
      res.status(200).json({
        orderId: order.id,
        status: 'cancelled',
        alreadyCancelled: !result.moved,
        restoredStock: result.moved ? result.restoredStock : false,
      })
      return
    }

    // 🔴 THE THREE REFUSALS MEAN DIFFERENT THINGS AND GET DIFFERENT CODES.
    // `FORBIDDEN_FOR_ACTOR` is the shopper asking for a move that exists but is
    // not theirs — fulfilment has begun, and an admin still can. 403 says "not
    // yours", which leaves them somewhere to go; 409 would say "impossible",
    // which is untrue and ends the conversation.
    // ⚠️ `ORDER_NOT_FOUND` IS 404 HERE TOO. It is reachable — the row can
    // disappear between the ownership check above and the transition — and
    // answering 409 would contradict this route's own 404 policy thirty lines
    // up, handing the caller two different codes for one condition.
    const status =
      result.reason === 'FORBIDDEN_FOR_ACTOR' ? 403 : result.reason === 'ORDER_NOT_FOUND' ? 404 : 409
    res.status(status).json({
      error: { code: result.reason, message: messageFor(result.reason) },
    })
  })

  return router
}

function messageFor(reason: string): string {
  switch (reason) {
    case 'ORDER_NOT_FOUND':
      return 'No such order.'
    case 'FORBIDDEN_FOR_ACTOR':
      return 'This order is already being prepared and can no longer be cancelled here.'
    case 'TERMINAL':
      return 'This order is already complete.'
    case 'CONCURRENT_TRANSITION':
      return 'The order changed while this was being processed. Try again.'
    default:
      return 'This order cannot be cancelled.'
  }
}
