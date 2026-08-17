import { getApiBaseUrl } from './apiBaseUrl.js'
import type {
  AddressActionResult,
  AddressBookResult,
  AddressWriteResult,
  ManagedAddress,
  ProfileWriteResult,
  ClubStatus,
  ClubStatusResult,
  ShopperAddress,
  ShopperProfile,
  ShopperProfileResult,
} from '../types/account.js'

/**
 * MILESTONE-008 Checkpoint F2b — the profile transport.
 *
 * 🔴 `credentials: 'include'`: the endpoint identifies the shopper by session
 * and by nothing else — there is no id to pass, deliberately, because a route
 * that accepts one is one missing check from serving any customer's address to
 * anyone.
 *
 * 🔴 VALIDATED, NOT CAST, like every other transport here. A malformed profile
 * would otherwise reach the form as `undefined` values and silently produce
 * empty inputs that look pre-filled.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readAddress(value: unknown): ShopperAddress | null {
  /*
   * 🔴 `null` AND A MALFORMED OBJECT COLLAPSE TO THE SAME ANSWER, and that is
   * correct here: the form must distinguish "an address to pre-fill" from
   * "nothing to pre-fill", and a half-built address is the second one. The
   * server is explicit that it sends `null` rather than a blank-field object
   * for exactly this reason.
   */
  if (!isPlainObject(value)) return null
  if (typeof value.line1 !== 'string' || typeof value.city !== 'string') return null
  return {
    line1: value.line1,
    city: value.city,
    zipCode: typeof value.zipCode === 'string' ? value.zipCode : null,
  }
}

function readProfile(value: unknown): ShopperProfile | null {
  if (!isPlainObject(value)) return null
  if (typeof value.firstName !== 'string' || typeof value.lastName !== 'string') return null
  return {
    firstName: value.firstName,
    lastName: value.lastName,
    phone: typeof value.phone === 'string' ? value.phone : null,
    defaultAddress: readAddress(value.defaultAddress),
  }
}

export async function requestShopperProfile(): Promise<ShopperProfileResult> {
  const base = getApiBaseUrl()
  if (!base.ok) return { ok: false, failure: 'unavailable' }

  let status: number
  let body: unknown
  try {
    const response = await fetch(`${base.value}/api/account/profile`, {
      credentials: 'include',
    })
    status = response.status
    try {
      body = await response.json()
    } catch {
      body = null
    }
  } catch {
    return { ok: false, failure: 'unavailable' }
  }

  // 🔴 401 IS THE ONLY FAILURE THE SCREEN TREATS DIFFERENTLY. The session is
  // gone, so the quote below it cannot succeed either. Everything else —
  // 503, a malformed body, a network drop — is a missing convenience, and
  // checkout continues with empty fields the shopper can fill in.
  if (status === 401) return { ok: false, failure: 'unauthenticated' }
  if (status !== 200) return { ok: false, failure: 'unavailable' }

  const profile = readProfile(body)
  return profile ? { ok: true, profile } : { ok: false, failure: 'unavailable' }
}

/*
 * MILESTONE-012 Checkpoint B — the club transports. Same posture as the
 * profile: session-only identity, validated-not-cast, and 401 is the only
 * failure the screen treats differently.
 */

function readClubStatus(value: unknown): ClubStatus | null {
  if (!isPlainObject(value)) return null
  if (typeof value.isClubMember !== 'boolean') return null
  if (value.clubJoinedAt !== null && typeof value.clubJoinedAt !== 'string') return null
  return { isClubMember: value.isClubMember, clubJoinedAt: value.clubJoinedAt }
}

async function clubRequest(init?: RequestInit): Promise<ClubStatusResult> {
  const base = getApiBaseUrl()
  if (!base.ok) return { ok: false, failure: 'unavailable' }

  let status: number
  let body: unknown
  try {
    const response = await fetch(`${base.value}/api/account/club`, {
      credentials: 'include',
      ...init,
    })
    status = response.status
    try {
      body = await response.json()
    } catch {
      body = null
    }
  } catch {
    return { ok: false, failure: 'unavailable' }
  }

  if (status === 401) return { ok: false, failure: 'unauthenticated' }
  if (status !== 200) return { ok: false, failure: 'unavailable' }

  const clubStatus = readClubStatus(body)
  return clubStatus ? { ok: true, status: clubStatus } : { ok: false, failure: 'unavailable' }
}

export function requestClubStatus(): Promise<ClubStatusResult> {
  return clubRequest()
}

export function requestClubAction(action: 'join' | 'leave'): Promise<ClubStatusResult> {
  return clubRequest({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
  })
}

/*
 * MILESTONE-009 / DEC-090 — the profile edit + the address book transports.
 * Same posture throughout: session-only identity, validated-not-cast, 401
 * distinguished, named codes carried for the form to map.
 */

function readManagedAddress(value: unknown): ManagedAddress | null {
  if (!isPlainObject(value)) return null
  if (typeof value.id !== 'string' || value.id === '') return null
  if (typeof value.line1 !== 'string' || typeof value.city !== 'string') return null
  if (typeof value.isDefault !== 'boolean') return null
  return {
    id: value.id,
    line1: value.line1,
    city: value.city,
    zipCode: typeof value.zipCode === 'string' ? value.zipCode : null,
    isDefault: value.isDefault,
  }
}

