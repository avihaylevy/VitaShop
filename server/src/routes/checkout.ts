import { Router, type RequestHandler } from 'express'
import type { PrismaClient } from '@prisma/client'
import { quoteCheckout } from '../lib/checkoutService.js'
import { deliveryEstimate } from '../lib/deliveryEstimate.js'
import { addressProblem, createOrder, findOrderByIdempotencyKey, idempotencyKeyProblem } from '../lib/orderService.js'
import { createCheckoutRateLimiters, type CheckoutRateLimiters } from '../lib/rateLimit.js'
import type { DeliveryMethodName } from '../lib/shipping.js'

/**
 * MILESTONE-008 Checkpoint D2 — `POST /api/checkout/validate` and
 * `POST /api/checkout/pay`.
 *
 * 🔴 THE ROUTE DECIDES NOTHING ABOUT MONEY, STOCK OR ELIGIBILITY. It reads the
 * request, calls a service, and maps the answer to a status code. There is no
 * price arithmetic in this file and there must never be one — §3.4, and the
 * same rule `cart.ts` states about quantity.
 *
 * 🔴 AUTHENTICATED-ONLY, per §8.2. Both routes refuse an anonymous caller.
 */

export type CheckoutRouterDeps = {
  prisma: PrismaClient
  /**
   * 🔴 INJECTABLE SO THE COVERAGE TEST CAN IDENTIFY THEM, not merely count
   * them. Same shape `createAuthRouter` already uses.
   *
   * ⚠️ The first coverage test asserted `route.stack.length >= 3` — which is
   * satisfied by any three handlers in any order, so putting the auth guard in
   * FRONT of the limiter (the ordering this file calls deliberate) left it
   * green. Handing the instances in lets the test assert WHICH handler is
   * first, which is the thing that actually matters.
   */
  rateLimiters?: CheckoutRateLimiters
}

/**
 * 🔴 THE LIMITER RUNS BEFORE THE AUTH GUARD, and the order is deliberate.
 * Guarding first would leave an unauthenticated flood hitting the session store
 * with no ceiling at all — 401s are cheap only until there are enough of them.
 * See `shopperKey`: anonymous requests bucket by IP, authenticated ones by the
 * shopper.
 */
const requireShopper: RequestHandler = (req, res, next) => {
  const userId = req.session?.userId
  if (typeof userId !== 'string' || userId === '') {
    // ⚠️ The same shape every other refusal in this project uses, and it says
    // nothing about carts, orders or whether any exist.
    res.status(401).json({
      error: { code: 'AUTHENTICATION_REQUIRED', message: 'Sign in to continue to checkout.' },
    })
    return
  }
  next()
}

/** Reads the delivery method without trusting it — the service checks it. */
function readDeliveryMethod(body: Record<string, unknown>): DeliveryMethodName {
  return body.deliveryMethod as DeliveryMethodName
}

function readAddress(body: Record<string, unknown>): {
  line1: string; city: string; zipCode?: string | null
} | null {
  const address = body.address
  if (address === null || typeof address !== 'object') return null
  const { line1, city, zipCode } = address as Record<string, unknown>
  if (typeof line1 !== 'string' || typeof city !== 'string') return null
  return { line1, city, zipCode: typeof zipCode === 'string' ? zipCode : null }
}

