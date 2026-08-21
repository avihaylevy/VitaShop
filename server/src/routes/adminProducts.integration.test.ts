import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import argon2 from 'argon2'
import express from 'express'
import type { Server } from 'node:http'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createAdminProductRouter } from './adminProducts.js'
import { createAuthRouter } from './auth.js'
import { createAuthRateLimiters } from '../lib/rateLimit.js'
import { ARGON2_OPTIONS } from '../lib/registrationService.js'
import { prewarmDummyHash } from '../lib/loginService.js'
import { createSessionMiddleware } from '../lib/session.js'
import { NullEmailProvider } from '../lib/emailService.js'
import { getCart } from '../lib/cartService.js'
import { findActiveProductBySlug } from '../lib/catalogProductLookup.js'
import { deriveSlug } from '../lib/adminProductForm.js'
import { buildProductWhere } from '../lib/catalogFilterWhere.js'
import { TEST_FIXTURE_SLUG_PREFIX } from '../lib/testFixturePrefix.js'

/**
 * MILESTONE-010 Checkpoint A — the product-admin routes, over the wire.
 *
 * 🔴 TWO SUBJECTS. The GUARD (who gets through: anonymous, shopper,
 * admin — the adminOrders precedent), and the SEAMS an edit crosses:
 * a price edit must reach the very next cart read (the club's live-seam
 * proof pattern), and the INV-03 toggle must flip what the SHOP serves
 * while the ADMIN list keeps the row visible.
 *
 * ⚠️ A fresh app per test, so one test cannot spend another's limiter
 * budget. Fixtures under TEST_FIXTURE_SLUG_PREFIX only (DEC-063).
 */

let prisma: PrismaClient
let server: Server
let baseUrl: string

const SLUG = `${TEST_FIXTURE_SLUG_PREFIX}admin-product`
const ADMIN = 'zz-adminproduct-admin@example.test'
const SHOPPER = 'zz-adminproduct-shopper@example.test'
const PASSWORD = 'Abcdef12xyz'

let shopperId = ''
let productId = ''

async function signIn(email: string): Promise<string> {
  const r = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  expect(r.status).toBe(200)
  const set = r.headers.get('set-cookie')
  if (!set) throw new Error('no session cookie')
  return set.split(';')[0] ?? ''
}

function api(path: string, init: { method?: string; cookie?: string; body?: unknown } = {}) {
  return fetch(`${baseUrl}/api/admin/products${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(init.cookie ? { cookie: init.cookie } : {}),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  })
}

async function cleanupCreated(): Promise<void> {
  // Rows this suite creates through the CREATE route carry derived slugs
  // from the fixture-prefixed English name, so the prefix scopes them too.
  // Children first (DEC-089b image rows, this suite's own cart lines) —
  // the FK RESTRICT otherwise fails the product delete.
  const created = await prisma.product.findMany({
    where: { slug: { startsWith: deriveSlug(`${TEST_FIXTURE_SLUG_PREFIX}created`) } },
    select: { id: true },
  })
  if (created.length === 0) return
  const ids = created.map((p) => p.id)
  await prisma.cartItem.deleteMany({ where: { productId: { in: ids } } })
  await prisma.productImage.deleteMany({ where: { productId: { in: ids } } })
  await prisma.productHealthGoal.deleteMany({ where: { productId: { in: ids } } })
  await prisma.product.deleteMany({ where: { id: { in: ids } } })
  // Goal rows the NEW-goal create path minted — same insensitive,
  // prefix-scoped, childless-only sweep as the brands below.
  await prisma.healthGoal.deleteMany({
    where: {
      nameEn: { startsWith: TEST_FIXTURE_SLUG_PREFIX, mode: 'insensitive' },
      products: { none: {} },
    },
  })
  // Brand rows the NEW-company create path minted (prefix-scoped names,
  // DEC-063) — after their products, and only ones no product still holds.
  // ⚠️ INSENSITIVE, because the dedupe tests deliberately create the name
  // in other casings and a case-sensitive sweep leaves those rows behind
  // to poison the next run (observed live: one mutation-test run's
  // uppercase row survived and every later dedupe attached to it).
  await prisma.brand.deleteMany({
    where: {
      name: { startsWith: TEST_FIXTURE_SLUG_PREFIX, mode: 'insensitive' },
      products: { none: {} },
    },
  })
}

beforeAll(async () => {
  await prewarmDummyHash()
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

  const seeded = await prisma.product.findFirstOrThrow({
    where: { isActive: true },
    select: { categoryId: true, brandId: true },
  })
  const product = await prisma.product.upsert({
    where: { slug: SLUG },
    create: {
      slug: SLUG,
      nameHe: 'מוצר בדיקת ניהול',
      nameEn: 'Admin product test',
      categoryId: seeded.categoryId,
      brandId: seeded.brandId,
      dosageForm: 'CAPSULE',
      packageQuantity: 60,
      usageInstructions: 'בדיקה',
      price: '50.00',
      stockQuantity: 20,
      descriptionHe: 'בדיקה',
      descriptionEn: 'test',
      warningsAllergens: '',
      isActive: true,
    },
    update: { price: '50.00', stockQuantity: 20, isActive: true },
    select: { id: true },
  })
  productId = product.id

  const hash = await argon2.hash(PASSWORD, ARGON2_OPTIONS)
  for (const [email, role] of [
    [ADMIN, 'admin'],
    [SHOPPER, 'customer'],
  ] as const) {
    await prisma.user.upsert({
      where: { email },
      create: {
        email,
        firstName: 'Admin',
        lastName: 'Product',
        passwordHash: hash,
        termsAcceptedAt: new Date(),
        status: 'active',
        role,
      },
      update: { status: 'active', role, passwordHash: hash },
      select: { id: true },
    })
  }
  shopperId = (
    await prisma.user.findUniqueOrThrow({ where: { email: SHOPPER }, select: { id: true } })
  ).id
  await cleanupCreated()
}, 60_000)

beforeEach(async () => {
  const app = express()
  app.use(express.json())
  app.use(createSessionMiddleware())
  app.use('/api/admin/products', createAdminProductRouter({ prisma }))
  app.use(
    '/api',
    createAuthRouter({
      prisma,
      emailService: new NullEmailProvider(),
      appBaseUrl: 'http://127.0.0.1',
      rateLimiters: createAuthRateLimiters(),
    }),
  )
  await new Promise<void>((r) => {
    server = app.listen(0, () => r())
  })
  const a = server.address()
  if (!a || typeof a === 'string') throw new Error('no ephemeral port')
  baseUrl = `http://127.0.0.1:${a.port}`
  // The fixture back to its intended shape after any test that changed it.
  await prisma.product.update({
    where: { slug: SLUG },
    data: { price: '50.00', stockQuantity: 20, isActive: true, nameEn: 'Admin product test' },
  })
})

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()))
  await cleanupCreated()
  const carts = await prisma.cart.findMany({
    where: { userId: shopperId },
    select: { id: true },
  })
  if (carts.length > 0) {
    const ids = carts.map((c) => c.id)
    await prisma.cartItem.deleteMany({ where: { cartId: { in: ids } } })
    await prisma.cart.deleteMany({ where: { id: { in: ids } } })
  }
})

