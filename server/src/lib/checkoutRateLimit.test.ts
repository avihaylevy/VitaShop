import { describe, expect, it } from 'vitest'
import { CHECKOUT_RATE_LIMITS, AUTH_RATE_LIMITS, createCheckoutRateLimiters } from './rateLimit.js'
import { createCheckoutRouter } from '../routes/checkout.js'

/** Minimal shape of an Express router layer — enough to walk the stack. */
interface RouterLayer {
  route?: { path: string; methods: Record<string, boolean>; stack: unknown[] }
}

/**
 * DEC-061 — the checkout limiters, and the coverage property that outlives them.
 *
 * 🔴 THIS FILE EXISTS BECAUSE THE AUTH VERSION DID NOT COVER ENOUGH. M-006's
 * coverage test walks the AUTH router — `describe('G — every auth route is
 * limited')` — and nothing walked any other router. §8.4 records the
 * consequence in advance: the cart routes carry no limiter at all, and checkout
 * creates orders and decrements stock.
 */

describe('🔴 EVERY route mounted on the checkout router carries a limiter', () => {
  it('walks the real router stack, not a hand-kept list', () => {
    // The same technique as the auth coverage test, for the same reason: a
    // THIRD checkout route is covered the moment it is mounted, without anyone
    // remembering there was a rule. Checkpoint H added `GET /auth/session` and
    // it slipped past exactly that rule on the auth side.
    const router = createCheckoutRouter({ prisma: {} as never })

    const layers = (router as unknown as { stack: RouterLayer[] }).stack.filter((l) => l.route)

    // ⚠️ A CONTROL, and not a formality. If the router mounted nothing — a
    // refactor, a bad import — every assertion below would pass over an empty
    // list and report full coverage of no routes at all.
    expect(layers.length).toBeGreaterThan(0)
    expect(layers.length).toBe(2)

    // 🔴 THREE handlers per route here, not two: limiter, auth guard, handler.
    // The auth router's threshold is 2 because it has no guard. Using `< 2`
    // here would pass for a route carrying an auth guard and NO limiter — a
    // check that looks identical and verifies nothing.
    const unlimited = layers
      .filter((layer) => (layer.route?.stack.length ?? 0) < 3)
      .map((layer) => `${Object.keys(layer.route?.methods ?? {}).join('/')} ${layer.route?.path}`)

    // Anything that genuinely should not be limited goes here BY NAME with a
    // reason — never by being quietly omitted.
    const EXEMPT: string[] = []

    expect(unlimited.filter((r) => !EXEMPT.includes(r))).toEqual([])
  })

  it('🔴 the limiter is the FIRST handler on each route, by identity — not just three of something', () => {
    // ⚠️ COUNTING HANDLERS IS NOT CHECKING THEM. The assertion above is
    // satisfied by any three handlers in any order, so moving the auth guard in
    // FRONT of the limiter left it green — and that ordering is exactly what
    // `checkout.ts` and `shopperKey` both call deliberate, because guarding
    // first leaves an unauthenticated flood hitting the session store with no
    // ceiling at all.
    //
    // Injecting the limiters gives this test something to fail on: it can name
    // the handler it expects and where.
    const limiters = createCheckoutRateLimiters()
    const router = createCheckoutRouter({ prisma: {} as never, rateLimiters: limiters })
    const layers = (router as unknown as { stack: RouterLayer[] }).stack.filter((l) => l.route)

    const first = (path: string) =>
      layers.find((l) => l.route?.path === path)?.route?.stack[0] as { handle?: unknown } | undefined

    expect(first('/validate')?.handle).toBe(limiters.validate)
    expect(first('/pay')?.handle).toBe(limiters.pay)

    // 🔴 And each route carries its OWN instance — contract clause 4. Two routes
    // sharing one `rateLimit()` call share one store, and the mount site reads
    // as correct either way.
    expect(limiters.validate).not.toBe(limiters.pay)
  })

  it('both checkout routes are present and are POSTs', () => {
    const router = createCheckoutRouter({ prisma: {} as never })
    const layers = (router as unknown as { stack: RouterLayer[] }).stack.filter((l) => l.route)
    const routes = layers
      .map((l) => `${Object.keys(l.route?.methods ?? {}).join('/')} ${l.route?.path}`)
      .sort()

    // 🔴 `/validate` is a POST despite being a read: it carries a delivery
    // method in a body, and a GET would put the shopper's chosen method in a
    // URL — see the privacy rule about query strings.
    expect(routes).toEqual(['post /pay', 'post /validate'])
  })
})

describe('the configured numbers', () => {
  it('every checkout limit is a positive number with a window', () => {
    for (const [name, config] of Object.entries(CHECKOUT_RATE_LIMITS)) {
      expect(config.limit, name).toBeGreaterThan(0)
      expect(config.windowMs, name).toBeGreaterThan(0)
    }
  })

  it('🔴 /pay is TIGHTER than /validate — the write must not inherit the read’s ceiling', () => {
    // /validate is called on mount and on every method change; /pay places an
    // order and decrements stock. If the write ever carried the read's ceiling
    // the tighter number would be decorative, which is the shape of defect
    // AUTH_RATE_LIMITS' own "email budgets are tighter than IP budgets" test
    // guards against.
    expect(CHECKOUT_RATE_LIMITS.pay.limit).toBeLessThan(CHECKOUT_RATE_LIMITS.validate.limit)
  })

  it('DEC-061 mirrors the auth numbers rather than inventing new ones', () => {
    // The decision was "mirror the existing auth limiter values". Pinned so a
    // later tweak to one side is a deliberate act with a visible failure, not a
    // silent divergence from the decision that authorised these numbers.
    expect(CHECKOUT_RATE_LIMITS.pay).toEqual(AUTH_RATE_LIMITS.login)
    expect(CHECKOUT_RATE_LIMITS.validate).toEqual(AUTH_RATE_LIMITS.session)
  })
})
