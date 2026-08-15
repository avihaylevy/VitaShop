import { Router } from 'express'
import type { PrismaClient } from '@prisma/client'
import { createAccountRateLimiters, type AccountRateLimiters } from '../lib/rateLimit.js'
import { mapProductToPublicCatalog } from '../lib/catalogMapper.js'
import { requireShopper } from './requireShopper.js'
import { createRequireActiveShopper } from './requireActiveShopper.js'

/**
 * MILESTONE-008 Checkpoint F2b — REQ-F-041's pre-filled details.
 *
 * 🔴 THIS WAS THE FIRST ENDPOINT IN THE PROJECT THAT SERVES PERSONAL DATA.
 * The catalogue is public and the cart is anonymous. (`/auth/session` was a
 * bare boolean when this was written; since ISSUE-089 it also returns the
 * signed-in caller's OWN firstName and email, no-store — see auth.ts. That
 * does not loosen anything here: this route still serves the fuller record —
 * phone, address — and still refuses everything below.) The rules that follow
 * are not ceremony.
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
 * ⚠️ EMAIL IS STILL DELIBERATELY NOT RETURNED HERE. Checkout does not need
 * it: the confirmation goes to the address on the account, chosen
 * server-side. ISSUE-089 later put the email on `/auth/session` for the
 * header's "signed in as" — a screen that DOES use it — which is the rule
 * applied, not the rule broken: each response carries what its screen needs
 * and nothing more.
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
   * ISSUE-092 — the shared guard, replacing this route's own inline status
   * check. ⚠️ ACTIVE, not VERIFIED: an unverified shopper reads their own name
   * and phone. Refusing that is what produced the login loop this route
   * shipped with — 401, the client reads "expired", the login succeeds.
   */
  const requireActiveShopper = createRequireActiveShopper(deps.prisma)

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
  router.get('/profile', limiters.profile, requireShopper, requireActiveShopper, async (req, res) => {
    const userId = req.session!.userId!

    let user: {
      firstName: string
      lastName: string
      phone: string | null
      addresses: { line1: string; city: string; zipCode: string | null }[]
    } | null
    try {
      user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          firstName: true,
          lastName: true,
          phone: true,
          /*
           * ⚠️ `isDefault` ORDERS the result rather than filtering it, so a
           * shopper whose addresses all carry `isDefault: false` still gets
           * one back. Ordering degrades to "the oldest one"; filtering
           * degrades to null.
           *
           * 🔴 AND TODAY THAT DISTINCTION IS THEORETICAL, WHICH IS WORTH
           * SAYING OUT LOUD: **no application code writes an `Address` row at
           * all.** Checkout stores the address as free text on the `Order` and
           * never saves it to the user, so `defaultAddress` is `null` for
           * every real shopper and the only rows that exist were inserted by
           * this route's own tests. REQ-F-041's pre-fill therefore delivers
           * the NAME and PHONE today and nothing more — ISSUE-093, and F2c is
           * where the address gets persisted.
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

    /*
     * 🔴 `disabled`, NOT `!== 'active'`. THIS BRANCH WAS WRONG AND SHIPPED IN
     * `4167765`.
     *
     * `!== 'active'` also refused `pending_verification`, and NOTHING ELSE in
     * this codebase does: `attemptLogin` blocks only `disabled`, and
     * `/checkout/validate`, `/checkout/pay` and `/orders/:id/cancel` gate on
     * `requireShopper` with no status lookup at all. So an unverified shopper
     * could sign in, fill a cart and pay — while this one read answered 401,
     * which the client reads as an expired session and bounces to a login that
     * immediately succeeds. A loop, for the one account that could otherwise
     * complete a purchase.
     *
     * ⚠️ REQ-F-031 DOES say "an unverified account cannot complete an order",
     * and that gate is real — but it is **O3**, it belongs on the ORDER, and
     * no code implements it yet. Enforcing it here would have been the gate in
     * the wrong place: it blocks a profile read, not an order. Recorded as
     * ISSUE-091 rather than smuggled in through a pre-fill endpoint.
     */
    /*
     * 🔴 ONLY `!user` REMAINS. The disabled check and the session destroy that
     * used to live here moved into `requireActiveShopper`, which runs before
     * this handler and is mounted on every authenticated route — ISSUE-092.
     * Keeping a second copy here would be an unreachable branch that reads as
     * load-bearing, and two places that must agree about a refusal.
     *
     * This one stays because the row can vanish between the guard's read and
     * this one, and `findUnique` returning null must not become a 200.
     */
    if (!user) {
      /*
       * 🔴 DESTROY THE SESSION, don't merely refuse this request. The account
       * is disabled and the cookie is still valid for everything else —
       * `/checkout/pay` and `/orders/:id/cancel` accept it, so a disabled
       * shopper can still create orders and move stock while only this read
       * says no. Destroying it here closes that window for this session.
       *
       * ⚠️ PARTIAL BY ADMISSION. It only fires if the disabled account happens
       * to hit THIS route. The whole answer is a status check beside
       * `requireShopper`, which touches every authenticated route and is not
       * this slice's to decide — ISSUE-092.
       */
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

  /*
   * ISSUE-115 / REQ-F-034 — favourites, the server half at last. The same
   * contract as /profile: the SESSION is the only identity (no :userId
   * anywhere — the IDOR shape TEST-050b names), the shared guards run first,
   * and the router-level no-store covers every answer.
   *
   * 🔴 A10 — favourites GATE THE ACTION, NOT THE SURFACE: these routes are
   * auth-only, while the catalogue that hosts the heart stays guest-open.
   * The client sends a guest to /login instead of calling these.
   */

  /** The list — full card DTOs via the SAME mapper the catalogue uses, so a
   *  favourite can never render differently from its catalogue card. Only
   *  ACTIVE products are returned; the rows for soft-deleted products stay
   *  (INV-03's recoverability — reactivation restores them). */
  router.get('/favourites', limiters.favourites, requireShopper, requireActiveShopper, async (req, res) => {
    const userId = req.session!.userId!
    try {
      const rows = await prisma.favorite.findMany({
        where: { userId, product: { isActive: true } },
        orderBy: { createdAt: 'desc' },
        include: { product: { include: { category: true, brand: true, images: true } } },
      })
      res.json({ items: rows.map((row) => mapProductToPublicCatalog(row.product)) })
    } catch (error) {
      console.error(`[account] favourites list failed for ${userId}`, error)
      res.status(503).json({ error: { code: 'FAVOURITES_UNAVAILABLE', message: 'Try again shortly.' } })
    }
  })

  /** Add — PUT for idempotence: hearting twice is one favourite, never an
   *  error and never a duplicate (the DB's @@unique backs the upsert). */
  router.put('/favourites/:slug', limiters.favourites, requireShopper, requireActiveShopper, async (req, res) => {
    const userId = req.session!.userId!
    // Express 5 types a param as string | string[]; a repeated segment is
    // not a slug, so anything non-string reads as an unknown product.
    const slug = typeof req.params.slug === 'string' ? req.params.slug : ''
    try {
      const product = await prisma.product.findFirst({
        where: { slug, isActive: true },
        select: { id: true },
      })
      // One answer for absent and inactive — the same rule the detail
      // page's 404 states: the API must not add a distinction it withholds
      // elsewhere.
      if (!product) {
        res.status(404).json({ error: { code: 'PRODUCT_NOT_FOUND', message: 'Unknown product.' } })
        return
      }
      await prisma.favorite.upsert({
        where: { userId_productId: { userId, productId: product.id } },
        create: { userId, productId: product.id },
        update: {},
      })
      res.status(204).end()
    } catch (error) {
      console.error(`[account] favourite add failed for ${userId}`, error)
      res.status(503).json({ error: { code: 'FAVOURITES_UNAVAILABLE', message: 'Try again shortly.' } })
    }
  })

  /** Remove — idempotent: un-hearting an absent favourite is already the
   *  state the shopper asked for. ⚠️ A HARD delete of the JOIN row — the
   *  favourite itself IS the data being removed; INV-03's soft-delete rule
   *  names Product and Order, not their join rows. */
  router.delete('/favourites/:slug', limiters.favourites, requireShopper, requireActiveShopper, async (req, res) => {
    const userId = req.session!.userId!
    const slug = typeof req.params.slug === 'string' ? req.params.slug : ''
    try {
      await prisma.favorite.deleteMany({ where: { userId, product: { slug } } })
      res.status(204).end()
    } catch (error) {
      console.error(`[account] favourite remove failed for ${userId}`, error)
      res.status(503).json({ error: { code: 'FAVOURITES_UNAVAILABLE', message: 'Try again shortly.' } })
    }
  })

  return router
}
