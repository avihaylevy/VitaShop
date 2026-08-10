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

// A2 — pay the constant dummy hash's cost once at startup, so the first
// unknown-email login is not measurably slower than every later one. Failure
// is not fatal: the hash is computed lazily on first use anyway.
void prewarmDummyHash().catch(() => undefined)

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
  app.listen(port, () => {
    console.log(`VitaShop API listening on port ${port}`)
  })
}
