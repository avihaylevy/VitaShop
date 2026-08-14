import { ipKeyGenerator, rateLimit, type Options } from 'express-rate-limit'
import type { Request, RequestHandler, Response } from 'express'
import { normalizeEmail } from './normalizeEmail.js'

/**
 * MILESTONE-006 Checkpoint G — rate limiting on every auth route.
 * REQ-F-030..034 cross-cut. Closes open item O1.
 *
 * 🔴 READ THIS BEFORE CHANGING A NUMBER OR A KEY: A RATE LIMITER CAN REOPEN
 * A1 AND A3.
 *
 * A3 requires `/auth/password-reset` to answer identically whether or not the
 * account exists. **A 429 is not a 200.** So if an email-keyed limiter only
 * counted attempts when the account exists:
 *
 *     known address,   4th attempt -> 429
 *     unknown address, 4th attempt -> 200
 *
 * …the limiter hands back the exact enumeration oracle A3 closes. The same
 * applies to `/register` under DEC-053 4b and to `/login` under A1.
 *
 * 🔴 THE CONTRACT, FROZEN:
 *   1. The email-keyed limiter counts EVERY attempt against the SUBMITTED
 *      address — whether or not a user exists, is disabled, or is locked. The
 *      counter is keyed on WHAT THE REQUESTER TYPED, never on what the
 *      database holds. Nothing in this module may consult the database.
 *   2. The 429 body and shape are IDENTICAL everywhere, and carry no hint of
 *      account existence.
 *   3. No `skip`, no `skipSuccessfulRequests`, no `skipFailedRequests`, no
 *      `requestWasSuccessful`. Each of those makes the count depend on the
 *      OUTCOME, and the outcome is exactly what must not be observable.
 *   4. 🔴 EVERY ROUTE GETS ITS OWN LIMITER INSTANCE unless sharing a budget is
 *      a DELIBERATE, STATED decision. Each `rateLimit()` call is one store; two
 *      routes mounting the same handler share one counter, and **that is
 *      invisible at the mount site** — the route reads as limited, and it is,
 *      just not by a budget of its own. `/auth/password-reset` and
 *      `/auth/password-reset/complete` shared one by accident exactly this
 *      way: a token-guessing flood on `complete` drained the budget the
 *      request side needed, so behind NAT one person's mistakes blocked
 *      everyone else from requesting a reset at all.
 */

/**
 * 🔴 ONE response for every limiter. Deliberately says nothing about which
 * limit was hit, or about the address — "too many attempts for this email"
 * would confirm the address is worth rate-limiting.
 */
const TOO_MANY_REQUESTS = {
  error: {
    code: 'TOO_MANY_REQUESTS',
    message: 'Too many attempts. Please try again later.',
  },
} as const

function sendLimited(_req: Request, res: Response): void {
  res.status(429).json(TOO_MANY_REQUESTS)
}

/**
 * 🔴 THE STORE IS IN-MEMORY, and that is a DECISION, not an inherited default.
 *
 * express-rate-limit's default `MemoryStore` means:
 *   · counters RESET ON EVERY RESTART — a redeploy clears every limit
 *   · counters are PER-PROCESS — two instances mean two independent budgets,
 *     so the effective limit is N × the configured number
 *
 * Accepted for now: this project runs one local instance, and both properties
 * are harmless there. 🔴 A deployed multi-instance setup would need a SHARED
 * store (Redis or the PostgreSQL store) before these numbers mean anything —
 * recorded as a deployment-checklist item in technical/DEPLOYMENT.md, because
 * the failure is quiet: the limiter keeps working, just with a ceiling nobody
 * chose.
 */
const SHARED: Partial<Options> = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: sendLimited,
}

