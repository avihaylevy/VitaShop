import { getApiBaseUrl } from './apiBaseUrl.js'
import { DIETARY_FACET_VALUES } from '../types/catalog.js'
import type {
  CatalogApiErrorBody,
  CatalogBilingualFacetOptionDto,
  CatalogBrandFacetOptionDto,
  CatalogCategoriesEnvelope,
  CatalogCategoryDto,
  CatalogDietaryFacetDto,
  CatalogDosageFormFacetDto,
  CatalogFacetOptionDto,
  CatalogFacetsDto,
  CatalogFallbackDto,
  CatalogProductDto,
  CatalogProductsEnvelope,
  DosageFormKey,
  ProductDetailDto,
} from '../types/catalog.js'

// Exported since MILESTONE-010: the admin create form offers the same
// list, and a second client copy is the drift the review flagged.
export const DOSAGE_FORM_KEYS: readonly DosageFormKey[] = ['CAPSULE', 'TABLET', 'DROPS', 'POWDER', 'SYRUP']

/**
 * Typed catalogue-request failure. `code` is either a server-issued
 * API_CONTRACT error code (e.g. UNSUPPORTED_QUERY_PARAMETER,
 * CATALOG_DATA_INTEGRITY) or one of this module's own client-side codes
 * (MISSING_CONFIG, NETWORK_ERROR, INVALID_RESPONSE_SHAPE, HTTP_ERROR,
 * UNKNOWN_ERROR). Never thrown for an aborted request — an AbortError
 * propagates unchanged so callers can distinguish "cancelled" from "failed".
 */
export class CatalogApiError extends Error {
  readonly code: string
  readonly status?: number
  readonly fields?: string[]

  constructor(code: string, message: string, options: { status?: number; fields?: string[] } = {}) {
    super(message)
    this.name = 'CatalogApiError'
    this.code = code
    this.status = options.status
    this.fields = options.fields
  }
}

// Exported: favouritesApi validates the SAME card DTO and must use the SAME
// predicate — "reuse, not a parallel definition" (the detail DTO's rule).
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCatalogApiErrorBody(value: unknown): value is CatalogApiErrorBody {
  if (!isPlainObject(value) || !isPlainObject(value.error)) return false
  const { code, message, fields } = value.error
  if (typeof code !== 'string' || typeof message !== 'string') return false
  if (fields !== undefined && (!Array.isArray(fields) || !fields.every((f) => typeof f === 'string'))) return false
  return true
}

export function isCatalogProductDto(value: unknown): value is CatalogProductDto {
  if (!isPlainObject(value)) return false
  return (
    typeof value.slug === 'string' &&
    typeof value.nameHe === 'string' &&
    typeof value.nameEn === 'string' &&
    typeof value.categoryNameHe === 'string' &&
    typeof value.categoryNameEn === 'string' &&
    typeof value.categorySlug === 'string' &&
    typeof value.brandName === 'string' &&
    // == null accepts undefined too: a client bundle must keep rendering
    // against a server that predates the name_en migration (stale deploy /
    // cached HTML) — a missing OPTIONAL display string must never take the
    // catalogue down. mapCatalogProduct already falls back via ??.
    (value.brandNameEn == null || typeof value.brandNameEn === 'string') &&
    typeof value.dosageForm === 'string' &&
    DOSAGE_FORM_KEYS.includes(value.dosageForm as DosageFormKey) &&
    typeof value.packageQuantity === 'number' &&
    typeof value.price === 'string' &&
    /^\d+\.\d{2}$/.test(value.price) &&
    typeof value.stockQuantity === 'number' &&
    typeof value.lowStockThreshold === 'number' &&
    (value.imageFile === null || typeof value.imageFile === 'string')
  )
}

function isCatalogFallbackDto(value: unknown): value is CatalogFallbackDto {
  if (!isPlainObject(value)) return false
  return (
    (value.kind === 'category' || value.kind === 'popular') &&
    Array.isArray(value.items) &&
    value.items.every(isCatalogProductDto) &&
    typeof value.limit === 'number'
  )
}

function isCatalogProductsEnvelope(value: unknown): value is CatalogProductsEnvelope {
  if (!isPlainObject(value)) return false
  return (
    Array.isArray(value.items) &&
    value.items.every(isCatalogProductDto) &&
    typeof value.page === 'number' &&
    typeof value.pageSize === 'number' &&
    typeof value.totalItems === 'number' &&
    typeof value.totalPages === 'number' &&
    (value.fallback === null || isCatalogFallbackDto(value.fallback))
  )
}