afterAll(async () => {
  try {
    await cleanupCreated()
    await prisma.product.deleteMany({ where: { slug: SLUG } })
    await prisma.user.deleteMany({ where: { email: { in: [ADMIN, SHOPPER] } } })
  } finally {
    await prisma.$disconnect()
  }
})

describe('🔴 the guard — who gets through (the adminOrders precedent)', () => {
  it('anonymous is 401 on every route', async () => {
    expect((await api('/')).status).toBe(401)
    expect((await api('/options')).status).toBe(401)
    expect((await fetch(`${baseUrl}/api/admin/products/image`, { method: 'POST' })).status).toBe(401)
    expect((await api(`/${productId}`, { method: 'PATCH', body: { price: '60.00' } })).status).toBe(401)
    expect(
      (await api(`/${productId}/active`, { method: 'PATCH', body: { isActive: false } })).status,
    ).toBe(401)
    expect((await api('/', { method: 'POST', body: {} })).status).toBe(401)
  })

  it('🔴 a signed-in SHOPPER is 403 on every route, and nothing changes', async () => {
    const cookie = await signIn(SHOPPER)
    expect((await api('/', { cookie })).status).toBe(403)
    expect((await api('/options', { cookie })).status).toBe(403)
    const patch = await api(`/${productId}`, { method: 'PATCH', cookie, body: { price: '1.00' } })
    expect(patch.status).toBe(403)
    const toggle = await api(`/${productId}/active`, {
      method: 'PATCH',
      cookie,
      body: { isActive: false },
    })
    expect(toggle.status).toBe(403)

    // 🔴 Asserted against the DATABASE, not just the status code.
    const row = await prisma.product.findUniqueOrThrow({
      where: { slug: SLUG },
      select: { price: true, isActive: true },
    })
    expect(row.price.toFixed(2)).toBe('50.00')
    expect(row.isActive).toBe(true)
  })
})

describe('the list — the ONE surface where inactive rows stay visible', () => {
  it('includes an inactive product; ?status filters narrow it', async () => {
    await prisma.product.update({ where: { slug: SLUG }, data: { isActive: false } })
    const cookie = await signIn(ADMIN)

    const all = (await (await api(`/?q=${SLUG}`, { cookie })).json()) as {
      products: { slug: string; isActive: boolean }[]
    }
    expect(all.products.some((p) => p.slug === SLUG && p.isActive === false)).toBe(true)

    const active = (await (await api(`/?q=${SLUG}&status=active`, { cookie })).json()) as {
      products: { slug: string }[]
    }
    expect(active.products.some((p) => p.slug === SLUG)).toBe(false)

    const inactive = (await (await api(`/?q=${SLUG}&status=inactive`, { cookie })).json()) as {
      products: { slug: string }[]
    }
    expect(inactive.products.some((p) => p.slug === SLUG)).toBe(true)
  })
})

describe('🔴 PATCH — the edit reaches the next read, and frozen figures never move', () => {
  it('a PRICE edit reaches the very next cart read (the live-seam proof)', async () => {
    const product = await prisma.product.findUniqueOrThrow({
      where: { slug: SLUG },
      select: { id: true },
    })
    const cart = await prisma.cart.upsert({
      where: { userId: shopperId },
      create: { userId: shopperId },
      update: {},
      select: { id: true },
    })
    await prisma.cartItem.upsert({
      where: { cartId_productId: { cartId: cart.id, productId: product.id } },
      create: { cartId: cart.id, productId: product.id, quantity: 2 },
      update: { quantity: 2 },
      select: { id: true },
    })

    const before = await getCart(prisma, { userId: shopperId })
    expect(before.items[0]!.unitPrice).toBe('50.00')

    const cookie = await signIn(ADMIN)
    const r = await api(`/${productId}`, { method: 'PATCH', cookie, body: { price: '44.90' } })
    expect(r.status).toBe(200)

    const after = await getCart(prisma, { userId: shopperId })
    expect(after.items[0]!.unitPrice).toBe('44.90')
    expect(after.items[0]!.baseUnitPrice).toBe('44.90')
    expect(after.subtotal).toBe('89.80')
  })

  it('a STOCK edit lands, and a partial patch touches ONLY the sent fields', async () => {
    const cookie = await signIn(ADMIN)
    const r = await api(`/${productId}`, { method: 'PATCH', cookie, body: { stockQuantity: 3 } })
    expect(r.status).toBe(200)

    const row = await prisma.product.findUniqueOrThrow({
      where: { slug: SLUG },
      select: { stockQuantity: true, price: true, nameHe: true },
    })
    expect(row.stockQuantity).toBe(3)
    // Untouched by the patch:
    expect(row.price.toFixed(2)).toBe('50.00')
    expect(row.nameHe).toBe('מוצר בדיקת ניהול')
  })

  it('ISSUE-158: a DOSAGE FORM patch lands, and a bad value is its named 400', async () => {
    const cookie = await signIn(ADMIN)
    const ok = await api(`/${productId}`, { method: 'PATCH', cookie, body: { dosageForm: 'SYRUP' } })
    expect(ok.status).toBe(200)
    const row = await prisma.product.findUniqueOrThrow({
      where: { slug: SLUG },
      select: { dosageForm: true },
    })
    expect(row.dosageForm).toBe('SYRUP')
    // Back to the fixture's shape for the suite's other tests.
    await prisma.product.update({ where: { slug: SLUG }, data: { dosageForm: 'CAPSULE' } })

    const bad = await api(`/${productId}`, { method: 'PATCH', cookie, body: { dosageForm: 'GUMMY' } })
    expect(bad.status).toBe(400)
    const body = (await bad.json()) as { error: { codes: string[] } }
    expect(body.error.codes).toContain('DOSAGE_FORM_INVALID')
  })

  it('🔴 refusals carry NAMED codes: bad price, negative stock, empty body, unknown key', async () => {
    const cookie = await signIn(ADMIN)

    const price = await api(`/${productId}`, { method: 'PATCH', cookie, body: { price: '10.9' } })
    expect(price.status).toBe(400)
    expect(((await price.json()) as { error: { codes: string[] } }).error.codes).toContain(
      'PRICE_INVALID',
    )

    // 🔴 Review finding — '00.00' satisfied the old `!== '0.00'` guard and
    // stored a ₪0.00 product. The canonical form forbids the disguise and
    // positivity is checked numerically.
    for (const disguisedZero of ['00.00', '000.00', '0.00']) {
      const zero = await api(`/${productId}`, {
        method: 'PATCH',
        cookie,
        body: { price: disguisedZero },
      })
      expect(zero.status).toBe(400)
      expect(((await zero.json()) as { error: { codes: string[] } }).error.codes).toContain(
        'PRICE_INVALID',
      )
    }

    // 🔴 Review finding — an unbounded value overflowed Decimal(10,2)/Int32
    // at the DATABASE and answered a retryable 503 for a validation problem.
    const hugePrice = await api(`/${productId}`, {
      method: 'PATCH',
      cookie,
      body: { price: '123456789.00' },
    })
    expect(hugePrice.status).toBe(400)
    const hugeStock = await api(`/${productId}`, {
      method: 'PATCH',
      cookie,
      body: { stockQuantity: 99999999999 },
    })
    expect(hugeStock.status).toBe(400)
    expect(((await hugeStock.json()) as { error: { codes: string[] } }).error.codes).toContain(
      'STOCK_INVALID',
    )

    // DEC-083 AMENDED 2026-08-17 (user decision) — the admin IS a writer
    // of the tri-state claims now; only a NON-tri-state value refuses.
    const dietary = await api(`/${productId}`, {
      method: 'PATCH',
      cookie,
      body: { isKosher: 'yes' },
    })
    expect(dietary.status).toBe(400)
    expect(((await dietary.json()) as { error: { codes: string[] } }).error.codes).toContain(
      'KOSHER_INVALID',
    )

    const stock = await api(`/${productId}`, {
      method: 'PATCH',
      cookie,
      body: { stockQuantity: -1 },
    })
    expect(stock.status).toBe(400)
    expect(((await stock.json()) as { error: { codes: string[] } }).error.codes).toContain(
      'STOCK_INVALID',
    )

    // An empty patch is a request to change nothing — refused, not a 200
    // that quietly did nothing.
    const empty = await api(`/${productId}`, { method: 'PATCH', cookie, body: {} })
    expect(empty.status).toBe(400)

    // .strict(): a misspelled field must refuse, not silently no-op —
    // the silent-loss family.
    const unknown = await api(`/${productId}`, {
      method: 'PATCH',
      cookie,
      body: { pricee: '10.00' },
    })
    expect(unknown.status).toBe(400)
  })

  it('an unknown id is 404, indistinguishable shape from the empty-id path', async () => {
    const cookie = await signIn(ADMIN)
    const r = await api('/no-such-id', { method: 'PATCH', cookie, body: { price: '10.00' } })
    expect(r.status).toBe(404)
  })
})

