import type { PrismaClient, FunnelEventType } from '@prisma/client'

/**
 * DEC-101 — §4.7.5's funnel events, the FOUR spec-mandated ones only:
 * product_view · add_to_cart · checkout_started · purchase_completed.
 * The `funnel_events` table has existed since the init migration (DEC-024);
 * this module is its first writer.
 *
 * 🔴 RECORDING NEVER FAILS A REQUEST. Every insert is wrapped and swallowed:
 * analytics losing a row is a dashboard problem, a shopper losing an order
 * over analytics is a defect. Callers `void` the promise — the catch lives
 * HERE, so an unawaited call can never surface an unhandled rejection.
 *
 * ⚠️ sessionId is express-session's req.sessionID. For a signed-in shopper
 * or a guest with a persisted session (a cart write) it is stable; a fresh
 * guest whose session was never saved gets a new id per request, so their
 * views fragment into one-request sessions. Recorded as a known KPI-01
 * approximation in DEC-101 — the alternative (persisting a session per
 * view) would mint a session row for every drive-by request, which
 * MILESTONE-007 Checkpoint B exists to prevent.
 *
 * 🔴 PRIVACY: no metadata column exists and none is written — nothing here
 * can carry typed text, payment details, or AI conversation content.
 */

export type FunnelEventInput = {
  eventType: FunnelEventType
  sessionId: string
  userId?: string | null
  productId?: string | null
  orderId?: string | null
}

export async function recordFunnelEvent(
  prisma: PrismaClient,
  event: FunnelEventInput,
): Promise<void> {
  // A blank session id would make the row unattributable AND corrupt the
  // KPI-01 distinct-session denominator with one shared bucket. Skip loudly.
  if (event.sessionId === '') {
    console.error(`[funnel] dropped ${event.eventType} event with an empty session id`)
    return
  }
  try {
    await prisma.funnelEvent.create({
      data: {
        eventType: event.eventType,
        sessionId: event.sessionId,
        userId: event.userId ?? null,
        productId: event.productId ?? null,
        orderId: event.orderId ?? null,
      },
    })
  } catch (error) {
    console.error(`[funnel] recording ${event.eventType} failed`, error)
  }
}

/** How long one checkout attempt is considered "the same start" (DEC-101). */
export const CHECKOUT_STARTED_DEDUPE_MS = 30 * 60 * 1000

/**
 * checkout_started, deduplicated: /validate is a READ the checkout screen
 * calls as often as it needs (delivery-method switches, re-quotes), so a
 * naive per-call insert would count one checkout as many and drive KPI-03's
 * abandonment rate toward a flattering lie in the wrong direction — every
 * re-quote would look like another abandoned checkout.
 *
 * One session gets one checkout_started per 30-minute window. The check and
 * the insert are not atomic; a racing double-insert costs one duplicate row
 * in an analytics table, which is not worth a lock.
 */
export async function recordCheckoutStarted(
  prisma: PrismaClient,
  ids: { sessionId: string; userId?: string | null },
): Promise<void> {
  if (ids.sessionId === '') {
    console.error('[funnel] dropped checkout_started event with an empty session id')
    return
  }
  try {
    const recent = await prisma.funnelEvent.findFirst({
      where: {
        eventType: 'checkout_started',
        sessionId: ids.sessionId,
        createdAt: { gte: new Date(Date.now() - CHECKOUT_STARTED_DEDUPE_MS) },
      },
      select: { id: true },
    })
    if (recent) return
  } catch (error) {
    console.error('[funnel] checkout_started dedupe lookup failed', error)
    return
  }
  await recordFunnelEvent(prisma, {
    eventType: 'checkout_started',
    sessionId: ids.sessionId,
    userId: ids.userId ?? null,
  })
}