/**
 * Key on the SUBMITTED email address.
 *
 * 🔴 Falls back to the IP when no address was submitted, rather than to a
 * constant. A keyGenerator that returns the same value for every malformed
 * request buckets all of them together, which throttles unrelated callers and
 * looks like a working limiter. `ipKeyGenerator` is express-rate-limit's own
 * helper and handles IPv6 prefixes correctly — a raw `req.ip` lets an IPv6
 * client rotate through a /64 for free.
 *
 * ⚠️ This reads `req.body`, so **body parsing must be mounted before the
 * limiter**. If it is not, `req.body` is undefined, every request keys on the
 * IP instead, and the email limit silently never applies. There is a test for
 * the ordering.
 */
function emailKey(req: Request, res: Response): string {
  const submitted = (req.body as { email?: unknown } | undefined)?.email
  if (typeof submitted === 'string' && submitted.trim() !== '') {
    // 🔴 normalizeEmail, the same function registration and login use —
    // otherwise `A@b.com` and `a@b.com` are two buckets and the limit is
    // trivially bypassed by changing case.
    return `email:${normalizeEmail(submitted)}`
  }
  return `ip:${ipKeyGenerator(req.ip ?? '')}`
}

function ipKey(req: Request, _res: Response): string {
  return ipKeyGenerator(req.ip ?? '')
}

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

/**
 * 🔴 THE NUMBERS ARE JUDGEMENT CALLS, NOT DERIVED VALUES. They are recorded in
 * MILESTONE-006 §6.7's O1 closure with the same caveat. Tune them against real
 * traffic; do not treat them as a spec.
 */
export const AUTH_RATE_LIMITS = {
  login: { windowMs: 15 * MINUTE, limit: 10 },
  registerIp: { windowMs: HOUR, limit: 5 },
  registerEmail: { windowMs: HOUR, limit: 3 },
  passwordResetIp: { windowMs: HOUR, limit: 5 },
  passwordResetEmail: { windowMs: HOUR, limit: 3 },
  // 🔴 ITS OWN BUDGET, not shared with the request side above. It guards a
  // different threat — token guessing and argon2 cost, not email bombing —
  // and legitimate use needs more room: request (1) + submit (1) + one per
  // rejected new password. Sharing 5/hour made a token-guessing flood drain
  // the budget needed to REQUEST a reset, which behind NAT or CGNAT is one
  // person locking out everyone else.
  // IP-keyed with nothing else available: the completion request carries a
  // token, not an address, so there is no per-target key and no
  // email-bombing vector to close.
  passwordResetCompleteIp: { windowMs: HOUR, limit: 20 },
  verifyEmail: { windowMs: HOUR, limit: 20 },
  logout: { windowMs: 15 * MINUTE, limit: 60 },
  // 🔴 GENEROUS ON PURPOSE — 16/minute. The client calls this on mount of
  // every gated view, and React StrictMode double-mounts in development, so a
  // tight ceiling would break the app rather than protect it.
  //
  // It is limited at all because "every auth route is limited" is a property
  // that can be CHECKED (see the coverage test); "every auth route except the
  // ones judged cheap" is not. This one is cheap — a session-store read
  // returning a boolean, no argon2, no write — but it is still an
  // unauthenticated endpoint reaching Postgres, and it was added in Checkpoint
  // H and slipped past G's principle, which is exactly the gap the coverage
  // test now closes.
  session: { windowMs: 15 * MINUTE, limit: 240 },
} as const

/**
 * An explicit shape rather than `Record<string, RequestHandler>`: a typo in a
 * key would otherwise type-check and mount `undefined` as middleware, leaving
 * that route silently unlimited.
 */
export interface AuthRateLimiters {
  login: RequestHandler
  registerIp: RequestHandler
  registerEmail: RequestHandler
  passwordResetIp: RequestHandler
  passwordResetEmail: RequestHandler
  passwordResetCompleteIp: RequestHandler
  verifyEmail: RequestHandler
  logout: RequestHandler
  session: RequestHandler
}

