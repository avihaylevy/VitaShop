import { Router, type Request, type RequestHandler, type Response } from 'express'
import type { PrismaClient } from '@prisma/client'
import { quoteCheckout } from '../lib/checkoutService.js'
import { deliveryEstimate, type DeliveryEstimate } from '../lib/deliveryEstimate.js'
import { addressProblem, createOrder, findOrderByIdempotencyKey, idempotencyKeyProblem } from '../lib/orderService.js'
import { createCheckoutRateLimiters, type CheckoutRateLimiters } from '../lib/rateLimit.js'
import { applyTransition, type ApplyTransitionResult } from '../lib/orderTransitionService.js'
import { emailStrings, deliveryPromiseHe } from '../lib/emailStrings.js'
import type { EmailService } from '../lib/emailService.js'
import type { DeliveryMethodName } from '../lib/shipping.js'
import { requireShopper } from './requireShopper.js'
import { createRequireVerifiedShopper } from './requireActiveShopper.js'
import { saveShopperAddress } from '../lib/saveShopperAddress.js'
import { recordCheckoutStarted, recordFunnelEvent } from '../lib/funnelEvents.js'
import { ensureVisitorId } from '../lib/visitorId.js'

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
   * 🔴 INV-04's transport, INJECTED — so a test can make the send FAIL and
   * prove the order survives it (TEST-044c). A module-level import could not
   * be made to fail without mocking the module, which proves less.
   */
  emailService: EmailService
  /**
   * 🔴 INJECTABLE FOR ONE REASON: so a test can make the paid transition THROW
   * and prove the response is still 201. A `{ok:false}` answer was covered;
   * throwing was not, and a thrown database error was the case that produced a
   * 500 for an order that already existed.
   */
  markPaid?: (prisma: PrismaClient, orderId: string) => Promise<ApplyTransitionResult>
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
  /**
   * 🔴 A DELIBERATE TEST SEAM, empty in production — same reasoning as
   * `ApplyTransitionHooks.afterRead`. `/pay` deliberately writes the RESPONSE
   * before awaiting the confirmation send (INV-04), so `await fetch` resolves
   * while the handler's tail is still running. A test asserting an ABSENCE
   * ("no email was sent") therefore has nothing to wait on: the assertion
   * passes whether the guarantee holds or the send simply has not landed yet
   * — the review round on ISSUE-094's fix found exactly three such vacuous
   * assertions. This hook fires when the `/pay` handler has FULLY finished,
   * every path, success or refusal — the quiescence signal an absence needs.
   */
  hooks?: { afterPayHandled?: () => void }
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
  /*
   * 🔴 REQ-F-031's gate — O3, enforced for the first time. "An unverified
   * account cannot complete an order" is `Approved` from the specification and
   * A9 handed it to this milestone; until now NOTHING implemented it, so an
   * account that never opened its verification mail could sign in and pay.
   * ISSUE-091.
   *
   * ⚠️ It gates `/validate` as well as `/pay`, deliberately: refusing only at
   * the payment lets a shopper fill in an address and choose a delivery method
   * before being told they cannot order at all.
   */
  const requireVerifiedShopper = createRequireVerifiedShopper(deps.prisma)

  /**
   * REQ-F-042's re-check. A read for CHECKOUT STATE — it creates no order,
   * no cart change, no reservation, and a shopper may call it as often as
   * the screen needs. ⚠️ Since DEC-101 it does write ONE analytics row per
   * session per 30 minutes (the deduped checkout_started funnel event), so
   * "creates nothing" is no longer literally true — never cache or replay
   * this handler on the strength of the old comment.
   */
  router.post('/validate', limiters.validate, requireShopper, requireVerifiedShopper, async (req, res) => {
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

    // DEC-101 / §4.7.5 — checkout_started, recorded only when the quote is
    // servable (a malformed method or an empty cart never started a
    // checkout). Deduplicated inside the lib: /validate is a read the
    // screen repeats, and one checkout must count once. `void` — analytics
    // never blocks the response.
    void recordCheckoutStarted(prisma, {
      // DEC-103 — the durable visitor id, before res.json writes headers.
      sessionId: ensureVisitorId(req, res),
      userId: req.session!.userId!,
    })

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
  router.post('/pay', limiters.pay, requireShopper, requireVerifiedShopper, async (req, res) => {
    // The quiescence seam — see `hooks` on the deps. `finally`, so every
    // return path (refusals, replays, the post-response send, throws) fires
    // it exactly once when the handler is genuinely done.
    try {
      await handlePay(req, res)
    } finally {
      deps.hooks?.afterPayHandled?.()
    }
  })

  async function handlePay(req: Request, res: Response): Promise<void> {
    const body = (req.body ?? {}) as Record<string, unknown>
    const userId = req.session!.userId!
    // DEC-103 — captured HERE, at the top: the purchase_completed record
    // below runs AFTER respondWithOrder, when Set-Cookie can no longer be
    // written; ensureVisitorId guards headersSent, but capturing early
    // means a first-request payer still gets the cookie.
    const visitorId = ensureVisitorId(req, res)

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
      // 🔴 A REPLAY IS NOT ALWAYS A CONFIRMATION, and Checkpoint E3 is what made
      // that reachable. The shopper pays with key K, CANCELS the order, then
      // their client retries /pay with K — a double submit, an offline retry, a
      // back button. The order is found, and answering with the ordinary
      // confirmation payload presents an order that is cancelled and whose
      // stock has already gone back as though it were live. Before a shopper
      // could cancel, this shape did not exist.
      if (replay.status === 'cancelled') {
        res.status(409).json({
          error: {
            code: 'ORDER_CANCELLED',
            message: 'This order was cancelled. Start a new checkout to order again.',
          },
          orderNumber: replay.orderNumber,
        })
        return
      }

      // 🔴 THE REPAIR ONLY APPLIES TO AN ORDER STILL AWAITING IT. Calling it for
      // an order already `paid`, `shipped` or `delivered` is a no-op that logs a
      // TERMINAL refusal as if something were wrong — noise that would train a
      // reader to ignore the one line that matters.
      if (replay.status === 'pending_payment') {
        // The order and the transition are two transactions, so a connection
        // drop between them leaves an order committed at `pending_payment` with
        // nothing to move it — §8.9 allows only `paid` or `cancelled` from
        // there, so not even an admin can push it to `processing`.
        // ⚠️ Safe to call: the transition is idempotent.
        //
        // 🔴 IT REPAIRS ONE CAUSE, NOT THE CONDITION — ISSUE-082. This only
        // helps when a retry actually arrives. When `settleAsPaid` swallows a
        // real failure the shopper receives a 201, so no retry is ever sent and
        // the order is just as stuck. Closing that needs the reconciliation
        // sweep, which is `lib/orderReconciliation.ts`.
        await settleAsPaid(deps, replay.orderId, replay.orderNumber)
      }

      res.status(200).json({
        orderId: replay.orderId,
        orderNumber: replay.orderNumber,
        totalAmount: replay.totalAmount,
        shippingCost: replay.shippingCost,
        replayed: true,
        // 🔴 REPORTED, so a client can tell a live order from one that moved on.
        // Its absence is what let a cancelled order render as a confirmation.
        status: replay.status,
        // 🔴 FROM THE STORED ORDER, not from a quote. This path deliberately
        // never re-quotes — the cart is empty once an order exists — so the
        // estimate has to come from the method the order FROZE.
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

    // ── 5. THE PAID TRANSITION — §8.9's ONE SYSTEM MOVE ───────────────────
    // 🔴 AFTER the order transaction, in its own. The simulated payment
    // succeeded, so the order stops being `pending_payment`. The actor is NULL:
    // no human moved it, which is exactly what the nullable column means.
    //
    // ⚠️ ITS FAILURE DOES NOT UNDO THE ORDER. The order is committed, the stock
    // is decremented and the shopper has paid; refusing the response now would
    // tell them checkout failed for an order that exists — the same lie the
    // unreachable replay told. A status that lags is a support problem; a
    // phantom failure is a lost order.
    await settleAsPaid(deps, order.orderId, order.orderNumber)

    // DEC-101 / §4.7.5 — purchase_completed, the primary conversion (§1.6).
    // 🔴 NOT on a replay: `createOrder` answers `replayed: true` when two
    // /pay calls race on one key, and counting that would double-count one
    // order — the exact defect respondWithOrder's 200-vs-201 note records.
    // Step 0's sequential replay path records none either; the two agree.
    if (!order.replayed) {
      void recordFunnelEvent(prisma, {
        eventType: 'purchase_completed',
        sessionId: visitorId,
        userId,
        orderId: order.orderId,
      })
    }

    // ── 5b. ISSUE-093 — THE ADDRESS, SAVED ONLY IF THE SHOPPER ASKED ────────
    // 🔴 AFTER THE COMMIT, AWAITED BUT NEVER ABLE TO FAIL THE REQUEST. The
    // same placement rule INV-04 gives the email, for the same reason: the
    // ORDER must survive. `saveShopperAddress` returns rather than throws.
    //
    // ⚠️ OPT-IN, DEFAULT OFF. The address is already stored on the order
    // (INV-02), so this adds no new personal data — it indexes what is already
    // held so a returning shopper need not retype it. Doing it silently would
    // hand someone who shipped a one-off gift that address as their default.
    if (body.saveAddress === true) {
      await saveShopperAddress(prisma, { userId, address: readAddress(body) })
    }

    // ── 6. INV-04 — THE EMAIL, AFTER THE COMMIT AND OUTSIDE EVERY TRANSACTION ─
    // 🔴 THE INVARIANT IS THE ORDERING, AND THIS IS THE ONLY PLACE IT CAN HOLD.
    // Every write above is committed before this line runs. A mail failure is
    // LOGGED AND SWALLOWED — never rethrown, never rolled back — because INV-04
    // says the order survives it, and TEST-044c is the test that proves it.
    //
    // ⚠️ HEBREW ONLY (DEC-054 / A11-SERVER). There is no i18next on the server
    // and no `locale` column; `Accept-Language` was rejected precisely because
    // this send happens outside the request that carried the header.
    //
    // 🔴 NOT ON A REPLAY. `createOrder` can answer `replayed: true` here when
    // two `/pay` calls race, and sending again would put a SECOND confirmation
    // for one order in the shopper's inbox. Step 0's replay path sends none;
    // these two must agree.
    // 🔴 THE SHORT-CIRCUIT IS OUTSIDE THE TRY, and that placement is not
    // cosmetic. Inside it, a throw from `res.json` — a destroyed socket, a
    // serialization error — was swallowed by the email's catch and execution
    // fell through to the second `respondWithOrder` below: ERR_HTTP_HEADERS_SENT
    // as an unhandled rejection instead of a clean failure. Control flow does
    // not belong in a block whose catch is designed to swallow everything.
    if (order.replayed) {
      respondWithOrder(res, order, requote.quote.estimate)
      return
    }

    // 🔴 THE RESPONSE GOES FIRST, AND THE EMAIL FOLLOWS IT.
    //
    // ⚠️ THIS WAS THE LAST PATH THAT COULD STILL PRODUCE A PHANTOM FAILURE, the
    // fourth time that shape has appeared in this checkpoint. The send sat
    // BETWEEN the committed order and the response. `emailService.ts` says
    // moving to SMTP is "a swap of implementation plus an environment variable —
    // no caller changes", and with SMTP a hung connection (Node's socket
    // timeouts are minutes) stalls `POST /pay` past the browser's own timeout.
    // The shopper sees a failed checkout for an order that is committed, paid
    // and has already emptied their cart — and their retry is answered at step
    // 0, which deliberately sends no email, so the confirmation never arrives
    // either.
    //
    // Writing the response first makes the send's duration irrelevant to the
    // shopper. It is still AWAITED so the handler's promise covers it — an
    // unawaited send would surface a rejection with no request to attribute it
    // to — and BOUNDED, so a hung transport cannot hold the handler open
    // indefinitely.
    respondWithOrder(res, order, requote.quote.estimate)
    await sendConfirmation(deps, {
      userId,
      orderId: order.orderId,
      orderNumber: order.orderNumber,
      shippingCost: order.shippingCost,
      totalAmount: order.totalAmount,
      estimate: requote.quote.estimate,
    })

  }

  return router
}

/** How long a confirmation send may take before it is abandoned and logged. */
const CONFIRMATION_SEND_TIMEOUT_MS = 10_000

/**
 * INV-04's send, AFTER the response has been written.
 *
 * 🔴 A MAIL FAILURE IS LOGGED AND SWALLOWED — never rethrown, never rolled
 * back. The order is committed, paid and the cart emptied by the time this
 * runs, and TEST-044c is the test that pins it.
 *
 * ⚠️ HEBREW ONLY (DEC-054 / A11-SERVER). There is no i18next on the server and
 * no `locale` column; `Accept-Language` was rejected precisely because this send
 * happens outside the request that carried the header.
 *
 * ⚠️ ONE QUERY, NOT TWO. The shopper's address and the order's frozen lines were
 * fetched separately, which is two round trips for one email.
 */
async function sendConfirmation(
  deps: CheckoutRouterDeps,
  details: {
    userId: string
    orderId: string
    orderNumber: string
    shippingCost: string
    totalAmount: string
    estimate: DeliveryEstimate
  },
): Promise<void> {
  try {
    const placed = await deps.prisma.order.findUniqueOrThrow({
      where: { id: details.orderId },
      select: {
        user: { select: { email: true } },
        items: {
          // 🔴 A STABLE ORDER. Postgres returns rows in whatever order it likes
          // without one, so the same order could list its lines differently on
          // two reads. This email exists to be CHECKED against a screen, and a
          // summary whose lines move is one a shopper cannot check. The order
          // transaction already writes them in ascending productId.
          orderBy: { productId: 'asc' },
          select: {
            quantity: true,
            unitPriceAtPurchase: true,
            // 🔴 INV-02's FROZEN name and price, not the product row's. An
            // email re-read next month must still say what was bought and
            // charged, not what the catalogue says today.
            productNameHeAtPurchase: true,
          },
        },
      },
    })

    const mail = emailStrings.orderConfirmation({
      orderNumber: details.orderNumber,
      lines: placed.items.map((item) => ({
        name: item.productNameHeAtPurchase,
        quantity: item.quantity,
        unitPrice: item.unitPriceAtPurchase.toFixed(2),
      })),
      shippingCost: details.shippingCost,
      totalAmount: details.totalAmount,
      deliveryPromise: deliveryPromiseHe(details.estimate),
    })

    // 🔴 BOUNDED. The response is already written, so a slow send costs the
    // shopper nothing — but an unbounded one would hold this handler open for
    // as long as a hung SMTP socket takes to notice, which is minutes.
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`confirmation send exceeded ${CONFIRMATION_SEND_TIMEOUT_MS}ms`)),
        CONFIRMATION_SEND_TIMEOUT_MS,
      )
    })
    try {
      await Promise.race([deps.emailService.send({ to: placed.user.email, ...mail }), timeout])
    } finally {
      if (timer) clearTimeout(timer)
    }
  } catch (error) {
    console.error(`[checkout] confirmation email failed for ${details.orderNumber}`, error)
  }
}