export function createCheckoutRouter(deps: CheckoutRouterDeps): ReturnType<typeof Router> {
  const { prisma } = deps
  const limiters = deps.rateLimiters ?? createCheckoutRateLimiters()
  const router = Router()

  /**
   * REQ-F-042's re-check, as a READ. It creates nothing: a shopper may call it
   * as often as the screen needs.
   */
  router.post('/validate', limiters.validate, requireShopper, async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const result = await quoteCheckout(prisma, {
      userId: req.session!.userId!,
      deliveryMethod: readDeliveryMethod(body),
    })

    if (!result.ok) {
      // 🔴 409, NOT 400, for UNPURCHASABLE_LINE and EMPTY_CART. The request is
      // well-formed; the WORLD moved. A 400 tells the client it sent something
      // wrong and invites it to fix the payload, which cannot help — the fix is
      // to change the cart. Only a malformed delivery method is the client's
      // fault.
      const status = result.reason === 'INVALID_DELIVERY_METHOD' ? 400 : 409
      res.status(status).json({ error: { code: result.reason, ...detailOf(result) } })
      return
    }

    res.json(result.quote)
  })

  /**
   * REQ-F-043's simulated payment, and REQ-F-042's gate closing on it.
   *
   * 🔴 THE ORDER OF THE THREE CHECKS IS THE CONTRACT:
   *   1. re-quote from LIVE data — never from anything the client sent
   *   2. compare the fingerprint — a mismatch HALTS and returns the NEW quote
   *   3. simulate the payment, and only then create the order
   */
  router.post('/pay', limiters.pay, requireShopper, async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const userId = req.session!.userId!

    // ── 0. THE RETRY, ANSWERED BEFORE ANYTHING ELSE IS EVALUATED ───────────
    // 🔴 THIS RAN NOWHERE, AND ITS ABSENCE BROKE INV-05 FROM THE OUTSIDE. A
    // successful order empties the cart inside `createOrder`'s transaction, so a
    // client retrying a dropped response with the same key reached the re-quote
    // below, found an empty cart, and was told "this order cannot be placed" —
    // while the order existed and its number appeared nowhere in the reply.
    // `createOrder`'s replay lookup was unreachable through this route.
    //
    // ⚠️ BEFORE the fingerprint check, the re-quote and the payment, all three
    // deliberately. "Did my order go through" is not a question about the cart,
    // the prices or the stock — the order either exists or it does not, and a
    // retry must answer the same way every time.
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : ''
    const replay = await findOrderByIdempotencyKey(prisma, userId, idempotencyKey)
    if (replay) {
      res.status(200).json({
        orderId: replay.orderId,
        orderNumber: replay.orderNumber,
        totalAmount: replay.totalAmount,
        shippingCost: replay.shippingCost,
        replayed: true,
        // 🔴 FROM THE STORED ORDER, not from a quote. This path deliberately
        // never re-quotes — the cart is empty once an order exists — so the
        // estimate has to come from the method the order FROZE. It was omitted
        // entirely at first, which rendered the confirmation screen's delivery
        // promise from `undefined` for every shopper whose first response was
        // dropped.
        estimate: deliveryEstimate(replay.deliveryMethod),
      })
      return
    }

    if (typeof body.fingerprint !== 'string' || body.fingerprint === '') {
      res.status(400).json({
        error: { code: 'FINGERPRINT_REQUIRED', message: 'A confirmation is required before payment.' },
      })
      return
    }

    // ── 1. THE INDEPENDENT RE-CHECK ────────────────────────────────────────
    // 🔴 TEST-042 Scenario C. This runs whether or not `/validate` was ever
    // called, which is what makes skipping it useless rather than forbidden.
    const requote = await quoteCheckout(prisma, {
      userId,
      deliveryMethod: readDeliveryMethod(body),
    })
    if (!requote.ok) {
      const status = requote.reason === 'INVALID_DELIVERY_METHOD' ? 400 : 409
      res.status(status).json({ error: { code: requote.reason, ...detailOf(requote) } })
      return
    }

    // ── 2. THE GATE ────────────────────────────────────────────────────────
    // 🔴 DEC-060. The digest is re-derived above from the database; the client's
    // copy is only ever compared, never read for a value.
    if (requote.quote.fingerprint !== body.fingerprint) {
      // ⚠️ THE NEW QUOTE TRAVELS WITH THE REFUSAL. REQ-F-042 requires the
      // updated values to be SHOWN and confirmed — a bare 409 would leave the
      // client to guess what moved, or to re-request and race again.
      res.status(409).json({
        error: {
          code: 'CHECKOUT_CHANGED',
          message: 'The order changed. Review the updated details and confirm again.',
        },
        quote: requote.quote,
      })
      return
    }

    // ── 3. THE SIMULATED PAYMENT ───────────────────────────────────────────
    // 🔴 REQ-F-043: EXPLICITLY A SIMULATION. No provider, no API key, no
    // credential handling, and 🔴 NO CARD DATA — nothing resembling a card
    // number is read from this body, stored, or logged. The requirement is that
    // BOTH outcomes are triggerable, so the trigger is an honest, named field
    // rather than a fake card number that would look like the real thing.
    // ⚠️ Client-chosen, and that costs nothing: there is no money to bypass. A
    // shopper who "chooses success" has simulated a successful payment, which
    // is the whole of what this route models.
    // 🔴 THE KEY IS CHECKED BESIDE THE ADDRESS, AND FOR THE IDENTICAL REASON.
    // It was validated only inside `createOrder`, below the payment: a shopper
    // whose browser has no `crypto.randomUUID` — an insecure origin, the
    // trigger `orderService`'s header names — was told the payment succeeded
    // and then that the order could not be placed. Same defect as the address
    // one, in the same handler, fixed in the same place.
    const keyFault = idempotencyKeyProblem(body.idempotencyKey)
    if (keyFault) {
      res.status(400).json({
        error: { code: keyFault, message: 'A valid idempotency key is required.' },
      })
      return
    }

    // 🔴 THE ADDRESS IS CHECKED BEFORE THE PAYMENT, NOT AFTER IT. The rule lived
    // only inside `createOrder`'s transaction, which runs at step 4 — so a
    // courier order with a blank `line1` was accepted at the payment step and
    // then refused, telling a shopper who believed they had paid that "the order
    // could not be placed". It is a MALFORMED PAYLOAD, and it is answered as one.
    // ⚠️ `addressProblem`, imported — not a second copy of `line1 && city`.
    const addressFault = addressProblem(requote.quote.deliveryMethod, readAddress(body))
    if (addressFault) {
      res.status(400).json({
        error: {
          code: addressFault,
          message:
            addressFault === 'ADDRESS_REQUIRED'
              ? 'A delivery address is required for this delivery method.'
              : 'Self pickup cannot carry a delivery address.',
        },
      })
      return
    }

    // 🔴 AN ALLOWLIST, BECAUSE THE FIRST VERSION FAILED OPEN. Only the exact
    // string 'failure' declined, so 'Failure', 'fail', 'declined' — or a typo in
    // a client — placed a REAL order and decremented stock while the shopper was
    // asking for a decline. Anything not on the list is now the client's error,
    // which is the safe direction: a rejected request costs a round trip, an
    // unwanted order costs stock.
    const outcome = body.simulatedOutcome ?? 'success'
    if (outcome !== 'success' && outcome !== 'failure') {
      res.status(400).json({
        error: {
          code: 'INVALID_PAYMENT_OUTCOME',
          message: 'The simulated payment outcome must be "success" or "failure".',
        },
      })
      return
    }

    if (outcome === 'failure') {
      // 🔴 REQ-F-045 from the shopper's side: NO order, stock untouched, cart
      // preserved. Nothing is written here — the refusal happens BEFORE
      // `createOrder`, so there is no rollback to get wrong.
      res.status(402).json({
        error: { code: 'PAYMENT_DECLINED', message: 'The payment was declined. Your cart is unchanged.' },
      })
      return
    }

    // ── 4. THE ORDER ───────────────────────────────────────────────────────
    // Everything about money, stock and idempotency is INV-01/02/05's, inside
    // `createOrder`'s single transaction. This route re-decides none of it.
    const order = await createOrder(prisma, {
      userId,
      idempotencyKey,
      deliveryMethod: requote.quote.deliveryMethod,
      address: readAddress(body),
      // 🔴 THE GATE, CLOSED WHERE IT HOLDS. The comparison at step 2 is against
      // a LOCK-FREE quote; this hands the same digest into the transaction,
      // which recomputes it from LOCKED rows. Without it the window between
      // this route's check and that transaction is unguarded, and
      // `checkoutFingerprint.ts`'s "you cannot pay for a state that is not the
      // current one" is not true.
      expectedFingerprint: body.fingerprint,
    })

    if (!order.ok) {
      // ⚠️ THE ADDRESS AND KEY REASONS ARE 400, NOT 409. They are a malformed
      // payload, and answering them with the status this route uses for "the
      // world moved, re-quote and confirm" sends a compliant client into a loop
      // it cannot exit. They are already refused above; this is the backstop.
      if (
        order.reason === 'INVALID_IDEMPOTENCY_KEY' ||
        order.reason === 'INVALID_DELIVERY_METHOD' ||
        order.reason === 'ADDRESS_REQUIRED' ||
        order.reason === 'ADDRESS_NOT_ALLOWED'
      ) {
        res.status(400).json({ error: { code: order.reason, ...orderDetailOf(order) } })
        return
      }

      // 🔴 EVERY REMAINING FAILURE IS "THE WORLD MOVED", AND ALL OF THEM ARE
      // ANSWERED WITH THE CURRENT STATE — one shape, so a client has one thing
      // to handle.
      //
      // ⚠️ TWO DEFECTS THIS CLOSES, and both came from passing the service's
      // answer straight through:
      //   · CHECKOUT_CHANGED arrived with NO `quote`, while step 2 above
      //     documents that a halt carries one. A client written to the
      //     documented contract read `body.quote.totalAmount` and got a
      //     TypeError — or showed a halt with no figures and no way forward.
      //   · UNPURCHASABLE_LINE arrived with NO `lineId`, while the same code
      //     from `/validate` carries one. ISSUE-080's whole point is that the
      //     client must be able to point at the offending ROW; a client that
      //     highlights by line id worked on one halt and silently failed on the
      //     other — and this is the halt a shopper reaches after stock moved
      //     mid-checkout.
      //
      // Re-reading is also the more honest answer: by the time we are here the
      // figures the transaction refused are already history, and what the
      // shopper needs is what is true NOW.
      await haltWithCurrentState(res, prisma, userId, requote.quote.deliveryMethod, order.reason)
      return
    }

    // ⚠️ THE ORDER IS `pending_payment`, NOT `paid`. §8.9 makes
    // `pending_payment -> paid` a SYSTEM transition and Checkpoint D3 writes it
    // together with INV-04's email. Stated here so the gap is visible rather
    // than discovered: a simulated payment has succeeded and the order does not
    // yet say so.
    // 🔴 200 WHEN IT WAS A REPLAY, 201 ONLY FOR A NEW ORDER. `createOrder` can
    // return `replayed: true` here — two `/pay` calls with one key racing, both
    // passing step 0 before either committed, the loser answered by
    // `orderService`'s own layer-one lookup. Reporting 201 for that told a
    // client (or a conversion counter) that a SECOND order had been created,
    // double-counting one order. The sequential retry already answers 200 for
    // the identical semantic; these two must not disagree.
    res.status(order.replayed ? 200 : 201).json({
      orderId: order.orderId,
      orderNumber: order.orderNumber,
      totalAmount: order.totalAmount,
      shippingCost: order.shippingCost,
      replayed: order.replayed,
      estimate: requote.quote.estimate,
    })
  })

  return router
}