function codesOf(body: unknown): string[] {
  if (!isPlainObject(body) || !isPlainObject(body.error)) return []
  return Array.isArray(body.error.codes)
    ? body.error.codes.filter((c): c is string => typeof c === 'string')
    : []
}

function errorCodeOf(body: unknown): string | undefined {
  if (!isPlainObject(body) || !isPlainObject(body.error)) return undefined
  return typeof body.error.code === 'string' ? body.error.code : undefined
}

async function accountCall(
  path: string,
  init?: { method: string; body?: unknown },
): Promise<{ status: number; body: unknown } | null> {
  const base = getApiBaseUrl()
  if (!base.ok) return null
  try {
    const response = await fetch(`${base.value}/api/account${path}`, {
      method: init?.method ?? 'GET',
      credentials: 'include',
      ...(init?.body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) }),
    })
    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      body = null
    }
    return { status: response.status, body }
  } catch {
    return null
  }
}

export async function patchShopperProfile(fields: {
  firstName: string
  lastName: string
  phone: string
}): Promise<ProfileWriteResult> {
  const raw = await accountCall('/profile', { method: 'PATCH', body: fields })
  if (raw === null) return { ok: false, failure: 'unavailable' }
  if (raw.status === 401) return { ok: false, failure: 'unauthenticated' }
  if (raw.status === 400) return { ok: false, failure: 'invalid', codes: codesOf(raw.body) }
  if (raw.status !== 200) return { ok: false, failure: 'unavailable' }
  const body = raw.body
  if (!isPlainObject(body) || !isPlainObject(body.profile)) {
    return { ok: false, failure: 'unavailable' }
  }
  const profile = body.profile
  if (typeof profile.firstName !== 'string' || typeof profile.lastName !== 'string') {
    return { ok: false, failure: 'unavailable' }
  }
  return {
    ok: true,
    profile: {
      firstName: profile.firstName,
      lastName: profile.lastName,
      phone: typeof profile.phone === 'string' ? profile.phone : null,
    },
  }
}

export async function requestAddressBook(): Promise<AddressBookResult> {
  const raw = await accountCall('/addresses')
  if (raw === null) return { ok: false, failure: 'unavailable' }
  if (raw.status === 401) return { ok: false, failure: 'unauthenticated' }
  if (raw.status !== 200) return { ok: false, failure: 'unavailable' }
  const body = raw.body
  if (!isPlainObject(body) || !Array.isArray(body.addresses) || typeof body.cap !== 'number') {
    return { ok: false, failure: 'unavailable' }
  }
  const addresses: ManagedAddress[] = []
  for (const entry of body.addresses) {
    const parsed = readManagedAddress(entry)
    if (!parsed) return { ok: false, failure: 'unavailable' }
    addresses.push(parsed)
  }
  return { ok: true, book: { addresses, cap: body.cap } }
}

function addressWriteResult(raw: { status: number; body: unknown } | null): AddressWriteResult {
  if (raw === null) return { ok: false, failure: 'unavailable' }
  if (raw.status === 401) return { ok: false, failure: 'unauthenticated' }
  if (raw.status === 404) return { ok: false, failure: 'gone' }
  if (raw.status === 400) {
    if (errorCodeOf(raw.body) === 'ADDRESS_CAP_REACHED') {
      return { ok: false, failure: 'capReached' }
    }
    return { ok: false, failure: 'invalid', codes: codesOf(raw.body) }
  }
  if (raw.status !== 200 && raw.status !== 201) return { ok: false, failure: 'unavailable' }
  const body = raw.body
  const address = isPlainObject(body) ? readManagedAddress(body.address) : null
  return address ? { ok: true, address } : { ok: false, failure: 'unavailable' }
}

export async function addAddress(fields: {
  line1: string
  city: string
  zipCode: string | null
}): Promise<AddressWriteResult> {
  return addressWriteResult(await accountCall('/addresses', { method: 'POST', body: fields }))
}

export async function patchAddress(
  addressId: string,
  fields: { line1: string; city: string; zipCode: string | null },
): Promise<AddressWriteResult> {
  return addressWriteResult(
    await accountCall(`/addresses/${encodeURIComponent(addressId)}`, {
      method: 'PATCH',
      body: fields,
    }),
  )
}

function actionResult(raw: { status: number; body: unknown } | null): AddressActionResult {
  if (raw === null) return { ok: false, failure: 'unavailable' }
  if (raw.status === 401) return { ok: false, failure: 'unauthenticated' }
  if (raw.status === 404) return { ok: false, failure: 'gone' }
  if (raw.status !== 200) return { ok: false, failure: 'unavailable' }
  return { ok: true }
}

export async function removeAddress(addressId: string): Promise<AddressActionResult> {
  return actionResult(
    await accountCall(`/addresses/${encodeURIComponent(addressId)}`, { method: 'DELETE' }),
  )
}

export async function makeDefaultAddress(addressId: string): Promise<AddressActionResult> {
  return actionResult(
    await accountCall(`/addresses/${encodeURIComponent(addressId)}/default`, { method: 'PUT' }),
  )
}
