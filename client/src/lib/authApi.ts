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
  // 🔴 `getApiBaseUrl()` returns a RESULT OBJECT, not a string. This used to
  // read `if (!base)` — always false, an object is truthy — and then
  // interpolate the object, so every auth request was sent to
  // `[object Object]/api/auth/...`. Found at MILESTONE-007 Checkpoint G while
  // wiring the cart; see ISSUE-072. The same silent shape as ISSUE-069: the
  // code compiled, the tests passed, and nothing ever crossed the boundary.
  const base = getApiBaseUrl()
  if (!base.ok) return { ok: false, failure: { kind: 'unexpected' } }

  let response: Response
  try {
    response = await fetch(`${base.value}${path}`, {
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
  /** The seventh list, item 1 / DEC-086 — the register-form club opt-in. */
  joinClub: boolean
}

export function register(payload: RegistrationPayload) {
  return post<{ status: string }>('/api/auth/register', payload)
}

/**
 * 🔴 The login response carries a CART REPORT — `merged`, `clampedSlugs`,
 * `dropped` and `mergeFailed`, produced at the MERGE-GUEST-CART seam. It is
 * typed here rather than discarded: the server produces it precisely so the UI
 * can say what happened to a guest cart at login, and a client that drops it
 * re-creates the silent loss MILESTONE-007 removed.
 *
 * ⚠️ There is deliberately NO registration equivalent. Registration answers an
 * identical body whether or not the account already existed (DEC-053 clause 4b);
 * a cart report there would re-open the enumeration oracle ISSUE-067 closed.
 */
export function login(email: string, password: string) {
  return post<{ status: string; cart?: unknown }>('/api/auth/login', { email, password })
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
  if (!base.ok) return { ok: false, failure: { kind: 'unexpected' } }

  try {
    const response = await fetch(
      `${base.value}/api/auth/verify-email?token=${encodeURIComponent(token)}`,
      { credentials: 'include' },
    )
    return interpret<{ status: string }>(response)
  } catch {
    return { ok: false, failure: { kind: 'network' } }
  }
}

/**
 * Checkpoint H's gate depends on this.
 *
 * 🔴 DEC-071 — IT NOW CARRIES THE ROLE for a signed-in caller, so the account
 * menu can show an admin link (ISSUE-097). It grants NOTHING: every admin route
 * re-reads `User.role` from the database on each request (DEC-065), so this is
 * advisory and a client that lies about it gains no access.
 *
 * ⚠️ AN UNKNOWN ROLE IS NOT AN ADMIN. Anything other than the two known values
 * — a future role, a malformed body, a missing key — reads as `null`, which
 * hides the link. The safe direction is the one that shows less.
 */
export type SessionRole = 'admin' | 'customer'

/**
 * ISSUE-089 — `firstName`/`email` are the signed-in caller's OWN identity,
 * rendered so a page finally says who is signed in. Either may be null: the
 * server omits both on its fail-closed branch, and a malformed value reads
 * as absent rather than rendering garbage in the header.
 */
export type SessionSnapshot = {
  authenticated: boolean
  role: SessionRole | null
  firstName: string | null
  email: string | null
}

const ANONYMOUS: SessionSnapshot = { authenticated: false, role: null, firstName: null, email: null }

export async function fetchSession(): Promise<SessionSnapshot> {
  const base = getApiBaseUrl()
  if (!base.ok) return ANONYMOUS
  try {
    const response = await fetch(`${base.value}/api/auth/session`, { credentials: 'include' })
    if (!response.ok) return ANONYMOUS
    const payload = (await response.json()) as {
      authenticated?: unknown
      role?: unknown
      firstName?: unknown
      email?: unknown
    }
    if (payload.authenticated !== true) return ANONYMOUS
    const role = payload.role === 'admin' || payload.role === 'customer' ? payload.role : null
    const firstName =
      typeof payload.firstName === 'string' && payload.firstName.trim() !== '' ? payload.firstName : null
    const email = typeof payload.email === 'string' && payload.email.trim() !== '' ? payload.email : null
    return { authenticated: true, role, firstName, email }
  } catch {
    return ANONYMOUS
  }
}