function isCatalogCategoryDto(value: unknown): value is CatalogCategoryDto {
  if (!isPlainObject(value)) return false
  return typeof value.slug === 'string' && typeof value.nameHe === 'string' && typeof value.nameEn === 'string'
}

function isCatalogCategoriesEnvelope(value: unknown): value is CatalogCategoriesEnvelope {
  if (!isPlainObject(value)) return false
  return Array.isArray(value.items) && value.items.every(isCatalogCategoryDto)
}

function isCatalogFacetOptionDto(value: unknown): value is CatalogFacetOptionDto {
  if (!isPlainObject(value)) return false
  return typeof value.id === 'string' && typeof value.label === 'string'
}

function isCatalogBrandFacetOptionDto(value: unknown): value is CatalogBrandFacetOptionDto {
  if (!isCatalogFacetOptionDto(value)) return false
  const { labelEn } = value as unknown as Record<string, unknown>
  return labelEn === null || typeof labelEn === 'string'
}

function isCatalogBilingualFacetOptionDto(value: unknown): value is CatalogBilingualFacetOptionDto {
  if (!isPlainObject(value)) return false
  return typeof value.id === 'string' && typeof value.labelHe === 'string' && typeof value.labelEn === 'string'
}

function isCatalogDosageFormFacetDto(value: unknown): value is CatalogDosageFormFacetDto {
  if (!isPlainObject(value)) return false
  return (
    typeof value.value === 'string' &&
    DOSAGE_FORM_KEYS.includes(value.value as DosageFormKey) &&
    typeof value.labelHe === 'string' &&
    typeof value.labelEn === 'string'
  )
}

function isCatalogDietaryFacetDto(value: unknown): value is CatalogDietaryFacetDto {
  if (!isPlainObject(value)) return false
  return (
    typeof value.value === 'string' &&
    (DIETARY_FACET_VALUES as readonly string[]).includes(value.value) &&
    typeof value.labelHe === 'string' &&
    typeof value.labelEn === 'string'
  )
}

// §9d's payload is returned UNWRAPPED by the server — no `items` envelope.
function isCatalogFacetsDto(value: unknown): value is CatalogFacetsDto {
  if (!isPlainObject(value)) return false
  return (
    Array.isArray(value.brands) &&
    value.brands.every(isCatalogBrandFacetOptionDto) &&
    Array.isArray(value.ingredients) &&
    value.ingredients.every(isCatalogFacetOptionDto) &&
    Array.isArray(value.healthGoals) &&
    value.healthGoals.every(isCatalogBilingualFacetOptionDto) &&
    Array.isArray(value.dosageForms) &&
    value.dosageForms.every(isCatalogDosageFormFacetDto) &&
    Array.isArray(value.dietary) &&
    value.dietary.every(isCatalogDietaryFacetDto)
  )
}

async function requestCatalogJson(path: string, signal?: AbortSignal): Promise<unknown> {
  const base = getApiBaseUrl()
  if (!base.ok) {
    throw new CatalogApiError('MISSING_CONFIG', 'The catalogue API is not configured.')
  }

  let response: Response
  try {
    response = await fetch(`${base.value}${path}`, { signal })
  } catch (error) {
    // An aborted fetch rejects because `signal` was aborted — propagate
    // it unchanged so callers can tell "cancelled" from "failed".
    // `signal?.aborted` answers that directly and realm-independently,
    // unlike `error instanceof Error && error.name === 'AbortError'`,
    // which depends on whatever `DOMException` happens to inherit from
    // in the caller's environment (jsdom's does not extend `Error`; real
    // browsers' and Node's do — correction #3).
    if (signal?.aborted) throw error
    throw new CatalogApiError('NETWORK_ERROR', 'The catalogue API could not be reached.')
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new CatalogApiError('INVALID_RESPONSE_SHAPE', 'The catalogue API returned a response that was not valid JSON.', {
      status: response.status,
    })
  }

  if (!response.ok) {
    if (isCatalogApiErrorBody(body)) {
      throw new CatalogApiError(body.error.code, body.error.message, { status: response.status, fields: body.error.fields })
    }
    throw new CatalogApiError('HTTP_ERROR', `The catalogue API request failed with status ${response.status}.`, {
      status: response.status,
    })
  }

  return body
}

