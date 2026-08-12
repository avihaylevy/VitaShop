import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  completePasswordReset,
  fetchSession,
  login,
  logout,
  register,
  requestPasswordReset,
  verifyEmail,
} from './authApi.js'

const BASE_URL = 'http://localhost:3000'

function mockResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', BASE_URL)
  fetchMock = vi.fn().mockResolvedValue(mockResponse(200, { status: 'ok', authenticated: true }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

/**
 * 🔴 ISSUE-072 — THE REGRESSION TEST. MILESTONE-007 Checkpoint H.
 *
 * `getApiBaseUrl()` returns a RESULT OBJECT — `{ ok: true, value }`. This
 * module treated it as a string from the day it was written (`4bb8fde`):
 *
 *   const base = getApiBaseUrl()
 *   if (!base) return ...                  // an object is ALWAYS truthy
 *   await fetch(`${base}${path}`)          // "[object Object]/api/auth/login"
 *
 * Every auth request — login, registration, logout, both password-reset
 * routes, email verification and the session probe — went to a relative path
 * beginning `[object Object]`. Authentication could not work in a browser.
 *
 * 🔴 NEITHER HALF IS A TYPE ERROR: TypeScript permits an object in a template
 * literal, and `!someObject` is legal. `tsc`, `oxlint` and every existing auth
 * test passed for six days.
 *
 * ⚠️ THESE ASSERT THE REQUEST URL, not that the call resolves. A test that
 * only checked "the function returned a result" would have passed throughout
 * the defect's entire life — `fetch` to a bad relative URL still returns a
 * `Response`, and `interpret()` still produces an `AuthResult`. The URL is the
 * only place the defect is visible.
 */

/** Every auth entry point, with the exact path it must request. */
const ROUTES: ReadonlyArray<[name: string, call: () => Promise<unknown>, path: string]> = [
  ['login', () => login('a@b.test', 'pw'), '/api/auth/login'],
  [
    'register',
    () =>
      register({
        firstName: 'A',
        lastName: 'B',
        email: 'a@b.test',
        password: 'pw',
        confirmPassword: 'pw',
        phone: '0501234567',
        acceptedTerms: true,
      }),
    '/api/auth/register',
  ],
  ['logout', () => logout(), '/api/auth/logout'],
  ['requestPasswordReset', () => requestPasswordReset('a@b.test'), '/api/auth/password-reset'],
  [
    'completePasswordReset',
    () => completePasswordReset('tok', 'pw'),
    '/api/auth/password-reset/complete',
  ],
  ['verifyEmail', () => verifyEmail('tok'), '/api/auth/verify-email?token=tok'],
  ['fetchSession', () => fetchSession(), '/api/auth/session'],
]

describe('🔴 ISSUE-072 — every auth request goes to the configured base URL', () => {
  it.each(ROUTES)('%s requests the real origin, not "[object Object]"', async (_name, call, path) => {
    await call()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = String(fetchMock.mock.calls[0][0])

    // The assertion that fails under the defect, stated first and plainly.
    expect(url).toBe(`${BASE_URL}${path}`)
    // And the defect's signature, pinned separately so a future rewrite that
    // breaks the URL differently still trips something named.
    expect(url).not.toContain('[object Object]')
    expect(url.startsWith('http://')).toBe(true)
  })

  it('🔴 all seven agree — no single caller may re-derive the base URL its own way', async () => {
    const origins = new Set<string>()
    for (const [, call] of ROUTES) {
      fetchMock.mockClear()
      await call()
      origins.add(new URL(String(fetchMock.mock.calls[0][0])).origin)
    }
    // Two callers of one helper disagreeing is how this defect existed at all:
    // `catalogApi.ts` used `base.value` correctly while `authApi.ts` did not.
    expect([...origins]).toEqual([BASE_URL])
  })
})

describe('🔴 a MISSING base URL must fail, not request a wrong one', () => {
  it.each(ROUTES)('%s issues NO request when VITE_API_BASE_URL is absent', async (_name, call) => {
    vi.stubEnv('VITE_API_BASE_URL', '')

    const result = await call()

    // 🔴 The guard that never fired. `if (!base)` on a result object is always
    // false, so the module fell through to fetching a malformed URL instead of
    // reporting a configuration failure.
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result).not.toBeUndefined()
  })

  it('the failure is reported as a result, never thrown', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '')
    expect(await login('a@b.test', 'pw')).toEqual({ ok: false, failure: { kind: 'unexpected' } })
    // fetchSession answers a plain boolean by contract — it discloses nothing.
    expect(await fetchSession()).toBe(false)
  })
})

describe('the session cookie — unchanged by the fix, and asserted so it stays', () => {
  it.each(ROUTES)('%s sends credentials: include', async (_name, call) => {
    await call()
    const init = fetchMock.mock.calls[0][1] as RequestInit
    // Without this the HttpOnly session cookie is neither sent nor stored and
    // every authenticated request silently behaves as a guest.
    expect(init.credentials).toBe('include')
  })
})
