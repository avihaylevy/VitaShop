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

export const app = express()

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
