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
  await prisma.product.deleteMany({
    where: { slug: { startsWith: deriveSlug(`${TEST_FIXTURE_SLUG_PREFIX}created`) } },
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

    // 🔴 DEC-083 — dietary flags are SOURCED-ONLY; an admin body carrying
    // one is refused by .strict(), never silently applied or ignored.
    const dietary = await api(`/${productId}`, {
      method: 'PATCH',
      cookie,
      body: { isKosher: true },
    })
    expect(dietary.status).toBe(400)

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

describe('CREATE — DEC-088 O2/O4', () => {
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
    const second = await api('/', { method: 'POST', cookie, body: await createBody() })
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
