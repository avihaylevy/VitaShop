import 'dotenv/config'
import { pathToFileURL } from 'node:url'
import cors from 'cors'
import express from 'express'
import { catalogRouter } from './routes/catalog.js'

export const app = express()

const clientOrigin = process.env.CLIENT_ORIGIN
if (!clientOrigin) {
  throw new Error('CLIENT_ORIGIN is not set — see .env.example. DEC-010: never CORS *.')
}

// credentials not enabled — no session cookie exists yet (DEC-018 auth is
// not implemented). Enable when express-session is added.
app.use(cors({ origin: clientOrigin }))
app.use(express.json())

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
