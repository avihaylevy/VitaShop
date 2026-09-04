export type ApiBaseUrlResult = { ok: true; value: string } | { ok: false; reason: 'missing-config' }

/**
 * Request-time lookup, never a module-load throw — the app must be able to
 * mount with no VITE_API_BASE_URL configured (CatalogPage renders its own
 * translated error state instead). The env var name itself is never part of
 * a thrown message here; only the caller decides what, if anything, a user sees.
 */
/**
 * DEC-116 (2026-09-04): in production the API is served from the SAME
 * origin as the app (Express serves the built client), so there is no
 * absolute address to bake in at build time. The sentinel `same-origin`
 * resolves to an empty base, and every call site's `${base}/api/...`
 * becomes a relative `/api/...`.
 */
export const SAME_ORIGIN = 'same-origin'

export function getApiBaseUrl(): ApiBaseUrlResult {
  const value = import.meta.env.VITE_API_BASE_URL
  if (!value) {
    return { ok: false, reason: 'missing-config' }
  }
  if (value === SAME_ORIGIN) {
    return { ok: true, value: '' }
  }
  return { ok: true, value }
}
