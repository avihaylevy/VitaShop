import { describe, expect, it } from 'vitest'
import {
  ORDER_RATE_LIMITS,
  AUTH_RATE_LIMITS,
  ADMIN_RATE_LIMITS,
  createOrderRateLimiters,
} from './rateLimit.js'
import { createOrderRouter } from '../routes/orders.js'

/** Minimal shape of an Express router layer — enough to walk the stack. */
interface RouterLayer {
  route?: { path: string; methods: Record<string, boolean>; stack: unknown[] }
}

/**
 * DEC-061 extended — the orders router's limiter coverage.
 *
 * 🔴 THIS FILE EXISTS BECAUSE THE PROPERTY WAS UNVERIFIED FOR THE NEWEST ROUTER.
 * `rateLimit.test.ts` walks the AUTH router and `checkoutRateLimit.test.ts`
 * walks the CHECKOUT one, each asserting the limiter is the FIRST handler by
 * identity. The orders router was mounted with none — so "every route is
 * limited", the property `rateLimit.ts`'s header argues is the whole reason to
 * limit at all, held for two routers out of three and nothing said so.
 *
 * ⚠️ That is the same gap that let `GET /auth/session` ship unlimited in
 * MILESTONE-006 Checkpoint H: a principle stated in prose, checked nowhere.
 */

describe('🔴 EVERY route mounted on the orders router carries a limiter', () => {
  it('walks the real router stack, not a hand-kept list', () => {
    const router = createOrderRouter({ prisma: {} as never })
    const layers = (router as unknown as { stack: RouterLayer[] }).stack.filter((l) => l.route)

    // ⚠️ A CONTROL. A router that mounted nothing would pass every assertion
    // below over an empty list and report full coverage of no routes at all.
    expect(layers.length).toBeGreaterThan(0)

    // 🔴 THREE handlers: limiter, auth guard, handler. The auth router's own
    // check uses `< 2` because it has no guard — reusing that number here would
    // pass for a route carrying a guard and NO limiter.
    const unlimited = layers
      .filter((layer) => (layer.route?.stack.length ?? 0) < 3)
      .map((layer) => `${Object.keys(layer.route?.methods ?? {}).join('/')} ${layer.route?.path}`)

    // Anything that genuinely should not be limited goes here BY NAME with a
    // reason — never by being quietly omitted.
    const EXEMPT: string[] = []

    expect(unlimited.filter((r) => !EXEMPT.includes(r))).toEqual([])
  })

  it('🔴 the limiter is the FIRST handler, by identity — not just three of something', () => {
    // Counting handlers is not checking them: three in any order satisfies the
    // assertion above, so putting the auth guard in front of the limiter would
    // leave it green — and that ordering is deliberate, because guarding first
    // leaves an unauthenticated flood hitting the session store unbounded.
    const limiters = createOrderRateLimiters()
    const router = createOrderRouter({ prisma: {} as never, rateLimiters: limiters })
    const layers = (router as unknown as { stack: RouterLayer[] }).stack.filter((l) => l.route)

    const first = layers.find((l) => l.route?.path === '/:id/cancel')?.route?.stack[0] as
      | { handle?: unknown }
      | undefined

    expect(first?.handle).toBe(limiters.cancel)

    /*
     * 🔴 CHECKPOINT G1'S TWO READS GET THE SAME CHECK, BY IDENTITY, and they
     * must carry `read` rather than `cancel`. Reusing the cancel limiter here
     * would be invisible to a handler count — and would lock a shopper out of
     * their own history after ten page views, since `cancel` allows ten per
     * fifteen minutes.
     */
    for (const path of ['/', '/:id']) {
      const firstOfRead = layers.find((l) => l.route?.path === path)?.route?.stack[0] as
        | { handle?: unknown }
        | undefined
      expect(firstOfRead?.handle, `${path} must be limited by \`read\``).toBe(limiters.read)
    }
  })

  it('the router mounts exactly the routes it is meant to, with the right methods', () => {
    /*
     * ⚠️ AN EXACT INVENTORY, deliberately — it fails when a route is ADDED as
     * well as when one disappears. Checkpoint G1 added the two reads and this
     * assertion went red, which is the point: a new route on this router is a
     * decision, and the limiter checks above only cover what is listed here.
     */
    const router = createOrderRouter({ prisma: {} as never })
    const layers = (router as unknown as { stack: RouterLayer[] }).stack.filter((l) => l.route)
    const routes = layers
      .map((l) => `${Object.keys(l.route?.methods ?? {}).join('/')} ${l.route?.path}`)
      .sort()
    expect(routes).toEqual(['get /', 'get /:id', 'post /:id/cancel'])
  })
})

describe('the configured numbers', () => {
  it('every order limit is a positive number with a window', () => {
    for (const [name, config] of Object.entries(ORDER_RATE_LIMITS)) {
      expect(config.limit, name).toBeGreaterThan(0)
      expect(config.windowMs, name).toBeGreaterThan(0)
    }
  })

  it('cancelling mirrors login’s ceiling rather than inventing a number', () => {
    // DEC-061's rule was "mirror the existing auth limiter values". Pinned so a
    // later tweak is a deliberate act with a visible failure, not a silent
    // divergence from the decision that authorised the number.
    expect(ORDER_RATE_LIMITS.cancel).toEqual(AUTH_RATE_LIMITS.login)

    /*
     * 🔴 THE READ CEILING IS PINNED TOO, for the same reason and to the
     * limiter it claims parity with. `read`'s comment says it is paced like the
     * admin list rather than like `cancel`; nothing asserted that, so the two
     * could drift silently and the comment would quietly become false.
     * Found by review.
     */
    expect(ORDER_RATE_LIMITS.read).toEqual(ADMIN_RATE_LIMITS.list)

    // ⚠️ AND THE TWO ORDER LIMITS MUST NOT COLLAPSE INTO EACH OTHER. A read
    // paced like a cancel locks a shopper out of their own history after ten
    // page views; a cancel paced like a read is 240 stock-restoring writes.
    expect(ORDER_RATE_LIMITS.read).not.toEqual(ORDER_RATE_LIMITS.cancel)
  })
})
