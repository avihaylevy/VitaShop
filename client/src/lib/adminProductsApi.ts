import { getApiBaseUrl } from './apiBaseUrl.js'
import type {
  AdminProductCreatePayload,
  AdminProductOptionsResult,
  AdminProductRow,
  AdminProductWriteResult,
  AdminProductsFailure,
  AdminProductsResult,
} from '../types/adminProducts.js'

/**
 * MILESTONE-010 / DEC-088 — the product-admin transport.
 *
 * 🔴 VALIDATED, NOT CAST (the adminOrdersApi precedent): a malformed row
 * would reach a screen whose purpose is editing real prices and stock.
 * 🔴 401 and 403 stay apart — sign in vs not yours — the loop lesson.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMoney(value: unknown): value is string {
  return typeof value === 'string' && /^\d+\.\d{2}$/.test(value)
}

function isDietary(value: unknown): value is boolean | null {
  return value === null || typeof value === 'boolean'
}

function isRow(value: unknown): value is AdminProductRow {
  if (!isPlainObject(value)) return false
  const category = value.category
  const brand = value.brand
  return (
    typeof value.id === 'string' &&
    typeof value.slug === 'string' &&
    value.slug.length > 0 &&
    typeof value.nameHe === 'string' &&
    typeof value.nameEn === 'string' &&
    isMoney(value.price) &&
    typeof value.stockQuantity === 'number' &&
    Number.isInteger(value.stockQuantity) &&
    typeof value.lowStockThreshold === 'number' &&
    typeof value.packageQuantity === 'number' &&
    typeof value.dosageForm === 'string' &&
    typeof value.usageInstructions === 'string' &&
    typeof value.descriptionHe === 'string' &&
    typeof value.descriptionEn === 'string' &&
    typeof value.warningsAllergens === 'string' &&
    isDietary(value.isKosher) &&
    isDietary(value.isGlutenFree) &&
    isDietary(value.isVegan) &&
    // Strict boolean — a missing flag must not read as "active" (the
    // cartApi lesson: absence is a broken response, not a value).
    typeof value.isActive === 'boolean' &&
    typeof value.createdAt === 'string' &&
    isPlainObject(category) &&
    typeof category.id === 'string' &&
    typeof category.nameHe === 'string' &&
    typeof category.nameEn === 'string' &&
    isPlainObject(brand) &&
    typeof brand.id === 'string' &&
    typeof brand.name === 'string' &&
    (brand.nameEn === null || typeof brand.nameEn === 'string')
  )
}

function errorOf(body: unknown): { code?: string; codes: string[]; fields: string[] } {
  if (!isPlainObject(body) || !isPlainObject(body.error)) return { codes: [], fields: [] }
  const error = body.error
  return {
    ...(typeof error.code === 'string' ? { code: error.code } : {}),
    codes: Array.isArray(error.codes)
      ? error.codes.filter((c): c is string => typeof c === 'string')
      : [],
    fields: Array.isArray(error.fields)
      ? error.fields.filter((f): f is string => typeof f === 'string')
      : [],
  }
}

async function call(
  path: string,
  init?: { method: string; body?: unknown },
): Promise<{ status: number; body: unknown } | null> {
  const base = getApiBaseUrl()
  if (!base.ok) return null
  try {
    const response = await fetch(`${base.value}${path}`, {
      method: init?.method ?? 'GET',
      credentials: 'include',
      ...(init?.body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) }),
    })
    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      body = null
    }
    return { status: response.status, body }
  } catch {
    return null
  }
}

function listFailure(status: number): AdminProductsFailure {
  if (status === 401) return { kind: 'unauthenticated' }
  if (status === 403) return { kind: 'notAdmin' }
  if (status === 429) return { kind: 'rateLimited' }
  return { kind: 'unavailable' }
}

export async function requestAdminProducts(
  options: { page?: number; q?: string; status?: 'active' | 'inactive' } = {},
): Promise<AdminProductsResult> {
  const params = new URLSearchParams()
  params.set('page', String(options.page ?? 1))
  if (options.q) params.set('q', options.q)
  if (options.status) params.set('status', options.status)

  const raw = await call(`/api/admin/products?${params.toString()}`)
  if (raw === null) return { ok: false, failure: { kind: 'offline' } }
  if (raw.status !== 200) return { ok: false, failure: listFailure(raw.status) }

  const body = raw.body
  if (!isPlainObject(body) || !Array.isArray(body.products) || !body.products.every(isRow)) {
    return { ok: false, failure: { kind: 'unavailable' } }
  }

  return {
    ok: true,
    page: {
      page: typeof body.page === 'number' ? body.page : 1,
      totalItems: typeof body.totalItems === 'number' ? body.totalItems : 0,
      totalPages: typeof body.totalPages === 'number' ? body.totalPages : 0,
      products: body.products as AdminProductRow[],
    },
  }
}

function writeResult(raw: { status: number; body: unknown } | null): AdminProductWriteResult {
  if (raw === null) return { ok: false, failure: { kind: 'offline' } }

  if (raw.status === 200 || raw.status === 201) {
    const body = raw.body
    if (!isPlainObject(body) || !isRow(body.product)) {
      return { ok: false, failure: { kind: 'server' } }
    }
    return { ok: true, product: body.product }
  }

  if (raw.status === 401) return { ok: false, failure: { kind: 'unauthenticated' } }
  if (raw.status === 403) return { ok: false, failure: { kind: 'notAdmin' } }
  if (raw.status === 404) return { ok: false, failure: { kind: 'gone' } }
  if (raw.status === 429) return { ok: false, failure: { kind: 'rateLimited' } }

  if (raw.status === 400) {
    const { code, codes, fields } = errorOf(raw.body)
    // Single-code refusals (IS_ACTIVE_INVALID, SLUG_UNDERIVABLE,
    // CATEGORY_NOT_FOUND, BRAND_NOT_FOUND) travel as one-element arrays so
    // the form has ONE vocabulary to map.
    return {
      ok: false,
      failure: {
        kind: 'invalid',
        codes: codes.length > 0 ? codes : code ? [code] : [],
        fields,
      },
    }
  }

  return { ok: false, failure: { kind: 'server' } }
}

/** Partial edit — send ONLY the fields being changed. */
export async function patchAdminProduct(
  productId: string,
  fields: Record<string, unknown>,
): Promise<AdminProductWriteResult> {
  return writeResult(
    await call(`/api/admin/products/${encodeURIComponent(productId)}`, {
      method: 'PATCH',
      body: fields,
    }),
  )
}

