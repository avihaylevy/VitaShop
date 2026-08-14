import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requestShopperProfile } from './accountApi'

/**
 * MILESTONE-008 Checkpoint F2b — the profile transport.
 *
 * 🔴 THE THEME IS THAT A MISSING PROFILE MUST NOT BLOCK CHECKOUT. It is a
 * convenience; the shopper can type the same details. Only `unauthenticated`
 * is different, because nothing below it can succeed either.
 */

function respond(status: number, body: unknown) {
  return vi.fn(async () => ({ status, json: async () => body }) as unknown as Response)
}

const PROFILE = {
  firstName: 'Alice',
  lastName: 'Account',
  phone: '050-1111111',
  defaultAddress: { line1: 'רחוב אליס 1', city: 'תל אביב', zipCode: '6100000' },
}

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('requestShopperProfile', () => {
  it('returns the profile and sends the session cookie', async () => {
    const fetchMock = respond(200, PROFILE)
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestShopperProfile()
    expect(result).toEqual({ ok: true, profile: PROFILE })

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    // The endpoint identifies the shopper by session and by nothing else —
    // there is no id to pass, deliberately.
    expect(init.credentials).toBe('include')
  })

  it('401 is `unauthenticated` — the only failure the screen acts on', async () => {
    vi.stubGlobal('fetch', respond(401, { error: { code: 'AUTHENTICATION_REQUIRED' } }))
    expect(await requestShopperProfile()).toEqual({ ok: false, failure: 'unauthenticated' })
  })

  it('503 is `unavailable`, so checkout continues with empty fields', async () => {
    vi.stubGlobal('fetch', respond(503, { error: { code: 'PROFILE_UNAVAILABLE' } }))
    expect(await requestShopperProfile()).toEqual({ ok: false, failure: 'unavailable' })
  })

  it('a thrown fetch is `unavailable` too', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network')
      }),
    )
    expect(await requestShopperProfile()).toEqual({ ok: false, failure: 'unavailable' })
  })
})

describe('what counts as an address to pre-fill', () => {
  it('null stays null — nothing on file', async () => {
    vi.stubGlobal('fetch', respond(200, { ...PROFILE, defaultAddress: null }))
    const result = await requestShopperProfile()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.profile.defaultAddress).toBeNull()
    // 🔴 The name and phone still arrive. That IS the pre-fill today, since
    // nothing writes an Address row yet (ISSUE-093).
    expect(result.profile.firstName).toBe('Alice')
    expect(result.profile.phone).toBe('050-1111111')
  })

  it('🔴 a HALF-BUILT address is treated as nothing on file, not as a filled form', async () => {
    // A form that looks pre-filled and is not is worse than an empty one: the
    // shopper skims it and submits someone else's city with no street.
    vi.stubGlobal('fetch', respond(200, { ...PROFILE, defaultAddress: { city: 'תל אביב' } }))
    const result = await requestShopperProfile()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.profile.defaultAddress).toBeNull()
  })

  it('a missing zip is null, not the string "undefined"', async () => {
    vi.stubGlobal(
      'fetch',
      respond(200, { ...PROFILE, defaultAddress: { line1: 'רחוב 1', city: 'חיפה' } }),
    )
    const result = await requestShopperProfile()
    if (!result.ok) return
    expect(result.profile.defaultAddress?.zipCode).toBeNull()
  })

  it('a body missing the NAME is unusable — validated, not cast', async () => {
    vi.stubGlobal('fetch', respond(200, { phone: '050', defaultAddress: null }))
    expect(await requestShopperProfile()).toEqual({ ok: false, failure: 'unavailable' })
  })

  it('🔴 THE CONTROL — the sound body still passes', async () => {
    // Four rejections above; a validator that rejected everything would
    // satisfy all of them and leave the form permanently empty.
    vi.stubGlobal('fetch', respond(200, PROFILE))
    expect((await requestShopperProfile()).ok).toBe(true)
  })
})
