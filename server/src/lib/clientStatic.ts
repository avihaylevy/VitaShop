import { existsSync } from 'node:fs'
import path from 'node:path'
import express, { type RequestHandler, type Router } from 'express'
import { UPLOAD_URL_PREFIX } from './uploadPaths.js'

/**
 * DEC-116 (2026-09-04) — ONE ORIGIN IN PRODUCTION.
 *
 * On Render the built React app is served by this Express process instead
 * of a separate static site. The reason is the session cookie: two origins
 * (app.onrender.com and api.onrender.com) would make every cookie
 * cross-site, which means `sameSite: 'none'` and a CSRF story we do not
 * have. One origin keeps DEC-018's `lax` cookie exactly as it is locally.
 *
 * Enabled ONLY by CLIENT_DIST_DIR. Unset (every local script, every test,
 * the Compose stack) mounts nothing, and the Vite dev server / preview
 * keeps serving the app as before.
 *
 * TWO HALVES, mounted in two places (review finding):
 *   assets    — `express.static` over dist/, mounted BEFORE the session
 *               middleware. A hashed bundle or a product image must not
 *               cost a session-store SELECT on Neon; for a signed-in
 *               visitor that was one round-trip per file, serving nothing.
 *   fallback  — mounted LAST, after every API router: a client route gets
 *               index.html; an unknown `/api` or `/uploads` path gets a
 *               JSON 404, never an HTML page a JSON client cannot read.
 */

const API_PREFIX = '/api'

/** Paths the API owns. Everything else is the SPA's to route client-side. */
export function isClientRoute(urlPath: string): boolean {
  return !ownedBy(urlPath, API_PREFIX) && !ownedBy(urlPath, UPLOAD_URL_PREFIX)
}

function ownedBy(urlPath: string, prefix: string): boolean {
  const bare = prefix.replace(/\/$/, '')
  return urlPath === bare || urlPath.startsWith(`${bare}/`)
}

/** Resolved against cwd, like UPLOADS_DIR (DEC-089c): scripts run from server/. */
export function resolveClientDistDir(raw: string | undefined): string | null {
  const value = (raw ?? '').trim()
  if (value === '') return null
  const dir = path.resolve(process.cwd(), value)
  if (!existsSync(path.join(dir, 'index.html'))) {
    throw new Error(`CLIENT_DIST_DIR is set to "${raw}" but ${dir}/index.html does not exist. Build the client first.`)
  }
  return dir
}

/** The files themselves. Safe to mount early: a miss falls through with next(). */
export function createClientAssetsRouter(distDir: string): Router {
  const router = express.Router()
  // Hashed bundles under /assets are immutable by construction (Vite puts
  // the content hash in the filename); index.html and the few root files
  // must never be cached, or a deploy leaves browsers asking for bundles
  // that no longer exist.
  router.use(
    express.static(distDir, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        } else {
          res.setHeader('Cache-Control', 'no-cache')
        }
      },
    }),
  )
  return router
}

/** The last handler: SPA fallback for client routes, JSON 404 for the API's own space. */
export function createSpaFallback(distDir: string): RequestHandler {
  const indexHtml = path.join(distDir, 'index.html')
  return (req, res, next) => {
    if (!isClientRoute(req.path)) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such resource.' } })
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(indexHtml)
  }
}