describe('🔴 the INV-03 toggle — the shop stops serving it, the admin list keeps it', () => {
  it('deactivate: shop detail 404s; reactivate: it serves again', async () => {
    const cookie = await signIn(ADMIN)

    const off = await api(`/${productId}/active`, {
      method: 'PATCH',
      cookie,
      body: { isActive: false },
    })
    expect(off.status).toBe(200)

    // The SHOP's own read path — a soft-deleted product is a 404 there
    // (MILESTONE-005's rule), while the row itself still exists.
    expect(await findActiveProductBySlug(prisma, SLUG)).toBeNull()
    const row = await prisma.product.findUnique({ where: { slug: SLUG }, select: { id: true } })
    expect(row).not.toBeNull()

    const on = await api(`/${productId}/active`, {
      method: 'PATCH',
      cookie,
      body: { isActive: true },
    })
    expect(on.status).toBe(200)
    expect(await findActiveProductBySlug(prisma, SLUG)).not.toBeNull()
  })

  it('a non-boolean isActive is refused with its named code', async () => {
    const cookie = await signIn(ADMIN)
    const r = await api(`/${productId}/active`, {
      method: 'PATCH',
      cookie,
      body: { isActive: 'no' },
    })
    expect(r.status).toBe(400)
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe('IS_ACTIVE_INVALID')
  })
})

describe('the create pickers — /options', () => {
  it('returns every category and brand with id + names', async () => {
    const cookie = await signIn(ADMIN)
    const r = await api('/options', { cookie })
    expect(r.status).toBe(200)
    const body = (await r.json()) as {
      categories: { id: string; nameHe: string; nameEn: string }[]
      brands: { id: string; name: string; nameEn: string | null }[]
    }
    expect(body.categories.length).toBeGreaterThan(0)
    expect(body.brands.length).toBeGreaterThan(0)
    expect(typeof body.categories[0]!.id).toBe('string')
    expect(typeof body.brands[0]!.name).toBe('string')
  })
})

async function createBody(overrides: Record<string, unknown> = {}) {
  const seeded = await prisma.product.findFirstOrThrow({
    where: { isActive: true },
    select: { categoryId: true, brandId: true },
  })
  return {
    nameHe: 'מוצר חדש לבדיקה',
    nameEn: `${TEST_FIXTURE_SLUG_PREFIX}created product`,
    categoryId: seeded.categoryId,
    brandId: seeded.brandId,
    dosageForm: 'TABLET',
    packageQuantity: 30,
    usageInstructions: 'בדיקה',
    price: '25.50',
    stockQuantity: 7,
    descriptionHe: 'תיאור בדיקה',
    descriptionEn: 'created in a test',
    ...overrides,
  }
}


