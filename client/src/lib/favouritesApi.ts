import { getApiBaseUrl } from './apiBaseUrl.js'
import type { CatalogProductDto } from '../types/catalog.js'

/**
 * ISSUE-115 / REQ-F-034 — the favourites transport.
 *
 * 🔴 VALIDATED, NOT CAST, like every transport here. The items ride the
 * catalogue's own card DTO (the server maps them with the same function the
 * catalogue uses), so the checks below assert that shared shape's
 * load-bearing fields rather than restating the whole contract.
 *
 * 🔴 401 IS A RESULT, NOT AN ERROR: a guest pressing a heart is an expected
 * path (A10 gates the ACTION), and the caller sends them to /login.
 */

export type FavouritesListResult =
  | { ok: true; items: CatalogProductDto[] }
  | { ok: false; reason: 'unauthenticated' | 'failed' }

export type FavouriteWriteResult = 'ok' | 'unauthenticated' | 'not-found' | 'failed'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCardDto(value: unknown): value is CatalogProductDto {
  if (!isPlainObject(value)) return false
  return (
    typeof value.slug === 'string' &&
    typeof value.nameHe === 'string' &&
    typeof value.nameEn === 'string' &&
    typeof value.price === 'string' &&
    typeof value.stockQuantity === 'number'
  )
}

export async function fetchFavourites(signal?: AbortSignal): Promise<FavouritesListResult> {
  const base = getApiBaseUrl()
  if (!base.ok) return { ok: false, reason: 'failed' }
  try {
    const response = await fetch(`${base.value}/api/account/favourites`, {
      credentials: 'include',
      signal,
    })
    if (response.status === 401) return { ok: false, reason: 'unauthenticated' }
    if (!response.ok) return { ok: false, reason: 'failed' }
    const body = (await response.json()) as unknown
    if (!isPlainObject(body) || !Array.isArray(body.items) || !body.items.every(isCardDto)) {
      return { ok: false, reason: 'failed' }
    }
    return { ok: true, items: body.items }
  } catch (error) {
    if (signal?.aborted) throw error
    return { ok: false, reason: 'failed' }
  }
}

async function writeFavourite(slug: string, method: 'PUT' | 'DELETE'): Promise<FavouriteWriteResult> {
  const base = getApiBaseUrl()
  if (!base.ok) return 'failed'
  try {
    const response = await fetch(`${base.value}/api/account/favourites/${encodeURIComponent(slug)}`, {
      method,
      credentials: 'include',
    })
    if (response.status === 401) return 'unauthenticated'
    if (response.status === 404) return 'not-found'
    if (!response.ok) return 'failed'
    return 'ok'
  } catch {
    return 'failed'
  }
}

export const addFavourite = (slug: string): Promise<FavouriteWriteResult> => writeFavourite(slug, 'PUT')
export const removeFavourite = (slug: string): Promise<FavouriteWriteResult> => writeFavourite(slug, 'DELETE')
