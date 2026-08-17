/**
 * MILESTONE-008 Checkpoint F2b — REQ-F-041's pre-filled details, as the
 * browser sees them.
 *
 * Mirrors `GET /api/account/profile`. 🔴 NO EMAIL FIELD, and its absence is
 * deliberate on both sides: checkout does not need it, the confirmation goes
 * to the address on the account chosen server-side, and the endpoint's own
 * tests assert it never travels.
 *
 * ⚠️ `defaultAddress` is LEGACY since M-009: the checkout picker reads the
 * address BOOK (GET /api/account/addresses) instead. The field survives
 * because the endpoint still returns it and tests pin it — retiring a
 * response field is its own decision. (Its old comment claimed no code
 * writes Address rows; false since F2c, corrected 2026-08-16.)
 */
export type ShopperAddress = {
  line1: string
  city: string
  zipCode: string | null
}

export type ShopperProfile = {
  firstName: string
  lastName: string
  phone: string | null
  defaultAddress: ShopperAddress | null
}

/**
 * 🔴 A PROFILE THAT FAILS TO LOAD MUST NOT BLOCK CHECKOUT. It is a
 * convenience: the shopper can type the same details themselves. The only
 * outcome the screen acts on differently is `unauthenticated`, which means the
 * session went away and nothing below it can succeed either.
 */
export type ShopperProfileResult =
  | { ok: true; profile: ShopperProfile }
  | { ok: false; failure: 'unauthenticated' | 'unavailable' }

/**
 * MILESTONE-012 Checkpoint B — the caller's own club state, as
 * `GET/POST /api/account/club` report it. `clubJoinedAt` is an ISO string
 * or null; the page renders state, never derives a discount (§3.4 — the
 * discounted figures arrive in the cart/checkout DTOs).
 */
export type ClubStatus = {
  isClubMember: boolean
  clubJoinedAt: string | null
}

export type ClubStatusResult =
  | { ok: true; status: ClubStatus }
  | { ok: false; failure: 'unauthenticated' | 'unavailable' }

/*
 * MILESTONE-009 / DEC-090 — the address book + the profile edit.
 */

/** A managed row — ShopperAddress plus identity and the default flag. */
export type ManagedAddress = ShopperAddress & {
  id: string
  isDefault: boolean
}

export type AddressBook = {
  addresses: ManagedAddress[]
  /** The server's cap (DEC-090 O5) — rendered, never re-derived. */
  cap: number
}

export type AddressBookResult =
  | { ok: true; book: AddressBook }
  | { ok: false; failure: 'unauthenticated' | 'unavailable' }

export type AddressWriteResult =
  | { ok: true; address: ManagedAddress }
  | { ok: false; failure: 'unauthenticated' | 'unavailable' | 'gone' | 'capReached' }
  | { ok: false; failure: 'invalid'; codes: string[] }

export type AddressActionResult =
  | { ok: true }
  | { ok: false; failure: 'unauthenticated' | 'unavailable' | 'gone' }

export type ProfileWriteResult =
  | { ok: true; profile: Pick<ShopperProfile, 'firstName' | 'lastName' | 'phone'> }
  | { ok: false; failure: 'unauthenticated' | 'unavailable' }
  | { ok: false; failure: 'invalid'; codes: string[] }
