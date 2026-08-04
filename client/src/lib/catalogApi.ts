import { getApiBaseUrl } from './apiBaseUrl.js'
import type {
  CatalogApiErrorBody,
  CatalogCategoriesEnvelope,
  CatalogCategoryDto,
  CatalogProductDto,
  CatalogProductsEnvelope,
  DosageFormKey,
} from '../types/catalog.js'

const DOSAGE_FORM_KEYS: readonly DosageFormKey[] = ['CAPSULE', 'TABLET', 'DROPS', 'POWDER', 'SYRUP']

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCatalogApiErrorBody(value: unknown): value is CatalogApiErrorBody {
  if (!isPlainObject(value) || !isPlainObject(value.error)) return false
  const { code, message, fields } = value.error
  if (typeof code !== 'string' || typeof message !== 'string') return false
  if (fields !== undefined && (!Array.isArray(fields) || !fields.every((f) => typeof f === 'string'))) return false
  return true
}

function isCatalogProductDto(value: unknown): value is CatalogProductDto {
  if (!isPlainObject(value)) return false
  return (
    typeof value.slug === 'string' &&
    typeof value.nameHe === 'string' &&
    typeof value.nameEn === 'string' &&
    typeof value.categoryNameHe === 'string' &&
    typeof value.categoryNameEn === 'string' &&
    typeof value.categorySlug === 'string' &&
    typeof value.brandName === 'string' &&
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

function isCatalogProductsEnvelope(value: unknown): value is CatalogProductsEnvelope {
  if (!isPlainObject(value)) return false
  return (
    Array.isArray(value.items) &&
    value.items.every(isCatalogProductDto) &&
    typeof value.page === 'number' &&
    typeof value.pageSize === 'number' &&
    typeof value.totalItems === 'number' &&
    typeof value.totalPages === 'number'
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

async function requestCatalogJson(path: string, signal?: AbortSignal): Promise<unknown> {
  const base = getApiBaseUrl()
  if (!base.ok) {
    throw new CatalogApiError('MISSING_CONFIG', 'The catalogue API is not configured.')
  }

  let response: Response
  try {
    response = await fetch(`${base.value}${path}`, { signal })
  } catch (error) {
    // An aborted fetch rejects with a DOMException/Error named "AbortError" —
    // propagate it unchanged so callers can tell "cancelled" from "failed".
    if (error instanceof Error && error.name === 'AbortError') throw error
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

// No query parameters are ever sent — the server currently supports none
// (Slice 6 Checkpoint A). ?category=<slug> filtering happens client-side.
export async function fetchCatalogProducts(signal?: AbortSignal): Promise<CatalogProductDto[]> {
  const body = await requestCatalogJson('/api/products', signal)
  if (!isCatalogProductsEnvelope(body)) {
    throw new CatalogApiError('INVALID_RESPONSE_SHAPE', 'The catalogue API returned a products response with an unexpected shape.')
  }
  return body.items
}

export async function fetchCatalogCategories(signal?: AbortSignal): Promise<CatalogCategoryDto[]> {
  const body = await requestCatalogJson('/api/categories', signal)
  if (!isCatalogCategoriesEnvelope(body)) {
    throw new CatalogApiError('INVALID_RESPONSE_SHAPE', 'The catalogue API returned a categories response with an unexpected shape.')
  }
  return body.items
}