describe('DEC-089c — the image upload', () => {
  // A 1x1 PNG, bytes verbatim.
  const PNG_BYTES = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )

  async function upload(cookie: string, type: string, field = 'image') {
    const body = new FormData()
    body.append(field, new Blob([PNG_BYTES], { type }), 'ignored-client-name.png')
    return fetch(`${baseUrl}/api/admin/products/image`, {
      method: 'POST',
      headers: { cookie },
      body,
    })
  }

  it('🔴 a shopper is 403; an admin gets a server-minted /uploads path and the file SERVES', async () => {
    const shopperCookie = await signIn(SHOPPER)
    expect((await upload(shopperCookie, 'image/png')).status).toBe(403)

    const cookie = await signIn(ADMIN)
    const r = await upload(cookie, 'image/png')
    expect(r.status).toBe(201)
    const { url } = (await r.json()) as { url: string }
    // Server-minted name: uuid + extension from the VERIFIED type — nothing
    // of the client's filename survives.
    expect(url).toMatch(/^\/uploads\/products\/[0-9a-f-]{36}\.png$/)
    expect(url).not.toContain('ignored-client-name')

    // The static route serves what the upload stored. (No static mount in
    // this test app — assert the file landed where index.ts serves from.)
    const { readFile } = await import('node:fs/promises')
    const path = await import('node:path')
    const { PRODUCTS_UPLOAD_DIR } = await import('../lib/uploadPaths.js')
    const stored = await readFile(path.join(PRODUCTS_UPLOAD_DIR, url.split('/').pop()!))
    expect(Buffer.compare(stored, PNG_BYTES)).toBe(0)
    await (await import('node:fs/promises')).rm(
      path.join(PRODUCTS_UPLOAD_DIR, url.split('/').pop()!),
    )
  })

  it('🔴 the BYTES decide, not the claimed header — non-image bytes labelled image/png are refused, and nothing is written', async () => {
    const cookie = await signIn(ADMIN)
    const path = await import('node:path')
    const { readdir, mkdir } = await import('node:fs/promises')
    const { PRODUCTS_UPLOAD_DIR } = await import('../lib/uploadPaths.js')
    await mkdir(PRODUCTS_UPLOAD_DIR, { recursive: true })
    void path
    const before = await readdir(PRODUCTS_UPLOAD_DIR)

    const body = new FormData()
    body.append('image', new Blob([Buffer.from('<html>not an image</html>')], { type: 'image/png' }), 'x.png')
    const r = await fetch(`${baseUrl}/api/admin/products/image`, {
      method: 'POST',
      headers: { cookie },
      body,
    })
    expect(r.status).toBe(400)
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe('IMAGE_TYPE_INVALID')
    // "Nothing is written" — verified, not just titled (review finding).
    expect(await readdir(PRODUCTS_UPLOAD_DIR)).toEqual(before)
  })

  it('the uploaded path is a VALID create imageUrl and flows through the cart unmangled', async () => {
    const cookie = await signIn(ADMIN)
    const uploaded = await upload(cookie, 'image/webp')
    expect(uploaded.status).toBe(201)
    const { url } = (await uploaded.json()) as { url: string }

    const r = await api('/', { method: 'POST', cookie, body: await createBody({ imageUrl: url }) })
    expect(r.status).toBe(201)
    const { product } = (await r.json()) as { product: { id: string } }
    const images = await prisma.productImage.findMany({
      where: { productId: product.id },
      select: { url: true },
    })
    expect(images).toEqual([{ url }])

    const path = await import('node:path')
    const { PRODUCTS_UPLOAD_DIR } = await import('../lib/uploadPaths.js')
    await (await import('node:fs/promises')).rm(
      path.join(PRODUCTS_UPLOAD_DIR, url.split('/').pop()!),
    )
  })
})

describe('CREATE — DEC-088 O2/O4', () => {
  it('creates with a DERIVED slug, and the product is live on the shop path', async () => {
    const cookie = await signIn(ADMIN)
    const r = await api('/', { method: 'POST', cookie, body: await createBody() })
    expect(r.status).toBe(201)
    const { product } = (await r.json()) as { product: { slug: string; price: string } }
    expect(product.slug).toBe(deriveSlug(`${TEST_FIXTURE_SLUG_PREFIX}created product`))
    expect(product.price).toBe('25.50')
    expect(await findActiveProductBySlug(prisma, product.slug)).not.toBeNull()
  })

  it('🔴 a taken slug gets a numeric suffix, never a 500 and never a silent overwrite', async () => {
    const cookie = await signIn(ADMIN)
    const first = await api('/', { method: 'POST', cookie, body: await createBody() })
    expect(first.status).toBe(201)
    // DEC-093 gates identical names now; the suffix machinery under test
    // is reached through the explicit override.
    const second = await api('/', {
      method: 'POST',
      cookie,
      body: await createBody({ allowDuplicate: true }),
    })
    expect(second.status).toBe(201)
    const a = ((await first.json()) as { product: { slug: string } }).product.slug
    const b = ((await second.json()) as { product: { slug: string } }).product.slug
    expect(a).not.toBe(b)
    expect(b).toBe(`${a}-2`)
  })

  it('a nameEn that derives NO slug is refused loudly', async () => {
    const cookie = await signIn(ADMIN)
    const r = await api('/', { method: 'POST', cookie, body: await createBody({ nameEn: 'מוצר' }) })
    // NAME_EN passes (non-empty) but no slug is derivable from Hebrew.
    expect(r.status).toBe(400)
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe('SLUG_UNDERIVABLE')
  })

  it('an unknown category or brand is a named 400, not a DB error', async () => {
    const cookie = await signIn(ADMIN)
    const r = await api('/', {
      method: 'POST',
      cookie,
      body: await createBody({ categoryId: 'no-such-category' }),
    })
    expect(r.status).toBe(400)
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe('CATEGORY_NOT_FOUND')
  })

  it('🔴 a NON-CANONICAL category is refused — one create must not be able to 500 the shop catalogue', async () => {
    // catalogMapper fail-closes the WHOLE catalogue on an active product
    // under a category outside the REQ-F-001 list (review finding).
    const rogue = await prisma.category.upsert({
      where: { id: 'zz-rogue-category' },
      create: { id: 'zz-rogue-category', nameHe: 'קטגוריה זרה לבדיקה', nameEn: 'Rogue test category' },
      update: {},
      select: { id: true },
    })
    try {
      const cookie = await signIn(ADMIN)
      const r = await api('/', {
        method: 'POST',
        cookie,
        body: await createBody({ categoryId: rogue.id }),
      })
      expect(r.status).toBe(400)
      expect(((await r.json()) as { error: { code: string } }).error.code).toBe(
        'CATEGORY_NOT_CANONICAL',
      )

      // And /options never offers it in the first place.
      const options = await api('/options', { cookie })
      const body = (await options.json()) as { categories: { id: string }[] }
      expect(body.categories.some((c) => c.id === rogue.id)).toBe(false)
    } finally {
      /*
       * ⚠️ Deleting any product the gate FAILED to refuse before deleting
       * the category — otherwise the FK RESTRICT error here MASKS the real
       * assertion failure (exactly how this test's first run hid a broken
       * `=== null` check against a helper that returns undefined).
       */
      await prisma.product.deleteMany({ where: { categoryId: rogue.id } })
      await prisma.category.delete({ where: { id: rogue.id } })
    }
  })

  it('🔴 an admin-created product carries allergenInfoIncomplete=true — no unearned sourced claim', async () => {
    const cookie = await signIn(ADMIN)
    const r = await api('/', { method: 'POST', cookie, body: await createBody() })
    expect(r.status).toBe(201)
    const { product } = (await r.json()) as { product: { slug: string } }
    const row = await prisma.product.findUniqueOrThrow({
      where: { slug: product.slug },
      select: { allergenInfoIncomplete: true, isKosher: true },
    })
    expect(row.allergenInfoIncomplete).toBe(true)
    // DEC-083: no sourced claim means NULL, and no admin path may invent one.
    expect(row.isKosher).toBeNull()
  })

  it('DEC-089b — an image URL creates the ProductImage row, and the cart passes it through UNMANGLED', async () => {
    const cookie = await signIn(ADMIN)
    const imageUrl = 'https://example.test/images/omega.png'
    const r = await api('/', { method: 'POST', cookie, body: await createBody({ imageUrl }) })
    expect(r.status).toBe(201)
    const { product } = (await r.json()) as { product: { id: string; slug: string } }

    const images = await prisma.productImage.findMany({
      where: { productId: product.id },
      select: { url: true, sortOrder: true },
    })
    expect(images).toEqual([{ url: imageUrl, sortOrder: 0 }])

    // The catalogue DTO must carry the FULL URL — the old basename
    // reduction would have handed the client "omega.png", a filename its
    // bundle has never heard of.
    const detail = await findActiveProductBySlug(prisma, product.slug)
    expect(detail).not.toBeNull()

    // And the cart line's imageFile too (the shared toImageRef rule).
    const cart = await prisma.cart.upsert({
      where: { userId: shopperId },
      create: { userId: shopperId },
      update: {},
      select: { id: true },
    })
    await prisma.cartItem.create({
      data: { cartId: cart.id, productId: product.id, quantity: 1 },
      select: { id: true },
    })
    const dto = await getCart(prisma, { userId: shopperId })
    expect(dto.items[0]!.imageFile).toBe(imageUrl)
  })

  it('DEC-089b — a NON-http image link is refused with its named code', async () => {
    const cookie = await signIn(ADMIN)
    const r = await api('/', {
      method: 'POST',
      cookie,
      body: await createBody({ imageUrl: 'ftp://example.test/x.png' }),
    })
    expect(r.status).toBe(400)
    expect(((await r.json()) as { error: { codes: string[] } }).error.codes).toContain(
      'IMAGE_URL_INVALID',
    )
  })

  it('validation refusals carry the named codes', async () => {
    const cookie = await signIn(ADMIN)
    const r = await api('/', {
      method: 'POST',
      cookie,
      body: await createBody({ nameHe: '', price: '3', packageQuantity: 0 }),
    })
    expect(r.status).toBe(400)
    const codes = ((await r.json()) as { error: { codes: string[] } }).error.codes
    expect(codes).toContain('NAME_HE_REQUIRED')
    expect(codes).toContain('PRICE_INVALID')
    expect(codes).toContain('PACKAGE_QUANTITY_INVALID')
  })
})

