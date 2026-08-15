import { getApiBaseUrl } from './apiBaseUrl.js'
import { isCatalogProductDto, isPlainObject } from './catalogApi.js'
import type { CatalogProductDto } from '../types/catalog.js'

/**
 * ISSUE-115 / REQ-F-034 — the favourites transport.
 *
 * 🔴 VALIDATED, NOT CAST, like every transport here. The items ride the
 * catalogue's own card DTO (the server maps them with the same function the
 * catalogue uses), validated by the SAME predicate the catalogue uses —
 * reuse, not a parallel definition (review of this diff: the local 5-field
 * copy accepted payloads the catalogue rejected).
 *
 * 🔴 401 IS A RESULT, NOT AN ERROR: a guest pressing a heart is an expected
 * path (A10 gates the ACTION), and the caller sends them to /login.
 */

export type FavouritesListResult =
  | { ok: true; items: CatalogProductDto[] }
  | { ok: false; reason: 'unauthenticated' | 'failed' | 'aborted' }

export type FavouriteWriteResult = 'ok' | 'unauthenticated' | 'not-found' | 'failed'

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
    if (!isPlainObject(body) || !Array.isArray(body.items) || !body.items.every(isCatalogProductDto)) {
      return { ok: false, reason: 'failed' }
    }
    return { ok: true, items: body.items }
  } catch {
    // An abort is a RESULT, not an exception to rethrow: both callers run
    // under `void`/fire-and-forget, so a rethrown AbortError became an
    // unhandled rejection on every StrictMode mount and on navigation away
    // mid-load (review of ab8e374). Callers treat 'aborted' as a no-op.
    if (signal?.aborted) return { ok: false, reason: 'aborted' }
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
