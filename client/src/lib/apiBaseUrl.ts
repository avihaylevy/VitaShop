export type ApiBaseUrlResult = { ok: true; value: string } | { ok: false; reason: 'missing-config' }

/**
 * Request-time lookup, never a module-load throw — the app must be able to
 * mount with no VITE_API_BASE_URL configured (CatalogPage renders its own
 * translated error state instead). The env var name itself is never part of
 * a thrown message here; only the caller decides what, if anything, a user sees.
 */
export function getApiBaseUrl(): ApiBaseUrlResult {
  const value = import.meta.env.VITE_API_BASE_URL
  if (!value) {
    return { ok: false, reason: 'missing-config' }
  }
  return { ok: true, value }
}