/**
 * The success body, in ONE place — the replay short-circuit above and the
 * ordinary exit both come here, so they cannot drift into different shapes.
 *
 * 🔴 200 WHEN IT WAS A REPLAY, 201 ONLY FOR A NEW ORDER. `createOrder` can
 * answer `replayed: true` when two `/pay` calls with one key race, both passing
 * step 0 before either committed, the loser answered by `orderService`'s own
 * layer-one lookup. Reporting 201 for that told a client — or a conversion
 * counter — that a SECOND order had been created, double-counting one order.
 * The sequential retry already answers 200 for the identical semantic.
 */
function respondWithOrder(
  res: Parameters<RequestHandler>[1],
  order: Extract<Awaited<ReturnType<typeof createOrder>>, { ok: true }>,
  estimate: DeliveryEstimate,
): void {
  res.status(order.replayed ? 200 : 201).json({
    orderId: order.orderId,
    orderNumber: order.orderNumber,
    totalAmount: order.totalAmount,
    shippingCost: order.shippingCost,
    replayed: order.replayed,
    estimate,
  })
}

/**
 * 🔴 THE PAID TRANSITION, AND IT CAN NEVER FAIL THE REQUEST.
 *
 * ⚠️ A `{ok:false}` ANSWER WAS HANDLED AND A THROW WAS NOT — and it can throw:
 * a connection reset, a P2028 transaction timeout, a deadlock. The order is
 * committed, the stock decremented and the cart emptied by the time this runs,
 * so an exception here produced a 500 for an order that exists. That is the
 * same lie the unreachable replay told, and the third of four times that shape
 * appeared in Checkpoint D: a route that creates state in steps needs ONE
 * answer for "a later step failed", not one per step.
 *
 * A status that lags is a support problem. A phantom failure is a lost order.
 *
 * 🔴 IT GOES THROUGH §8.9's TABLE NOW. Checkpoint D3 called a one-transition
 * module of its own (`lib/orderPaid.ts`), written narrow so E2 could absorb it
 * by DELETION rather than leave two implementations to agree. `system` is the
 * actor, which §8.9 permits for exactly this move and no other, and the history
 * row's null actor means "no human moved this".
 */
async function settleAsPaid(
  deps: CheckoutRouterDeps,
  orderId: string,
  orderNumber: string,
): Promise<void> {
  const markPaid =
    deps.markPaid ??
    ((prisma: PrismaClient, id: string) =>
      applyTransition(prisma, { orderId: id, to: 'paid', actor: 'system' }))
  try {
    const paid = await markPaid(deps.prisma, orderId)
    if (!paid.ok) {
      console.error(`[checkout] order ${orderNumber} could not move to paid: ${paid.reason}`)
    }
  } catch (error) {
    console.error(`[checkout] the paid transition threw for order ${orderNumber}`, error)
  }
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
