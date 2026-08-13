import type { RequestHandler } from 'express'

/**
 * 🔴 ONE AUTHENTICATION GUARD, SHARED — extracted at Checkpoint E3 when a
 * second route needed it.
 *
 * It lived inside `routes/checkout.ts` while checkout was the only
 * authenticated-only surface. Copying it into `routes/orders.ts` would have put
 * two refusals in the codebase that must agree about the status code, the error
 * shape and what they are allowed to reveal — the drift `purchasability.ts` was
 * created to make unrepresentable, in a place where the consequence is an
 * inconsistent security answer rather than a wrong price.
 *
 * 🔴 THE LIMITER RUNS BEFORE THIS, and the order is deliberate. Guarding first
 * would leave an unauthenticated flood hitting the session store with no
 * ceiling at all — 401s are cheap only until there are enough of them. See
 * `shopperKey` in `lib/rateLimit.ts`: anonymous requests bucket by IP,
 * authenticated ones by the shopper.
 */
export const requireShopper: RequestHandler = (req, res, next) => {
  const userId = req.session?.userId
  if (typeof userId !== 'string' || userId === '') {
    // ⚠️ The same shape every other refusal in this project uses, and it says
    // nothing about carts, orders or whether any exist.
    res.status(401).json({
      error: { code: 'AUTHENTICATION_REQUIRED', message: 'Sign in to continue.' },
    })
    return
  }
  next()
}
