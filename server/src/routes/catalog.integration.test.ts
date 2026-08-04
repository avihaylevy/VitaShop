// Read-only integration test against the local vitashop_dev database.
// 🔴 Strictly read-only: no seed, create, update, delete, cleanup, migration,
// or sequence change. If vitashop_dev is not reachable, every test in this
// file fails clearly, naming the required database — it never skips and
// never falls back to mocked data.
import type { Server } from 'node:http'
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CANONICAL_CATEGORIES } from '../lib/catalogCategories.js'
import type { PublicCatalogProduct } from '../lib/catalogMapper.js'

interface CategoriesEnvelope {
  items: { slug: string; nameHe: string; nameEn: string }[]
}

interface ProductsEnvelope {
  items: PublicCatalogProduct[]
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
}

interface ApiErrorEnvelope {
  error: { code: string; message: string; fields?: string[] }
}

function assertLocalVitashopDevTarget(): void {
  const raw = process.env.DATABASE_URL
  if (!raw) {
    throw new Error(
      'DATABASE_URL is not set. This integration test requires the local "vitashop_dev" PostgreSQL database — see server/.env.example.',
    )
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('DATABASE_URL is not a valid connection URL. This integration test requires the local "vitashop_dev" database.')
  }
  const host = url.hostname
  const database = url.pathname.replace(/^\//, '')
  const isLocalHost = host === 'localhost' || host === '127.0.0.1'
  if (!isLocalHost) {
    throw new Error(`DATABASE_URL host is "${host}", not localhost/127.0.0.1. This integration test requires the local "vitashop_dev" database.`)
  }
  if (database !== 'vitashop_dev') {
    throw new Error(`DATABASE_URL database is "${database}", not "vitashop_dev". This integration test requires exactly "vitashop_dev".`)
  }
}

assertLocalVitashopDevTarget()

let server: Server
let baseUrl: string
let readonlyPrisma: PrismaClient

beforeAll(async () => {
  // Fails clearly (throws, does not skip) if the DB is unreachable — the
  // app under test performs the actual round-trip once a request is made.
  const { app } = await import('../index.js')
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to determine the ephemeral test server port.')
  }
  baseUrl = `http://127.0.0.1:${address.port}`

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  readonlyPrisma = new PrismaClient({ adapter })
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()))
  })
  await readonlyPrisma.$disconnect()
})

describe('GET /api/categories', () => {
  it('returns exactly the six canonical categories, in fixed order, with no product counts', async () => {
    const res = await fetch(`${baseUrl}/api/categories`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as CategoriesEnvelope
    expect(body.items).toEqual(CANONICAL_CATEGORIES.map(({ nameHe, nameEn, slug }) => ({ slug, nameHe, nameEn })))
    for (const item of body.items) {
      expect(item).not.toHaveProperty('productCount')
      expect(item).not.toHaveProperty('count')
    }
  })
})

describe('GET /api/products', () => {
  it('returns 200 with the approved envelope shape', async () => {
    const res = await fetch(`${baseUrl}/api/products`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ProductsEnvelope
    expect(Array.isArray(body.items)).toBe(true)
    expect(body.page).toBe(1)
    expect(body.pageSize).toBe(24)
    expect(body.totalItems).toBe(body.items.length)
    expect(body.totalPages).toBe(Math.ceil(body.totalItems / 24))
  })

  it('returns only active products (matches a direct read-only count)', async () => {
    const activeCount = await readonlyPrisma.product.count({ where: { isActive: true } })
    const res = await fetch(`${baseUrl}/api/products`)
    const body = (await res.json()) as ProductsEnvelope
    expect(body.items.length).toBe(activeCount)
  })

  it('returns items in deterministic slug-ascending order', async () => {
    const res = await fetch(`${baseUrl}/api/products`)
    const body = (await res.json()) as ProductsEnvelope
    const slugs = body.items.map((item) => item.slug)
    expect(slugs).toEqual([...slugs].sort((a, b) => a.localeCompare(b)))
  })

  it('serializes price as a two-decimal string, never a number', async () => {
    const res = await fetch(`${baseUrl}/api/products`)
    const body = (await res.json()) as ProductsEnvelope
    for (const item of body.items) {
      expect(typeof item.price).toBe('string')
      expect(item.price).toMatch(/^\d+\.\d{2}$/)
    }
  })

  it('returns imageFile as a basename only (or null), never a path', async () => {
    const res = await fetch(`${baseUrl}/api/products`)
    const body = (await res.json()) as ProductsEnvelope
    for (const item of body.items) {
      if (item.imageFile !== null) {
        expect(typeof item.imageFile).toBe('string')
        expect(item.imageFile).not.toContain('/')
      }
    }
  })

  it('never includes description, ingredients, warnings, targetAudience, id, or timestamps', async () => {
    const res = await fetch(`${baseUrl}/api/products`)
    const body = (await res.json()) as ProductsEnvelope
    for (const item of body.items) {
      expect(item).not.toHaveProperty('id')
      expect(item).not.toHaveProperty('descriptionHe')
      expect(item).not.toHaveProperty('descriptionEn')
      expect(item).not.toHaveProperty('warningsAllergens')
      expect(item).not.toHaveProperty('targetAudience')
      expect(item).not.toHaveProperty('createdAt')
      expect(item).not.toHaveProperty('ingredients')
    }
  })

  it('rejects an unsupported query parameter with 400 UNSUPPORTED_QUERY_PARAMETER', async () => {
    const res = await fetch(`${baseUrl}/api/products?category=vitamins`)
    expect(res.status).toBe(400)
    const body = (await res.json()) as ApiErrorEnvelope
    expect(body.error.code).toBe('UNSUPPORTED_QUERY_PARAMETER')
    expect(body.error.fields).toEqual(['category'])
  })

  it('reports every offending parameter name when several are sent', async () => {
    const res = await fetch(`${baseUrl}/api/products?foo=1&bar=2`)
    expect(res.status).toBe(400)
    const body = (await res.json()) as ApiErrorEnvelope
    expect(body.error.code).toBe('UNSUPPORTED_QUERY_PARAMETER')
    expect(new Set(body.error.fields)).toEqual(new Set(['foo', 'bar']))
  })
})
