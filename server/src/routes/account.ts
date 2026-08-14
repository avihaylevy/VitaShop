import { Router } from 'express'
import type { PrismaClient } from '@prisma/client'
import { createAccountRateLimiters, type AccountRateLimiters } from '../lib/rateLimit.js'
import { requireShopper } from './requireShopper.js'

/**
 * MILESTONE-008 Checkpoint F2b — REQ-F-041's pre-filled details.
 *
 * 🔴 THIS IS THE FIRST ENDPOINT IN THE PROJECT THAT SERVES PERSONAL DATA.
 * The catalogue is public, the cart is anonymous, and `/auth/session` returns
 * `{ authenticated: boolean }` and nothing else. A name, a phone number and a
 * home address are a different category, and the rules that follow are not
 * ceremony.
 *
 * 🔴 THE SESSION IS THE ONLY IDENTITY. `req.session.userId` selects the row —
 * there is no `:id` parameter, no query string, and no body field that can
 * name a different shopper, because a route that accepts one is one missing
 * check away from serving any customer's address to anyone. TEST-050b names
 * this shape (IDOR) for Checkpoint G; the answer arrives here first because
 * this is the first route that could have it.
 *
 * 🔴 A DISABLED ACCOUNT IS NOT A SHOPPER, whatever the session says. The
 * session outlives the account row it names — `requireAdmin` makes the same
 * check for the same reason, and this is the shopper-side counterpart.
 *
 * ⚠️ EMAIL IS DELIBERATELY NOT RETURNED. Checkout does not need it: the
 * confirmation goes to the address on the account, chosen server-side. Sending
 * it would put an identifier on the wire for a screen that has no use for it.
 */

export type AccountRouterDeps = {
  prisma: PrismaClient
  /** Injectable so a test can identify the limiter rather than count it. */
  rateLimiters?: AccountRateLimiters
}

export function createAccountRouter(deps: AccountRouterDeps): ReturnType<typeof Router> {
  const { prisma } = deps
  const limiters = deps.rateLimiters ?? createAccountRateLimiters()
  const router = Router()

  /*
   * 🔴 `no-store` ON EVERYTHING THIS ROUTER ANSWERS, set at the ROUTER level
   * rather than inside a handler — and that placement is the point. Written
   * inside the handler it missed `requireShopper`'s 401 entirely, because the
   * guard answers before the handler runs, and a cached refusal is its own
   * bug. Router-level also means the next personal-data route mounted here
   * cannot forget it.
   *
   * ⚠️ Every authenticated route before this one was a POST, which browsers do
   * not cache, so nothing in `server/src` sets a cache header anywhere. This
   * is a cacheable GET carrying a name, a phone number and a home address:
   * without the directive a browser may serve it back from cache after
   * sign-out, and a back-navigation on a shared machine re-renders it.
   */
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    next()
  })

  /**
   * 🔴 THE MIDDLEWARE ORDER IS THE CONTRACT, and it matches every other
   * authenticated route here: limiter, then guard. Guarding first would leave
   * an unauthenticated flood hitting the session store with no ceiling.
   */
  router.get('/profile', limiters.profile, requireShopper, async (req, res) => {
    const userId = req.session!.userId!

    let user: {
      firstName: string
      lastName: string
      phone: string | null
      status: string
      addresses: { line1: string; city: string; zipCode: string | null }[]
    } | null
    try {
      user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          firstName: true,
          lastName: true,
          phone: true,
          status: true,
          /*
           * ⚠️ `isDefault` ORDERS the result rather than filtering it: a
           * shopper whose addresses all carry `isDefault: false` — which every
           * address does today, since nothing writes the flag yet — would
           * otherwise get nothing back while having an address on file.
           * Ordering degrades to "the oldest one"; filtering degrades to null.
           */
          addresses: {
            select: { line1: true, city: true, zipCode: true },
            orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
            take: 1,
          },
        },
      })
    } catch (error) {
      // 🔴 FAIL CLOSED, like the admin role lookup. A database error must never
      // be answered with an empty profile: the screen would render a blank form
      // as though the shopper had nothing on file and quietly lose their saved
      // address behind a retry that looks like success.
      console.error(`[account] profile lookup failed for ${userId}`, error)
      res.status(503).json({
        error: { code: 'PROFILE_UNAVAILABLE', message: 'Try again shortly.' },
      })
      return
    }

    if (!user || user.status !== 'active') {
      // ⚠️ 401, not 404. The session names an account that cannot act, so the
      // shopper's answer is to sign in again — and the response says nothing
      // about whether the row exists.
      res.status(401).json({
        error: { code: 'AUTHENTICATION_REQUIRED', message: 'Sign in to continue.' },
      })
      return
    }

    res.json({
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      /*
       * 🔴 `null`, NOT an empty object or a blank-field address. The screen has
       * to tell "nothing on file" from "an address with an empty city", and a
       * shape that blurs the two produces a form that looks pre-filled and is
       * not.
       */
      defaultAddress: user.addresses[0] ?? null,
    })
  })

  return router
}
