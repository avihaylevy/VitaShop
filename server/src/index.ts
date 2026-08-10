import 'dotenv/config'
import { pathToFileURL } from 'node:url'
import cors from 'cors'
import express from 'express'
import { createSessionMiddleware } from './lib/session.js'
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

const port = process.env.PORT ?? 3000

// Only bind a port when this file is run directly — importing `app` from a
// test must not start a real listener on the configured port.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  app.listen(port, () => {
    console.log(`VitaShop API listening on port ${port}`)
  })
}