describe('CREATE — a NEW company by name (user report 2026-08-17)', () => {
  // Prefix-scoped (DEC-063) so cleanupCreated can retire it. Mixed case on
  // purpose — the dedupe below must be proven case-insensitive.
  const NEW_BRAND = `${TEST_FIXTURE_SLUG_PREFIX}New-Brand Co`
  const NEW_BRAND_EN = `${TEST_FIXTURE_SLUG_PREFIX}newbrand-latin`

  it('🔴 creates the brand row WITH the product, and the DTO answers it', async () => {
    const cookie = await signIn(ADMIN)
    const r = await api('/', {
      method: 'POST',
      cookie,
      body: await createBody({
        brandId: undefined, // JSON.stringify drops it — exactly one shape travels
        newBrandName: NEW_BRAND,
        newBrandNameEn: NEW_BRAND_EN,
      }),
    })
    expect(r.status).toBe(201)
    const { product } = (await r.json()) as {
      product: { brand: { id: string; name: string; nameEn: string | null } }
    }
    expect(product.brand.name).toBe(NEW_BRAND)
    expect(product.brand.nameEn).toBe(NEW_BRAND_EN)
    const row = await prisma.brand.findUniqueOrThrow({
      where: { id: product.brand.id },
      select: { name: true, nameEn: true },
    })
    expect(row).toEqual({ name: NEW_BRAND, nameEn: NEW_BRAND_EN })
  })

  it('🔴 the same name AGAIN (different case) attaches to the existing row — no duplicate brand', async () => {
    const cookie = await signIn(ADMIN)
    const first = await api('/', {
      method: 'POST',
      cookie,
      body: await createBody({ brandId: undefined, newBrandName: NEW_BRAND }),
    })
    expect(first.status).toBe(201)
    const second = await api('/', {
      method: 'POST',
      cookie,
      // allowDuplicate: the PRODUCT name repeats by design; the subject
      // under test is the BRAND row count (DEC-093 gates the product).
      body: await createBody({
        brandId: undefined,
        newBrandName: NEW_BRAND.toUpperCase(),
        allowDuplicate: true,
      }),
    })
    expect(second.status).toBe(201)
    const a = ((await first.json()) as { product: { brand: { id: string } } }).product.brand.id
    const b = ((await second.json()) as { product: { brand: { id: string } } }).product.brand.id
    expect(b).toBe(a)
    const count = await prisma.brand.count({
      where: { name: { equals: NEW_BRAND, mode: 'insensitive' } },
    })
    expect(count).toBe(1)
  })

  it('the LATIN form also dedupes — typing the nameEn attaches to the same row', async () => {
    const cookie = await signIn(ADMIN)
    const first = await api('/', {
      method: 'POST',
      cookie,
      body: await createBody({
        brandId: undefined,
        newBrandName: NEW_BRAND,
        newBrandNameEn: NEW_BRAND_EN,
      }),
    })
    expect(first.status).toBe(201)
    const second = await api('/', {
      method: 'POST',
      cookie,
      body: await createBody({ brandId: undefined, newBrandName: NEW_BRAND_EN, allowDuplicate: true }),
    })
    expect(second.status).toBe(201)
    const a = ((await first.json()) as { product: { brand: { id: string } } }).product.brand.id
    const b = ((await second.json()) as { product: { brand: { id: string } } }).product.brand.id
    expect(b).toBe(a)
    // And the TYPED Latin form dedupes too (review finding): a different
    // market name whose newBrandNameEn matches the existing row must
    // attach, or the pickers render two identical Latin entries.
    const third = await api('/', {
      method: 'POST',
      cookie,
      body: await createBody({
        brandId: undefined,
        newBrandName: 'שם שוק אחר לגמרי',
        newBrandNameEn: NEW_BRAND_EN.toUpperCase(),
        allowDuplicate: true,
      }),
    })
    expect(third.status).toBe(201)
    const c = ((await third.json()) as { product: { brand: { id: string } } }).product.brand.id
    expect(c).toBe(a)
  })

  it('🔴 a FAILED create leaves no orphan brand — the row rides the product insert', async () => {
    // ⚠️ The failure must fire AFTER brand resolution (the atomicity
    // lesson from the goal twin below): exhaust the slug-suffix loop so
    // the INSERT itself fails, and the brand must not exist.
    const cookie = await signIn(ADMIN)
    const nameEn = `${TEST_FIXTURE_SLUG_PREFIX}created brand exhausted`
    const base = deriveSlug(nameEn)
    const seeded = await prisma.product.findFirstOrThrow({
      where: { isActive: true },
      select: { categoryId: true, brandId: true },
    })
    await prisma.product.createMany({
      data: Array.from({ length: 50 }, (_, i) => ({
        slug: i === 0 ? base : `${base}-${i + 1}`,
        nameHe: 'תופס מזהה',
        nameEn,
        categoryId: seeded.categoryId,
        brandId: seeded.brandId,
        dosageForm: 'TABLET' as const,
        packageQuantity: 1,
        usageInstructions: 'בדיקה',
        price: '10.00',
        stockQuantity: 0,
        descriptionHe: 'בדיקה',
        descriptionEn: 'slug squatter',
        warningsAllergens: '',
        isActive: false,
      })),
    })
    const r = await api('/', {
      method: 'POST',
      cookie,
      body: await createBody({ nameEn, brandId: undefined, newBrandName: NEW_BRAND }),
    })
    expect(r.status).toBe(503)
    const count = await prisma.brand.count({
      where: { name: { equals: NEW_BRAND, mode: 'insensitive' } },
    })
    expect(count).toBe(0)
  })

  it('BOTH shapes at once is BRAND_CONFLICT; NEITHER is BRAND_REQUIRED', async () => {
    const cookie = await signIn(ADMIN)
    const both = await api('/', {
      method: 'POST',
      cookie,
      body: await createBody({ newBrandName: NEW_BRAND }), // brandId stays too
    })
    expect(both.status).toBe(400)
    expect(((await both.json()) as { error: { codes: string[] } }).error.codes).toContain(
      'BRAND_CONFLICT',
    )
    const neither = await api('/', {
      method: 'POST',
      cookie,
      body: await createBody({ brandId: undefined }),
    })
    expect(neither.status).toBe(400)
    expect(((await neither.json()) as { error: { codes: string[] } }).error.codes).toContain(
      'BRAND_REQUIRED',
    )
  })

  it('a present-but-blank new name is its own named refusal', async () => {
    const cookie = await signIn(ADMIN)
    const r = await api('/', {
      method: 'POST',
      cookie,
      body: await createBody({ brandId: undefined, newBrandName: '   ' }),
    })
    expect(r.status).toBe(400)
    expect(((await r.json()) as { error: { codes: string[] } }).error.codes).toContain(
      'NEW_BRAND_NAME_REQUIRED',
    )
  })
})