export function createAuthRateLimiters(): AuthRateLimiters {
  return {
    // A1's endpoint. The IP limit protects MANY accounts from ONE source;
    // REQ-F-033's 5-attempt lockout protects ONE account from MANY sources.
    // Different scopes — see §6.7. Neither replaces the other.
    login: rateLimit({ ...SHARED, ...AUTH_RATE_LIMITS.login, keyGenerator: ipKey }),

    registerIp: rateLimit({ ...SHARED, ...AUTH_RATE_LIMITS.registerIp, keyGenerator: ipKey }),
    // 🔴 DEC-053 4b makes /register mail an address the requester chooses.
    registerEmail: rateLimit({
      ...SHARED,
      ...AUTH_RATE_LIMITS.registerEmail,
      keyGenerator: emailKey,
    }),

    passwordResetIp: rateLimit({
      ...SHARED,
      ...AUTH_RATE_LIMITS.passwordResetIp,
      keyGenerator: ipKey,
    }),
    // 🔴 A3 mails an address the requester chooses. Same vector as /register.
    passwordResetEmail: rateLimit({
      ...SHARED,
      ...AUTH_RATE_LIMITS.passwordResetEmail,
      keyGenerator: emailKey,
    }),

    passwordResetCompleteIp: rateLimit({
      ...SHARED,
      ...AUTH_RATE_LIMITS.passwordResetCompleteIp,
      keyGenerator: ipKey,
    }),

    // A GET that users double-click, so the ceiling is generous.
    verifyEmail: rateLimit({ ...SHARED, ...AUTH_RATE_LIMITS.verifyEmail, keyGenerator: ipKey }),

    // Nothing to protect — a limit only so the route is not an unbounded
    // no-auth endpoint.
    logout: rateLimit({ ...SHARED, ...AUTH_RATE_LIMITS.logout, keyGenerator: ipKey }),

    session: rateLimit({ ...SHARED, ...AUTH_RATE_LIMITS.session, keyGenerator: ipKey }),
  }
}

export const RATE_LIMIT_RESPONSE = TOO_MANY_REQUESTS

/**
 * ── DEC-061 — the checkout limiters ────────────────────────────────────────
 *
 * 🔴 §8.4 assigned these thresholds to MILESTONE-008 Checkpoint A and §8.6's
 * eight answers never covered them, so until 2026-08-13 they did not exist.
 * The cart routes still carry no limiter at all, and checkout is a better abuse
 * target than login by §8.4's own words: it creates orders and decrements
 * stock.
 *
 * 🔴 KEYED ON THE SHOPPER, NOT THE IP — the one deliberate deviation from the
 * auth numbers, and it is stated rather than absorbed. Checkout is
 * authenticated-only (§8.2), so an identity always exists by the time the
 * handler runs. This module's own header records what IP-keying costs when an
 * identity is available: `/auth/password-reset` and its completion route shared
 * a budget, and behind NAT or CGNAT one person's flood locked everyone else
 * out. Auth already keys on the identity being protected wherever there is one.
 */
export const CHECKOUT_RATE_LIMITS = {
  /**
   * `session`'s ceiling. The client calls `/validate` on mount and again on
   * every change of delivery method, and React StrictMode double-mounts in
   * development — a tight limit here would break the app rather than protect
   * it. It is a READ: it creates nothing and decrements nothing.
   */
  validate: { windowMs: 15 * MINUTE, limit: 240 },
  /**
   * `login`'s ceiling, and the tighter of the two on purpose. This is the write
   * — it places an order and decrements stock. A shopper pays once; ten in
   * fifteen minutes leaves room for genuine retries after a halt or a simulated
   * failure without leaving the route open.
   */
  pay: { windowMs: 15 * MINUTE, limit: 10 },
} as const

export interface CheckoutRateLimiters {
  validate: RequestHandler
  pay: RequestHandler
}

/**
 * 🔴 The shopper's id when there is one, the IP otherwise.
 *
 * ⚠️ THE FALLBACK IS NOT DEAD CODE. The limiter runs BEFORE the authentication
 * guard, deliberately: guarding first would mean an unauthenticated flood
 * reached the session store unlimited, and 401s are cheap only until there are
 * enough of them. So anonymous requests do arrive here, and they are bucketed
 * by IP — never by a constant, which would throttle unrelated callers together
 * and still look like a working limiter.
 */
