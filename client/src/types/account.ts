/**
 * MILESTONE-008 Checkpoint F2b — REQ-F-041's pre-filled details, as the
 * browser sees them.
 *
 * Mirrors `GET /api/account/profile`. 🔴 NO EMAIL FIELD, and its absence is
 * deliberate on both sides: checkout does not need it, the confirmation goes
 * to the address on the account chosen server-side, and the endpoint's own
 * tests assert it never travels.
 *
 * ⚠️ `defaultAddress` IS ALWAYS NULL TODAY. No application code writes an
 * `Address` row — checkout freezes the address onto the order as free text and
 * never saves it to the shopper (ISSUE-093). The field is modelled because the
 * endpoint returns it and F2c is where it starts being populated; until then
 * the pre-fill delivers a name and a phone.
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