/**
 * 🔴 THE ONE HALT SHAPE. Re-reads the world and answers with what is true now:
 * either the blocked lines — WITH their line ids, so the client can point at the
 * row — or a fresh quote to re-confirm.
 *
 * ⚠️ The re-quote can come back OK, because the condition that stopped the
 * transaction may already have cleared (another shopper's order rolled back,
 * stock restored). That is not an error and must not be reported as success
 * either: something moved under a confirmed checkout, so the shopper re-confirms
 * against the new figures. `CHECKOUT_CHANGED` with a quote is exactly that
 * message, and it is the same shape step 2 sends.
 */
export async function haltWithCurrentState(
  res: Parameters<RequestHandler>[1],
  prisma: PrismaClient,
  userId: string,
  deliveryMethod: DeliveryMethodName,
  originalReason: string,
): Promise<void> {
  const fresh = await quoteCheckout(prisma, { userId, deliveryMethod })

  if (!fresh.ok) {
    res.status(409).json({
      error: { code: fresh.reason, ...detailOf(fresh) },
      // ⚠️ Kept so a support log can tell WHICH check stopped it — the
      // transaction's answer and the current state need not agree.
      haltedBy: originalReason,
    })
    return
  }

  res.status(409).json({
    error: {
      code: 'CHECKOUT_CHANGED',
      message: 'The order changed. Review the updated details and confirm again.',
    },
    quote: fresh.quote,
    haltedBy: originalReason,
  })
}

/** Carries the service's own detail onto the error body, when it has any. */
function detailOf(result: Awaited<ReturnType<typeof quoteCheckout>>): Record<string, unknown> {
  if (!result.ok && result.reason === 'UNPURCHASABLE_LINE') {
    return { message: 'Some items cannot be bought right now.', lines: result.lines }
  }
  return { message: 'This order cannot be placed as it stands.' }
}

function orderDetailOf(order: Awaited<ReturnType<typeof createOrder>>): Record<string, unknown> {
  if (order.ok) return {}
  if (order.reason === 'UNPURCHASABLE_LINE') {
    return { message: 'Some items cannot be bought right now.', lines: order.lines }
  }
  if (order.reason === 'INSUFFICIENT_STOCK') {
    return { message: 'There is not enough stock for one of the items.', slug: order.slug }
  }
  return { message: 'The order could not be placed.' }
}