/** The INV-03 toggle — deactivation and reactivation, one honest boolean. */
export async function setAdminProductActive(
  productId: string,
  isActive: boolean,
): Promise<AdminProductWriteResult> {
  return writeResult(
    await call(`/api/admin/products/${encodeURIComponent(productId)}/active`, {
      method: 'PATCH',
      body: { isActive },
    }),
  )
}

export async function createAdminProduct(
  payload: AdminProductCreatePayload,
): Promise<AdminProductWriteResult> {
  return writeResult(await call('/api/admin/products', { method: 'POST', body: payload }))
}

export type AdminImageUploadResult =
  | { ok: true; url: string }
  | { ok: false; failure: { kind: 'invalid'; code: string } | AdminProductsFailure | { kind: 'server' } }

/**
 * DEC-089c — the image upload. Multipart, so this does NOT ride `call`
 * (fetch must set its own multipart boundary; a manual content-type would
 * break it). Answers the server-minted '/uploads/products/<name>' path,
 * which then travels through the ordinary imageUrl create field.
 */
export async function uploadAdminProductImage(file: File): Promise<AdminImageUploadResult> {
  const base = getApiBaseUrl()
  if (!base.ok) return { ok: false, failure: { kind: 'offline' } }

  const body = new FormData()
  body.append('image', file)

  try {
    const response = await fetch(`${base.value}/api/admin/products/image`, {
      method: 'POST',
      credentials: 'include',
      body,
    })
    let payload: unknown = null
    try {
      payload = await response.json()
    } catch {
      payload = null
    }

    if (response.status === 201 && isPlainObject(payload) && typeof payload.url === 'string') {
      return { ok: true, url: payload.url }
    }
    if (response.status === 401) return { ok: false, failure: { kind: 'unauthenticated' } }
    if (response.status === 403) return { ok: false, failure: { kind: 'notAdmin' } }
    if (response.status === 429) return { ok: false, failure: { kind: 'rateLimited' } }
    if (response.status === 400) {
      const { code } = errorOf(payload)
      return { ok: false, failure: { kind: 'invalid', code: code ?? 'IMAGE_UPLOAD_REJECTED' } }
    }
    return { ok: false, failure: { kind: 'server' } }
  } catch {
    return { ok: false, failure: { kind: 'offline' } }
  }
}

export async function requestAdminProductOptions(): Promise<AdminProductOptionsResult> {
  const raw = await call('/api/admin/products/options')
  if (raw === null) return { ok: false, failure: { kind: 'offline' } }
  if (raw.status !== 200) return { ok: false, failure: listFailure(raw.status) }

  const body = raw.body
  if (!isPlainObject(body) || !Array.isArray(body.categories) || !Array.isArray(body.brands)) {
    return { ok: false, failure: { kind: 'unavailable' } }
  }
  const categories = body.categories.filter(
    (c): c is { id: string; nameHe: string; nameEn: string } =>
      isPlainObject(c) &&
      typeof c.id === 'string' &&
      typeof c.nameHe === 'string' &&
      typeof c.nameEn === 'string',
  )
  const brands = body.brands.filter(
    (b): b is { id: string; name: string; nameEn: string | null } =>
      isPlainObject(b) &&
      typeof b.id === 'string' &&
      typeof b.name === 'string' &&
      (b.nameEn === null || typeof b.nameEn === 'string'),
  )
  return { ok: true, options: { categories, brands } }
}
