import 'dotenv/config'
import cors from 'cors'
import express from 'express'

const app = express()

const clientOrigin = process.env.CLIENT_ORIGIN
if (!clientOrigin) {
  throw new Error('CLIENT_ORIGIN is not set — see .env.example. DEC-010: never CORS *.')
}

app.use(cors({ origin: clientOrigin, credentials: true }))
app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

const port = process.env.PORT ?? 3000

app.listen(port, () => {
  console.log(`VitaShop API listening on port ${port}`)
})
