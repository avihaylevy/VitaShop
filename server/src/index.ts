import 'dotenv/config'
import { pathToFileURL } from 'node:url'
import cors from 'cors'
import express from 'express'
import { ConsoleEmailProvider } from './lib/emailService.js'
import { prewarmDummyHash } from './lib/loginService.js'
import { prisma } from './lib/prisma.js'
import { createSessionMiddleware } from './lib/session.js'
import { createAuthRouter } from './routes/auth.js'
import { catalogRouter } from './routes/catalog.js'
import { cartRouter } from './routes/cart.js'
import { createCheckoutRouter } from './routes/checkout.js'
import { createOrderRouter } from './routes/orders.js'
import { createAdminOrderRouter } from './routes/adminOrders.js'
import { createAccountRouter } from './routes/account.js'

export const app = express()

// 🔴 TRUST PROXY — Checkpoint G's decision, recorded rather than inherited.
//
// DECISION: (b) — NO trust proxy is set here, and the rate limits are correct
// ONLY FOR DIRECT CONNECTIONS.
//
// Why not set it now: `trust proxy` tells Express to believe `X-Forwarded-For`.
// With no proxy in front, that header is attacker-controlled, so enabling it
// would let anyone forge an IP and get a fresh rate-limit bucket per request —
// turning the IP limiter off while it still looks enabled. The number must
// also match the REAL proxy depth; a guess is not safer than nothing.
//
// 🔴 This is now LOAD-BEARING FOR A SECURITY CONTROL, not just for the Secure
// cookie flag it was first raised for at Checkpoint C. Behind a proxy without
// it, every request reads the proxy's address, all users share ONE bucket, and
// the limiter blocks everyone or nobody. It is trap 4 and trap 6 in
// technical/DEPLOYMENT.md, and it is a deployment-checklist item — not
// something to switch on speculatively.
//
// express-rate-limit will warn about this if a forwarded header ever appears.
// 🔴 If that warning shows up, it means a proxy is present and this decision
// must be revisited — do NOT silence the warning.
app.set('trust proxy', false)

const clientOrigin = process.env.CLIENT_ORIGIN
if (!clientOrigin) {
  throw new Error('CLIENT_ORIGIN is not set — see .env.example. DEC-010: never CORS *.')
}

// `credentials: true` is required for the session cookie to travel between the
// Vite client and this API, which are different origins in development.
// 🔴 Safe only because `origin` is one exact origin and never "*" — DEC-010,
// and DEC-018's condition for allowing credentials at all.
app.use(cors({ origin: clientOrigin, credentials: true }))
app.use(express.json())

// MILESTONE-006 Checkpoint C. Attaches `req.session` to every request.
// 🔴 It authenticates nothing — no route reads a session yet. Registration,
// login and logout are Checkpoints D, E and F.
app.use(createSessionMiddleware())

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.use('/api', catalogRouter)
// MILESTONE-007 Checkpoint C — GET /api/cart and POST /api/cart/items.
// Mounted AFTER the session middleware: the cart's identity comes from it.
app.use('/api/cart', cartRouter)

// MILESTONE-008 Checkpoint D2 — POST /api/checkout/validate and /pay.
// 🔴 Mounted AFTER the session middleware, like the cart: both routes are
// authenticated-only (§8.2) and their limiters key on the shopper (DEC-061),
// so `req.session` must already be populated when they run.
app.use('/api/checkout', createCheckoutRouter({ prisma, emailService: new ConsoleEmailProvider() }))

// MILESTONE-008 Checkpoint E3 — POST /api/orders/:id/cancel.
// 🔴 Shopper-only. §8.9's four ADMIN transitions are enforced at the service
// but have no route, because this server has no admin authorization yet — see
// routes/orders.ts and the issue it names.
app.use('/api/orders', createOrderRouter({ prisma }))

// ISSUE-083 — §8.9's four ADMIN-ONLY transitions, finally reachable.
// 🔴 Mounted after the session middleware. The role is read from the database
// on EVERY request (DEC-065), so revoking an admin takes effect immediately.
// ⚠️ NO SCREENS — the admin UI is MILESTONE-010's; a minimal orders screen
// comes with Checkpoint F.
app.use('/api/admin/orders', createAdminOrderRouter({ prisma }))

// MILESTONE-008 Checkpoint F2b — REQ-F-041's pre-filled checkout details.
// 🔴 The first route serving PERSONAL data. The session is the only identity
// it accepts: no id travels in the path, the query or the body.
app.use('/api/account', createAccountRouter({ prisma }))

// A2 — compute the constant dummy hash once at startup, so the first
// unknown-email login is not measurably slower than every later one.
//
// 🔴 FAIL FAST if it rejects. A server that cannot hash cannot serve auth, and
// failing at boot is far louder than failing per-request — a per-request
// failure would surface as a 500 on the unknown-email branch ONLY, which is
// account enumeration by status code. The request path is defensive about this
// too (see loginService), but the boot check is what makes it visible.
const dummyHashReady = prewarmDummyHash().catch((error: unknown) => {
  console.error('[auth] FATAL — the A2 constant hash could not be computed at startup', error)
  throw error
})

// MILESTONE-006 Checkpoints D and E — registration, verification, login.
// DEC-007: ConsoleEmailProvider is the transport; all token logic is real.
app.use(
  '/api',
  createAuthRouter({
    prisma,
    emailService: new ConsoleEmailProvider(),
    appBaseUrl: clientOrigin,
  }),
)

const port = process.env.PORT ?? 3000

// Only bind a port when this file is run directly — importing `app` from a
// test must not start a real listener on the configured port.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // 🔴 Await the A2 constant before accepting traffic. Serving requests while
  // it is unavailable is the failure mode this guards: unknown email would
  // 500 and a known email 401, which distinguishes them by status code.
  await dummyHashReady
  app.listen(port, () => {
    console.log(`VitaShop API listening on port ${port}`)
  })
}
