import { getApiBaseUrl } from './apiBaseUrl.js'

/**
 * MILESTONE-006 Checkpoint H — the client's auth transport.
 *
 * 🔴 H2 — THIS MODULE MUST NOT REINTRODUCE THE ORACLES THE SERVER CLOSED.
 * A1 and A3 are undone by a helpful client as easily as by a helpful API:
 *   · never ask the server whether an address exists
 *   · never derive "unknown email" vs "wrong password" from a response
 *   · never expose which rate limit fired
 * The server returns one failure for all of them, and this layer passes it
 * through unchanged rather than trying to enrich it.
 */

export type AuthFailure =
  /** The server's single credential failure (A1) — no reason available. */
  | { kind: 'failed' }
  /** 429. H3 renders the server's message; no countdown, no which-limit. */
  | { kind: 'rateLimited' }
  /** Field-level validation, safe to surface: it is about the input. */
  | { kind: 'invalid'; codes: string[]; fields: string[] }
  | { kind: 'network' }
  | { kind: 'unexpected' }

export type AuthResult<T> = { ok: true; value: T } | { ok: false; failure: AuthFailure }

async function post<T>(path: string, body: unknown): Promise<AuthResult<T>> {
  const base = getApiBaseUrl()
  if (!base) return { ok: false, failure: { kind: 'unexpected' } }

  let response: Response
  try {
    response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // 🔴 The session cookie is HttpOnly and cross-origin in development.
      // Without this it is neither sent nor stored, and every authenticated
      // request silently behaves as a guest.
      credentials: 'include',
      body: JSON.stringify(body),
    })
  } catch {
    return { ok: false, failure: { kind: 'network' } }
  }

  return interpret<T>(response)
}

async function interpret<T>(response: Response): Promise<AuthResult<T>> {
  if (response.status === 429) return { ok: false, failure: { kind: 'rateLimited' } }

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (response.ok) return { ok: true, value: payload as T }

  const error = (payload as { error?: { code?: unknown; codes?: unknown; fields?: unknown } } | null)
    ?.error

  // 🔴 The ONLY failure this layer expands is field validation, which is about
  // what the user typed and discloses nothing about who is registered.
  if (
    error &&
    (error.code === 'REGISTRATION_INVALID' || error.code === 'PASSWORD_INVALID')
  ) {
    const codes = Array.isArray(error.codes) ? error.codes.filter((c): c is string => typeof c === 'string') : []
    const fields = Array.isArray(error.fields) ? error.fields.filter((f): f is string => typeof f === 'string') : []
    return { ok: false, failure: { kind: 'invalid', codes, fields } }
  }

  // Everything else collapses to one opaque failure — including 401 (A1) and
  // the reset route's 400 (A4/A3), which the UI must not tell apart.
  return { ok: false, failure: { kind: 'failed' } }
}

export interface RegistrationPayload {
  firstName: string
  lastName: string
  email: string
  password: string
  confirmPassword: string
  phone: string
  acceptedTerms: boolean
}

export function register(payload: RegistrationPayload) {
  return post<{ status: string }>('/api/auth/register', payload)
}

export function login(email: string, password: string) {
  return post<{ status: string }>('/api/auth/login', { email, password })
}

export function logout() {
  return post<{ status: string }>('/api/auth/logout', {})
}

export function requestPasswordReset(email: string) {
  return post<{ status: string }>('/api/auth/password-reset', { email })
}

export function completePasswordReset(token: string, password: string) {
  return post<{ status: string }>('/api/auth/password-reset/complete', { token, password })
}

/** GET, because verification is a link the user follows from an email. */
export async function verifyEmail(token: string): Promise<AuthResult<{ status: string }>> {
  const base = getApiBaseUrl()
  if (!base) return { ok: false, failure: { kind: 'unexpected' } }

  try {
    const response = await fetch(
      `${base}/api/auth/verify-email?token=${encodeURIComponent(token)}`,
      { credentials: 'include' },
    )
    return interpret<{ status: string }>(response)
  } catch {
    return { ok: false, failure: { kind: 'network' } }
  }
}

/**
 * Checkpoint H's gate depends on this. It returns a boolean and nothing else —
 * see the route's own comment for why it discloses nothing.
 */
export async function fetchSession(): Promise<boolean> {
  const base = getApiBaseUrl()
  if (!base) return false
  try {
    const response = await fetch(`${base}/api/auth/session`, { credentials: 'include' })
    if (!response.ok) return false
    const payload = (await response.json()) as { authenticated?: unknown }
    return payload.authenticated === true
  } catch {
    return false
  }
}
