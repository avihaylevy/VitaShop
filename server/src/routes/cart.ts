import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { addItem, getCart, type CartIdentity } from '../lib/cartService.js'
import { ensureGuestCartId, peekGuestCartId } from '../lib/guestSession.js'

/**
 * MILESTONE-007 Checkpoint C — `GET` and `POST /api/cart`.
 *
 * PATCH and DELETE are Checkpoint D per §7.5 and are deliberately absent.
 *
 * 🔴 THE ROUTE HAS NO OPINION ABOUT QUANTITY. Every clamp decision is the
 * service's, which calls the proved `cartQuantity` module. There is no
 * `Math.min` in this file, and there must never be one: a second clamp is a
 * second answer.
 */
export const cartRouter = Router()

/**
 * 🔴 A READ MUST NOT MINT AN IDENTITY. `peekGuestCartId`, never `ensure` — a
 * visitor with no session who looks at an empty cart must leave no session row
 * behind. That is Checkpoint B's whole point, and it is asserted in the tests.
 */
cartRouter.get('/', async (req, res) => {
  const identity: CartIdentity = {
    userId: req.session?.userId ?? null,
    guestCartId: peekGuestCartId(req),
  }
  res.json(await getCart(prisma, identity))
})

cartRouter.post('/items', async (req, res) => {
  const body = (req.body ?? {}) as { slug?: unknown; quantity?: unknown }
  if (typeof body.slug !== 'string' || body.slug.length === 0) {
    res.status(400).json({ error: { code: 'INVALID_SLUG', message: 'A product slug is required.' } })
    return
  }

  // A write, so the identity is CREATED here if absent — and creating it is
  // what makes the session persist under `saveUninitialized: false`.
  const identity: CartIdentity = {
    userId: req.session?.userId ?? null,
    guestCartId: req.session?.userId ? null : ensureGuestCartId(req),
  }

  const result = await addItem(prisma, identity, body.slug, body.quantity)

  if (!result.ok) {
    const status = result.reason === 'PRODUCT_NOT_FOUND' ? 404 : 400
    res.status(status).json({ error: { code: result.reason, message: 'The item could not be added.' } })
    return
  }

  res.status(200).json({
    cart: result.cart,
    quantity: result.quantity,
    clampedByCap: result.clampedByCap,
    clampedByStock: result.clampedByStock,
    // 🔴 Correction 2. Without this the response to "add one more" at the cap
    // is indistinguishable from a successful add, and a shopper tapping three
    // times with no visible change concludes the site is broken.
    alreadyAtMaximum: result.alreadyAtMaximum,
  })
})
