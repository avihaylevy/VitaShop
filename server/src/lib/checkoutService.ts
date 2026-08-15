import type { PrismaClient } from '@prisma/client'
import { getCart, type CartLineDto } from './cartService.js'
import { computeShipping, toAgorot, DELIVERY_METHODS, type DeliveryMethodName, type ShippingDto } from './shipping.js'
import { availableToBuy, unpurchasableReason, type UnpurchasableReason } from './purchasability.js'
import { deliveryEstimate, type DeliveryEstimate } from './deliveryEstimate.js'
import { checkoutFingerprint } from './checkoutFingerprint.js'

/**
 * MILESTONE-008 Checkpoint D1 — REQ-F-042's re-check, and the figures the
 * shopper confirms.
 *
 * `/checkout/validate` calls this. It reports what the order WOULD be right
 * now, and a fingerprint of exactly those figures (DEC-060). `/checkout/pay`
 * later re-derives the same fingerprint from live data and refuses if it moved.
 *
 * 🔴 IT COMPUTES NO MONEY OF ITS OWN, and that is the whole design. The
 * subtotal, the shipping basis and the purchasable-line rule already live in
 * `cartService.toDto`, which `getCart` returns. Summing prices again here would
 * be the THIRD implementation of the same arithmetic — and this project has
 * already paid for the second one twice: `lib/purchasability.ts` exists because
 * the cart's rule and checkout's rule drifted apart on two separate occasions,
 * and both times the shopper was promised free shipping on an order checkout
 * would refuse.
 *
 * ⚠️ So the ONE figure re-derived here is shipping, and only because the CART
 * has no delivery method — it is chosen at checkout. It is re-derived from the
 * basis `getCart` already computed, not from the lines, so the purchasable-line
 * filter is still applied exactly once, in one place.
 */

/** A line that cannot be bought, named so the UI can say which and why. */
export type BlockedLine = {
  lineId: string
  slug: string
  why: UnpurchasableReason
  /** 🔴 0 unless SHORT_STOCK — see `availableToBuy`'s reasoning. */
  available: number
}

export type CheckoutQuote = {
  lines: readonly CartLineDto[]
  /**
   * The seventh list, item 2 — copied from the cart DTO, never recomputed
   * here (this file's header: it computes no money of its own). `clubMember`
   * chooses copy; `clubSavings` is the included-discount figure the summary
   * states — and on THIS surface it is MEMBER-ONLY: a non-member quote
   * carries '0.00', so the wire cannot express the join-pitch reading the
   * confirm-and-pay screen bans (review finding — the ban used to live in
   * one JSX conditional).
   *
   * 🔴 NOT part of the fingerprint, and honestly: it derives from the BASE
   * price, which is NOT fingerprinted (the digest carries the member
   * unitPrice). Two base prices can round to one member price, so a base
   * change between /validate and /pay can drift this figure by an agora
   * while the fingerprint holds. Accepted: it is display, and the charged
   * total — which IS fingerprinted — cannot move.
   */
  clubMember: boolean
  clubSavings: string
  /** The purchasable total the threshold is measured on. */
  basis: string
  shipping: ShippingDto
  /** 🔴 basis + shipping. The figure the shopper confirms and is charged. */
  totalAmount: string
  deliveryMethod: DeliveryMethodName
  estimate: DeliveryEstimate
  /**
   * 🔴 DEC-060. Opaque to the client, and it must be sent back to `/pay`
   * unchanged. It is a digest of these exact figures — see
   * `checkoutFingerprint.ts` for why it carries no secret and no expiry.
   */
  fingerprint: string
}

export type CheckoutQuoteResult =
  | { ok: true; quote: CheckoutQuote }
  | { ok: false; reason: 'EMPTY_CART' }
  | { ok: false; reason: 'INVALID_DELIVERY_METHOD' }
  /**
   * 🔴 REQ-F-042's halt, in its first form: the cart cannot become an order at
   * all. Named lines, because a banner that says "something is wrong" without
   * saying WHICH line is a dead end — ISSUE-080 records exactly that failure on
   * the cart page.
   */
  | { ok: false; reason: 'UNPURCHASABLE_LINE'; lines: BlockedLine[] }