describe('CREATE — dietary claims + health goals reach the SHOP FILTERS (user report 2026-08-17)', () => {
  const GOAL_HE = 'מטרת בדיקה זמנית'
  const GOAL_EN = `${TEST_FIXTURE_SLUG_PREFIX}test-goal`

  /** The REAL filter seam — the same where-builder GET /api/products runs. */
  function whereFor(partial: Partial<Parameters<typeof buildProductWhere>[0]>) {
    return buildProductWhere(
      {
        q: undefined,
        brand: [],
        ingredient: [],
        healthGoal: [],
        dosageForm: [],
        minPrice: undefined,
        maxPrice: undefined,
        inStock: undefined,
        kosher: undefined,
        glutenFree: undefined,
        vegan: undefined,
        ...partial,
      },
      undefined,
    )
  }

  it('🔴 tri-state claims land on the row, and kosher=true MATCHES the filter where-clause', async () => {
    const cookie = await signIn(ADMIN)
    const r = await api('/', {
      method: 'POST',
      cookie,
      body: await createBody({ isKosher: true, isVegan: false }),
    })
    expect(r.status).toBe(201)
    const { product } = (await r.json()) as { product: { slug: string } }
    const row = await prisma.product.findUniqueOrThrow({
      where: { slug: product.slug },
      select: { isKosher: true, isGlutenFree: true, isVegan: true },
    })
    // true = claimed, false = claimed-negative, absent = null (no claim).
    expect(row).toEqual({ isKosher: true, isGlutenFree: null, isVegan: false })

    const kosherMatches = await prisma.product.findMany({
      where: whereFor({ kosher: true }),
      select: { slug: true },
    })
    expect(kosherMatches.some((p) => p.slug === product.slug)).toBe(true)
    // And the CONTROL: the claimed-false and no-claim filters must NOT match.
    const veganMatches = await prisma.product.findMany({
      where: whereFor({ vegan: true }),
      select: { slug: true },
    })
    expect(veganMatches.some((p) => p.slug === product.slug)).toBe(false)
    const glutenMatches = await prisma.product.findMany({
      where: whereFor({ glutenFree: true }),
      select: { slug: true },
    })
    expect(glutenMatches.some((p) => p.slug === product.slug)).toBe(false)
  })

  it('claims ABSENT stay null — no invented value (DEC-083 default intact)', async () => {
    const cookie = await signIn(ADMIN)
    const r = await api('/', { method: 'POST', cookie, body: await createBody() })
    expect(r.status).toBe(201)
    const { product } = (await r.json()) as { product: { slug: string } }
    const row = await prisma.product.findUniqueOrThrow({
      where: { slug: product.slug },
      select: { isKosher: true, isGlutenFree: true, isVegan: true },
    })
    expect(row).toEqual({ isKosher: null, isGlutenFree: null, isVegan: null })
  })

  it('🔴 a NEW goal AND a picked EXISTING goal both join, and the healthGoal filter finds each', async () => {
    const cookie = await signIn(ADMIN)
    const seededGoal = await prisma.healthGoal.findFirstOrThrow({
      where: { nameEn: { not: { startsWith: TEST_FIXTURE_SLUG_PREFIX } } },
      select: { id: true },
    })
    const r = await api('/', {
      method: 'POST',
      cookie,
      body: await createBody({
        healthGoalIds: [seededGoal.id],
        newHealthGoals: [{ nameHe: GOAL_HE, nameEn: GOAL_EN }],
      }),
    })
    expect(r.status).toBe(201)
    const { product } = (await r.json()) as { product: { id: string; slug: string } }
    const goal = await prisma.healthGoal.findFirstOrThrow({
      where: { nameEn: { equals: GOAL_EN, mode: 'insensitive' } },
      select: { id: true, nameHe: true },
    })
    expect(goal.nameHe).toBe(GOAL_HE)

    for (const goalId of [goal.id, seededGoal.id]) {
      const matches = await prisma.product.findMany({
        where: whereFor({ healthGoal: [goalId] }),
        select: { slug: true },
      })
      expect(matches.some((p) => p.slug === product.slug)).toBe(true)
    }
  })

  it('a new goal name that EXISTS (any case, either language) attaches — no duplicate goal', async () => {
    const cookie = await signIn(ADMIN)
    const first = await api('/', {
      method: 'POST',
      cookie,
      body: await createBody({ newHealthGoals: [{ nameHe: GOAL_HE, nameEn: GOAL_EN }] }),
    })
    expect(first.status).toBe(201)
    const second = await api('/', {
      method: 'POST',
      cookie,
      // allowDuplicate: same product name by design; the subject is the
      // GOAL row count.
      body: await createBody({
        newHealthGoals: [{ nameHe: 'שם עברי אחר לגמרי', nameEn: GOAL_EN.toUpperCase() }],
        allowDuplicate: true,
      }),
    })
    expect(second.status).toBe(201)
    const count = await prisma.healthGoal.count({
      where: { nameEn: { startsWith: TEST_FIXTURE_SLUG_PREFIX, mode: 'insensitive' } },
    })
    expect(count).toBe(1)
  })

  it('🔴 a refused create leaves NO orphan goal — the row rides the product insert', async () => {
    // ⚠️ The refusal must fire AFTER the goal-resolution code, or the test
    // proves nothing about atomicity (first draft used a bad categoryId,
    // which refuses BEFORE goals — an eager-create mutation sailed green
    // through it). The only post-goal failure is the INSERT itself, so
    // exhaust the slug-suffix loop: every slug the route may try is
    // pre-taken, the create 503s, and the goal must not exist.
    const cookie = await signIn(ADMIN)
    const nameEn = `${TEST_FIXTURE_SLUG_PREFIX}created exhausted`
    const base = deriveSlug(nameEn)
    const seeded = await prisma.product.findFirstOrThrow({
      where: { isActive: true },
      select: { categoryId: true, brandId: true },
    })
    await prisma.product.createMany({
      data: Array.from({ length: 50 }, (_, i) => ({
        slug: i === 0 ? base : `${base}-${i + 1}`,
        nameHe: 'תופס מזהה',
        nameEn,
        categoryId: seeded.categoryId,
        brandId: seeded.brandId,
        dosageForm: 'TABLET' as const,
        packageQuantity: 1,
        usageInstructions: 'בדיקה',
        price: '10.00',
        stockQuantity: 0,
        descriptionHe: 'בדיקה',
        descriptionEn: 'slug squatter',
        warningsAllergens: '',
        isActive: false,
      })),
    })
    const r = await api('/', {
      method: 'POST',
      cookie,
      // allowDuplicate: the squatters share the brand and name by design;
      // the subject is the INSERT failing after goal resolution.
      body: await createBody({
        nameEn,
        newHealthGoals: [{ nameHe: GOAL_HE, nameEn: GOAL_EN }],
        allowDuplicate: true,
      }),
    })
    expect(r.status).toBe(503)
    const count = await prisma.healthGoal.count({
      where: { nameEn: { equals: GOAL_EN, mode: 'insensitive' } },
    })
    expect(count).toBe(0)
  })

  it('an unknown goal id and a half-named new goal are NAMED refusals', async () => {
    const cookie = await signIn(ADMIN)
    const unknown = await api('/', {
      method: 'POST',
      cookie,
      body: await createBody({ healthGoalIds: ['no-such-goal'] }),
    })
    expect(unknown.status).toBe(400)
    expect(((await unknown.json()) as { error: { code: string } }).error.code).toBe(
      'HEALTH_GOAL_NOT_FOUND',
    )
    const halfNamed = await api('/', {
      method: 'POST',
      cookie,
      body: await createBody({ newHealthGoals: [{ nameHe: GOAL_HE, nameEn: '' }] }),
    })
    expect(halfNamed.status).toBe(400)
    expect(((await halfNamed.json()) as { error: { codes: string[] } }).error.codes).toContain(
      'NEW_HEALTH_GOAL_INVALID',
    )
  })

  it('PATCH flips a claim, and PATCHING null WITHDRAWS it', async () => {
    const cookie = await signIn(ADMIN)
    const created = await api('/', {
      method: 'POST',
      cookie,
      body: await createBody({ isKosher: true }),
    })
    expect(created.status).toBe(201)
    const { product } = (await created.json()) as { product: { id: string; slug: string } }

    const withdraw = await api(`/${product.id}`, {
      method: 'PATCH',
      cookie,
      body: { isKosher: null, isVegan: true },
    })
    expect(withdraw.status).toBe(200)
    const row = await prisma.product.findUniqueOrThrow({
      where: { slug: product.slug },
      select: { isKosher: true, isVegan: true },
    })
    expect(row).toEqual({ isKosher: null, isVegan: true })
  })
})

