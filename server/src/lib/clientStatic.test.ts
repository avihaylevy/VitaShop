import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Server } from 'node:http'
import express from 'express'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createClientAssetsRouter,
  createSpaFallback,
  isClientRoute,
  resolveClientDistDir,
} from './clientStatic.js'

describe('isClientRoute', () => {
  it('hands /api and the uploads prefix (and their subpaths) back to the API — both controls', () => {
    // The uploads prefix is uploadPaths.ts's UPLOAD_URL_PREFIX (/uploads/products/),
    // the ONE home for that fact — so a bare /uploads is nobody's and stays SPA.
    for (const p of ['/api', '/api/products', '/uploads/products', '/uploads/products/x.png']) {
      expect(isClientRoute(p)).toBe(false)
    }
    for (const p of ['/', '/catalog', '/product/vitamin-c', '/admin/dashboard', '/apix', '/uploads', '/uploads/other']) {
      expect(isClientRoute(p)).toBe(true)
    }
  })
})

describe('resolveClientDistDir', () => {
  it('is null when unset (nothing mounts locally)', () => {
    expect(resolveClientDistDir(undefined)).toBeNull()
    expect(resolveClientDistDir('  ')).toBeNull()
  })
  it('refuses a directory with no index.html, loudly', () => {
    const empty = mkdtempSync(path.join(tmpdir(), 'vs-empty-'))
    try {
      expect(() => resolveClientDistDir(empty)).toThrow(/index\.html/)
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })
  it('resolves a RELATIVE value against cwd — the shape render.yaml uses (../client/dist from server/)', () => {
    const dist = mkdtempSync(path.join(tmpdir(), 'vs-rel-'))
    writeFileSync(path.join(dist, 'index.html'), '<!doctype html>')
    try {
      const relative = path.relative(process.cwd(), dist)
      expect(path.isAbsolute(relative)).toBe(false)
      expect(resolveClientDistDir(relative)).toBe(dist)
    } finally {
      rmSync(dist, { recursive: true, force: true })
    }
  })
})

describe('assets router early + SPA fallback last, around a JSON API', () => {
  let dist: string
  let server: Server
  let base: string
  let sessionLookups = 0

  beforeAll(async () => {
    dist = mkdtempSync(path.join(tmpdir(), 'vs-dist-'))
    mkdirSync(path.join(dist, 'assets'))
    writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>VitaShop</title>')
    writeFileSync(path.join(dist, 'assets', 'app-abc123.js'), 'console.log(1)')
    const app = express()
    app.use(createClientAssetsRouter(dist))
    // Stands in for the session middleware: counts what reaches it.
    app.use((_req, _res, next) => {
      sessionLookups += 1
      next()
    })
    app.get('/api/ping', (_req, res) => res.json({ ok: true }))
    app.use(createSpaFallback(dist))
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('no address')
    base = `http://127.0.0.1:${address.port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
    rmSync(dist, { recursive: true, force: true })
  })

  it('serves index.html for a client route (SPA fallback), uncached', async () => {
    const res = await fetch(`${base}/product/vitamin-c`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/html/)
    expect(res.headers.get('cache-control')).toBe('no-cache')
    expect(await res.text()).toContain('VitaShop')
  })

  it('serves a hashed asset as immutable WITHOUT touching the session layer', async () => {
    const before = sessionLookups
    const res = await fetch(`${base}/assets/app-abc123.js`)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('immutable')
    expect(sessionLookups).toBe(before)
  })

  it('🔴 THE CONTROL — an unknown /api path is a JSON 404, never index.html', async () => {
    const res = await fetch(`${base}/api/nope`)
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
    expect(await res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'No such resource.' } })
  })

  it('a missing upload is a JSON 404 too', async () => {
    const res = await fetch(`${base}/uploads/products/missing.png`)
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
  })

  it('the API route between them still answers JSON, and a client route DID pass the session layer', async () => {
    const res = await fetch(`${base}/api/ping`)
    expect(await res.json()).toEqual({ ok: true })
    const before = sessionLookups
    await fetch(`${base}/catalog`)
    expect(sessionLookups).toBe(before + 1)
  })
})