// MILESTONE-005 Checkpoint H — query params carry the full §4 filter/sort/
// page contract (built by buildCatalogSearchParams). An empty/undefined
// `params` produces a bare `/api/products` request, matching Checkpoint A's
// original no-params call. The full envelope (page/totalItems/totalPages/
// fallback) is returned, not just `items` — the data layer needs all of it
// for §5a canonicalization and §6b fallback presentation.
export async function fetchCatalogProducts(
  params?: URLSearchParams,
  signal?: AbortSignal,
): Promise<CatalogProductsEnvelope> {
  const query = params?.toString()
  const path = query ? `/api/products?${query}` : '/api/products'
  const body = await requestCatalogJson(path, signal)
  if (!isCatalogProductsEnvelope(body)) {
    throw new CatalogApiError('INVALID_RESPONSE_SHAPE', 'The catalogue API returned a products response with an unexpected shape.')
  }
  return body
}

function isProductDetailDto(value: unknown): value is ProductDetailDto {
  // 🔴 The shared half is validated by the SAME predicate the list uses, so
  // a shape change can never be accepted here and rejected there (§7's
  // "reuse, not a parallel definition", enforced at the validator too).
  if (!isCatalogProductDto(value)) return false
  const dto = value as unknown as Record<string, unknown>
  return (
    typeof dto.serialNumber === 'string' &&
    dto.serialNumber.length > 0 &&
    typeof dto.usageInstructions === 'string' &&
    Array.isArray(dto.images) &&
    dto.images.every((image) => typeof image === 'string') &&
    typeof dto.descriptionHe === 'string' &&
    typeof dto.descriptionEn === 'string' &&
    typeof dto.warningsAllergens === 'string' &&
    // DEC-032 DECISION B. Validated strictly: a missing flag REJECTS the
    // response rather than defaulting to false, because false is exactly the
    // value that renders allergen text as though it were complete.
    typeof dto.allergenInfoIncomplete === 'boolean' &&
    Array.isArray(dto.ingredients) &&
    dto.ingredients.every(
      (ingredient) =>
        isPlainObject(ingredient) &&
        typeof ingredient.name === 'string' &&
        typeof ingredient.amount === 'string' &&
        typeof ingredient.unit === 'string',
    ) &&
    Array.isArray(dto.healthGoals) &&
    dto.healthGoals.every(
      (goal) => isPlainObject(goal) && typeof goal.nameHe === 'string' && typeof goal.nameEn === 'string',
    ) &&
    (dto.targetAudience === null || typeof dto.targetAudience === 'string') &&
    typeof dto.createdAt === 'string'
  )
}

/**
 * MILESTONE-005 Checkpoint J — §7's `GET /api/products/:slug`.
 *
 * The slug is percent-encoded before it reaches the path: a slug is a stable
 * business key (DEC-033), but it arrives here from a URL segment, and this
 * function must not be the place a malformed one turns into a different
 * request path.
 *
 * A missing product surfaces as a `CatalogApiError` with code
 * `PRODUCT_NOT_FOUND` and status 404 — exactly what the server sends, and
 * identical for an absent and an inactive product (§7). Distinguishing
 * "not found" from "failed" is the CALLER's job, from that code.
 */
export async function fetchProductDetail(slug: string, signal?: AbortSignal): Promise<ProductDetailDto> {
  const body = await requestCatalogJson(`/api/products/${encodeURIComponent(slug)}`, signal)
  if (!isProductDetailDto(body)) {
    throw new CatalogApiError('INVALID_RESPONSE_SHAPE', 'The catalogue API returned a product detail with an unexpected shape.')
  }
  return body
}

/**
 * MILESTONE-005 Checkpoint I — §9d facet options for the filter UI. Accepts
 * no query parameters (the server 400s on any), so this takes no params.
 * The response carries no counts by contract; nothing here invents any.
 */
export async function fetchCatalogFacets(signal?: AbortSignal): Promise<CatalogFacetsDto> {
  const body = await requestCatalogJson('/api/catalog/facets', signal)
  if (!isCatalogFacetsDto(body)) {
    throw new CatalogApiError('INVALID_RESPONSE_SHAPE', 'The catalogue API returned a facets response with an unexpected shape.')
  }
  return body
}

export async function fetchCatalogCategories(signal?: AbortSignal): Promise<CatalogCategoryDto[]> {
  const body = await requestCatalogJson('/api/categories', signal)
  if (!isCatalogCategoriesEnvelope(body)) {
    throw new CatalogApiError('INVALID_RESPONSE_SHAPE', 'The catalogue API returned a categories response with an unexpected shape.')
  }
  return body.items
}