export type CheckoutQuoteInput = {
  userId: string
  deliveryMethod: DeliveryMethodName
}

export async function quoteCheckout(
  prisma: PrismaClient,
  input: CheckoutQuoteInput,
): Promise<CheckoutQuoteResult> {
  const { userId, deliveryMethod } = input

  // 🔴 Checked like any other client-supplied value, and BEFORE the read. An
  // unknown string otherwise falls through `computeShipping`'s courier path,
  // quoting ₪30 and a threshold for a method that does not exist.
  // ⚠️ `orderService` makes the same check AFTER its replay lookup, deliberately
  // — a retry must answer the same key the same way. There is nothing to replay
  // here: quoting is a read, so refusing early costs nothing.
  if (!DELIVERY_METHODS.includes(deliveryMethod)) {
    return { ok: false, reason: 'INVALID_DELIVERY_METHOD' }
  }

  // 🔴 THE SAME READ THE CART PAGE USES. Not a parallel query with its own
  // select — a second read shaped differently is a second place for the DTO to
  // drift, and the checkout summary must show the figures the cart showed.
  const cart = await getCart(prisma, { userId })
  if (cart.items.length === 0) return { ok: false, reason: 'EMPTY_CART' }

  // 🔴 REPORTED PER LINE, not as a single flag. `cart.hasBlockingLine` says
  // THAT something blocks; the shopper needs to know WHICH and what to do, and
  // the three causes have three different next actions (see
  // `purchasability.ts`).
  const blocked = cart.items
    .map((line) => {
      const why = unpurchasableReason(line)
      return why === null
        ? null
        : {
            lineId: line.id,
            slug: line.slug,
            why,
            // 🔴 THE SHARED FUNCTION, not the expression it contains. This was
            // written out inline — `why === 'SHORT_STOCK' ? Math.max(...) : 0`
            // — three lines below a header arguing that `purchasability.ts`
            // exists precisely because this rule drifted twice. Correct on the
            // day, and the same hazard the module was created to remove.
            available: availableToBuy(line),
          }
    })
    .filter((line): line is BlockedLine => line !== null)

  if (blocked.length > 0) {
    return { ok: false, reason: 'UNPURCHASABLE_LINE', lines: blocked }
  }

  // ⚠️ THE ONE RE-DERIVATION, and it is a re-derivation rather than a
  // recomputation: the basis comes from `getCart`, which applied the shared
  // purchasable filter. Only the METHOD is new — the cart has none, because one
  // is chosen here.
  // 🔴 `toAgorot` of a canonical two-decimal string is exact; no float
  // round-trip is introduced by reading the basis back out of the DTO.
  const basisAgorot = toAgorot(cart.shipping.basis)
  const shipping = computeShipping(basisAgorot, cart.shipping.hasShippableLines, deliveryMethod)
  const totalAgorot = basisAgorot + toAgorot(shipping.cost)
  const totalAmount = (totalAgorot / 100).toFixed(2)

  // ⚠️ EVERY LINE IS PURCHASABLE BY THIS POINT, so the basis and the subtotal
  // are the same number and the total is unambiguous. That is guaranteed by the
  // early return above, not assumed: an unpurchasable line never reaches here.

  return {
    ok: true,
    quote: {
      lines: cart.items,
      clubMember: cart.clubMember,
      // Member-only here — see the type's comment. The cart keeps the
      // non-member "joining would save" reading; checkout must not.
      clubSavings: cart.clubMember ? cart.clubSavings : '0.00',
      basis: cart.shipping.basis,
      shipping,
      totalAmount,
      deliveryMethod,
      estimate: deliveryEstimate(deliveryMethod),
      fingerprint: checkoutFingerprint({
        userId,
        deliveryMethod,
        shippingCost: shipping.cost,
        totalAmount,
        lines: cart.items.map((line) => ({
          lineId: line.id,
          productId: line.productId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
        })),
      }),
    },
  }
}