describe('DEC-093 — normalized duplicate detection (surface-and-confirm)', () => {
  type DupError = {
    error: {
      code: string
      duplicate: { id: string; nameHe: string; nameEn: string; slug: string; isActive: boolean }
    }
  }

  it('🔴 the SAME name again under the same brand is refused, and the refusal NAMES the twin', async () => {
    const cookie = await signIn(ADMIN)
    const first = await api('/', { method: 'POST', cookie, body: await createBody() })
    expect(first.status).toBe(201)
    const twin = ((await first.json()) as { product: { id: string; slug: string } }).product

    const second = await api('/', { method: 'POST', cookie, body: await createBody() })
    expect(second.status).toBe(400)
    const body = (await second.json()) as DupError
    expect(body.error.code).toBe('PRODUCT_DUPLICATE')
    expect(body.error.duplicate.id).toBe(twin.id)
    expect(body.error.duplicate.slug).toBe(twin.slug)
    expect(body.error.duplicate.isActive).toBe(true)
  })

  it('🔴 NORMALIZED variants are caught: casing, hyphen-vs-space, gershayim', async () => {
    const cookie = await signIn(ADMIN)
    const first = await api('/', { method: 'POST', cookie, body: await createBody() })
    expect(first.status).toBe(201)

    // createBody: nameHe 'מוצר חדש לבדיקה' · nameEn '<prefix>created product'
    // 🔴 Each variant changes BOTH names, keeping only ONE matchable —
    // otherwise the untouched other name matches and the test passes with
    // the rule under test deleted (caught live: the quote-strip mutation
    // sailed green through the first version of this list).
    const variants = [
      // case + spacing — only the ENGLISH path can fire
      { nameHe: 'שם עברי שונה לחלוטין א', nameEn: `${TEST_FIXTURE_SLUG_PREFIX}CREATED   Product` },
      // hyphen vs space — only the HEBREW path can fire
      { nameHe: 'מוצר-חדש לבדיקה', nameEn: `${TEST_FIXTURE_SLUG_PREFIX}created unrelated b` },
      // gershayim stripped — only the HEBREW path can fire
      { nameHe: 'מוצר חד"ש לבדיקה', nameEn: `${TEST_FIXTURE_SLUG_PREFIX}created unrelated c` },
    ]
    for (const variant of variants) {
      const r = await api('/', { method: 'POST', cookie, body: await createBody(variant) })
      expect(r.status).toBe(400)
      expect(((await r.json()) as DupError).error.code).toBe('PRODUCT_DUPLICATE')
    }
  })

  it('🔴 CONTROLS — a legit variant and a cross-brand same-name are both ALLOWED', async () => {
    const cookie = await signIn(ADMIN)
    const first = await api('/', { method: 'POST', cookie, body: await createBody() })
    expect(first.status).toBe(201)

    // A different count is a DIFFERENT product (digits survive
    // normalization by design) — must create.
    const variant = await api('/', {
      method: 'POST',
      cookie,
      body: await createBody({
        nameHe: 'מוצר חדש לבדיקה 60 כמוסות',
        nameEn: `${TEST_FIXTURE_SLUG_PREFIX}created product 60 caps`,
      }),
    })
    expect(variant.status).toBe(201)

    // The same names under ANOTHER brand — different manufacturers may
    // sell identically named products; the check is brand-scoped.
    const seeded = await prisma.product.findFirstOrThrow({
      where: { isActive: true },
      select: { brandId: true },
    })
    const otherBrand = await prisma.brand.findFirstOrThrow({
      where: { id: { not: seeded.brandId } },
      select: { id: true },
    })
    const crossBrand = await api('/', {
      method: 'POST',
      cookie,
      body: await createBody({ brandId: otherBrand.id }),
    })
    expect(crossBrand.status).toBe(201)
  })

  it('an INACTIVE twin still refuses, and the payload says it is inactive', async () => {
    const cookie = await signIn(ADMIN)
    const first = await api('/', { method: 'POST', cookie, body: await createBody() })
    expect(first.status).toBe(201)
    const twin = ((await first.json()) as { product: { id: string } }).product
    await api(`/${twin.id}/active`, { method: 'PATCH', cookie, body: { isActive: false } })

    const second = await api('/', { method: 'POST', cookie, body: await createBody() })
    expect(second.status).toBe(400)
    const body = (await second.json()) as DupError
    expect(body.error.code).toBe('PRODUCT_DUPLICATE')
    expect(body.error.duplicate.isActive).toBe(false)
  })

  it('allowDuplicate=true creates anyway, with the suffixed slug', async () => {
    const cookie = await signIn(ADMIN)
    const first = await api('/', { method: 'POST', cookie, body: await createBody() })
    expect(first.status).toBe(201)
    const a = ((await first.json()) as { product: { slug: string } }).product.slug

    const second = await api('/', {
      method: 'POST',
      cookie,
      body: await createBody({ allowDuplicate: true }),
    })
    expect(second.status).toBe(201)
    const b = ((await second.json()) as { product: { slug: string } }).product.slug
    expect(b).toBe(`${a}-2`)
  })

  it('🔴 a "new" company that DEDUPES to an existing brand still hits the gate', async () => {
    const cookie = await signIn(ADMIN)
    // First product under a NEW company.
    const first = await api('/', {
      method: 'POST',
      cookie,
      body: await createBody({
        brandId: undefined,
        newBrandName: `${TEST_FIXTURE_SLUG_PREFIX}dup-gate brand`,
      }),
    })
    expect(first.status).toBe(201)
    // Same product name, brand typed AGAIN as "new" — resolves to the
    // existing brand row, so the duplicate gate must fire.
    const second = await api('/', {
      method: 'POST',
      cookie,
      body: await createBody({
        brandId: undefined,
        newBrandName: `${TEST_FIXTURE_SLUG_PREFIX}DUP-GATE BRAND`,
      }),
    })
    expect(second.status).toBe(400)
    expect(((await second.json()) as DupError).error.code).toBe('PRODUCT_DUPLICATE')
  })

  it('🔴 PATCH-rename onto a sibling is refused; the override passes; re-saving the OWN name never self-flags', async () => {
    const cookie = await signIn(ADMIN)
    const first = await api('/', { method: 'POST', cookie, body: await createBody() })
    expect(first.status).toBe(201)
    const second = await api('/', {
      method: 'POST',
      cookie,
      body: await createBody({
        nameHe: 'מוצר אחר לבדיקה',
        nameEn: `${TEST_FIXTURE_SLUG_PREFIX}created other product`,
      }),
    })
    expect(second.status).toBe(201)
    const other = ((await second.json()) as { product: { id: string } }).product

    // Rename the second onto the first's Hebrew name → refused.
    const rename = await api(`/${other.id}`, {
      method: 'PATCH',
      cookie,
      body: { nameHe: 'מוצר חדש לבדיקה' },
    })
    expect(rename.status).toBe(400)
    expect(((await rename.json()) as DupError).error.code).toBe('PRODUCT_DUPLICATE')

    // The explicit override applies the rename.
    const overridden = await api(`/${other.id}`, {
      method: 'PATCH',
      cookie,
      body: { nameHe: 'מוצר חדש לבדיקה', allowDuplicate: true },
    })
    expect(overridden.status).toBe(200)

    // Re-saving a product's OWN name must not self-flag (exclude-self).
    const selfSave = await api(`/${other.id}`, {
      method: 'PATCH',
      cookie,
      body: { nameEn: `${TEST_FIXTURE_SLUG_PREFIX}created other product` },
    })
    expect(selfSave.status).toBe(200)
  })

  it('allowDuplicate ALONE is not a change — NO_FIELDS', async () => {
    const cookie = await signIn(ADMIN)
    const r = await api(`/${productId}`, {
      method: 'PATCH',
      cookie,
      body: { allowDuplicate: true },
    })
    expect(r.status).toBe(400)
    expect(((await r.json()) as { error: { codes: string[] } }).error.codes).toContain('NO_FIELDS')
  })
})