function shopperKey(req: Request, _res: Response): string {
  const userId = req.session?.userId
  if (typeof userId === 'string' && userId !== '') return `user:${userId}`
  return `ip:${ipKeyGenerator(req.ip ?? '')}`
}

/**
 * ⚠️ TWO SEPARATE `rateLimit()` CALLS, therefore two stores — contract clause 4
 * above. Sharing one instance between `/validate` and `/pay` would let a
 * shopper who re-quotes a few times exhaust the budget they need to actually
 * pay, and the mount site would look correct either way.
 */
/**
 * DEC-061 extended at Checkpoint E3 — the shopper's own order actions.
 *
 * 🔴 LIMITED BECAUSE "EVERY ROUTE IS LIMITED" IS A PROPERTY THAT CAN BE
 * CHECKED, and "every route except the ones judged cheap" is not — this
 * module's header records that reasoning, and §8.4 records the cart routes
 * shipping with no limiter at all as the cost of not applying it.
 *
 * ⚠️ `login`'s ceiling, and cancelling is the same shape as paying: an
 * infrequent, authenticated write that restores stock. A shopper cancels once.
 */
export const ORDER_RATE_LIMITS = {
  cancel: { windowMs: 15 * MINUTE, limit: 10 },
} as const

export interface OrderRateLimiters {
  cancel: RequestHandler
}

export function createOrderRateLimiters(): OrderRateLimiters {
  return {
    cancel: rateLimit({ ...SHARED, ...ORDER_RATE_LIMITS.cancel, keyGenerator: shopperKey }),
  }
}

/**
 * DEC-061 extended again at ISSUE-083 — the admin transition route.
 *
 * ⚠️ `logout`'s ceiling (60 / 15 min), not `login`'s. An admin working through
 * a fulfilment queue legitimately moves many orders in a sitting, where a
 * shopper cancels once — reusing the tighter number would throttle the normal
 * case. It is still bounded, and still keyed on the person rather than the
 * transport.
 *
 * 🔴 The limiter sits BEFORE the role check, so an unauthenticated flood is
 * bounded rather than reaching the session store and a database lookup freely.
 */
export const ADMIN_RATE_LIMITS = {
  status: { windowMs: 15 * MINUTE, limit: 60 },
  /** A READ an admin refreshes while working through a queue. */
  list: { windowMs: 15 * MINUTE, limit: 240 },
} as const

/**
 * MILESTONE-008 Checkpoint F2b. A READ of the caller's own row, called once
 * when the checkout screen mounts — so the ceiling exists to bound abuse, not
 * to pace a shopper. Set alongside `CHECKOUT_RATE_LIMITS.validate` (240)
 * rather than below it: the two are called from the same screen, and a profile
 * limit tighter than the quote limit would break checkout before it protected
 * anything.
 */
export const ACCOUNT_RATE_LIMITS = {
  profile: { windowMs: 15 * MINUTE, limit: 240 },
} as const

export interface AccountRateLimiters {
  profile: RequestHandler
}

export function createAccountRateLimiters(): AccountRateLimiters {
  return {
    profile: rateLimit({ ...SHARED, ...ACCOUNT_RATE_LIMITS.profile, keyGenerator: shopperKey }),
  }
}

export interface AdminRateLimiters {
  status: RequestHandler
  list: RequestHandler
}

export function createAdminRateLimiters(): AdminRateLimiters {
  return {
    status: rateLimit({ ...SHARED, ...ADMIN_RATE_LIMITS.status, keyGenerator: shopperKey }),
    list: rateLimit({ ...SHARED, ...ADMIN_RATE_LIMITS.list, keyGenerator: shopperKey }),
  }
}

export function createCheckoutRateLimiters(): CheckoutRateLimiters {
  return {
    validate: rateLimit({ ...SHARED, ...CHECKOUT_RATE_LIMITS.validate, keyGenerator: shopperKey }),
    pay: rateLimit({ ...SHARED, ...CHECKOUT_RATE_LIMITS.pay, keyGenerator: shopperKey }),
  }
}
