import { getApiBaseUrl } from './apiBaseUrl.js'
import type { ShopperAddress, ShopperProfile, ShopperProfileResult } from '../types/account.js'

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
