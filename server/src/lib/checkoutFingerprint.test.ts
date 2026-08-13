import { describe, expect, it } from 'vitest'
import { checkoutFingerprint, type CheckoutState } from './checkoutFingerprint.js'

/**
 * REQ-F-042's gate, at its core. The user chose the server-issued token
 * (2026-08-13): `/validate` returns the figures plus a fingerprint of them, and
 * `/pay` RE-DERIVES the fingerprint from live data and refuses if it differs.
 *
 * 🔴 EVERY TEST HERE IS A DETECTION TEST, so DEC-059's mutation rule applies to
 * all of them: the fingerprint's whole job is to notice a change.
 */

const BASE: CheckoutState = {
  userId: 'user-1',
  deliveryMethod: 'courier',
  shippingCost: '30.00',
  totalAmount: '160.00',
  lines: [
    { lineId: 'line-a', productId: 'prod-a', quantity: 2, unitPrice: '50.00' },
    { lineId: 'line-b', productId: 'prod-b', quantity: 1, unitPrice: '30.00' },
  ],
}

/** BASE with one field replaced, so each test names exactly what it moved. */
function withChange(change: Partial<CheckoutState>): CheckoutState {
  return { ...BASE, ...change }
}

describe('the fingerprint is STABLE for an unchanged state', () => {
  it('the same state fingerprints identically, every time', () => {
    expect(checkoutFingerprint(BASE)).toBe(checkoutFingerprint(BASE))
  })

  it('🔴 LINE ORDER DOES NOT MATTER — the rows come back in whatever order the database likes', () => {
    // Without a canonical sort this halts a checkout where nothing changed at
    // all, which is worse than missing a change: the shopper is stopped, told
    // something moved, shown identical figures, and has no way forward.
    const reversed = withChange({ lines: [...BASE.lines].reverse() })
    expect(checkoutFingerprint(reversed)).toBe(checkoutFingerprint(BASE))
  })
})

describe('🔴 ANY change to a figure the shopper confirmed changes the fingerprint', () => {
  it('a PRICE change', () => {
    const moved = withChange({
      lines: [{ ...BASE.lines[0]!, unitPrice: '50.01' }, BASE.lines[1]!],
    })
    expect(checkoutFingerprint(moved)).not.toBe(checkoutFingerprint(BASE))
  })

  it('a QUANTITY change', () => {
    const moved = withChange({
      lines: [{ ...BASE.lines[0]!, quantity: 3 }, BASE.lines[1]!],
    })
    expect(checkoutFingerprint(moved)).not.toBe(checkoutFingerprint(BASE))
  })

  it('a REMOVED line', () => {
    expect(checkoutFingerprint(withChange({ lines: [BASE.lines[0]!] }))).not.toBe(
      checkoutFingerprint(BASE),
    )
  })

  it('an ADDED line', () => {
    const moved = withChange({
      lines: [...BASE.lines, { lineId: 'line-c', productId: 'prod-c', quantity: 1, unitPrice: '5.00' }],
    })
    expect(checkoutFingerprint(moved)).not.toBe(checkoutFingerprint(BASE))
  })

  it('a SWAPPED line of identical price and quantity', () => {
    // The swap that defeated three of Checkpoint C's cart guards, one layer up.
    // Same count, same money, different products — and the shopper would be
    // shipped something they removed.
    const moved = withChange({
      lines: [{ ...BASE.lines[0]!, lineId: 'line-z', productId: 'prod-z' }, BASE.lines[1]!],
    })
    expect(checkoutFingerprint(moved)).not.toBe(checkoutFingerprint(BASE))
  })

  it('🔴 a REMOVED-AND-RE-ADDED line — same product, same quantity, same price, NEW row', () => {
    // ⚠️ THIS TEST EXISTS BECAUSE MUTATION FOUND ITS ABSENCE. Deleting
    // `field(line.lineId)` from the digest left the swap test above GREEN,
    // because that test changes the productId too — so nothing was actually
    // proving `lineId` contributed anything. Only this case isolates it:
    // every other field is identical and the row id alone has moved.
    //
    // REQ-F-042 says HALT on any change, and this is one: the shopper emptied
    // a line and put it back while checkout was open.
    const readded = withChange({
      lines: [{ ...BASE.lines[0]!, lineId: 'line-a-readded' }, BASE.lines[1]!],
    })
    expect(checkoutFingerprint(readded)).not.toBe(checkoutFingerprint(BASE))
  })

  it('a different DELIVERY METHOD', () => {
    expect(checkoutFingerprint(withChange({ deliveryMethod: 'self_pickup' }))).not.toBe(
      checkoutFingerprint(BASE),
    )
  })

  it('a different SHIPPING COST', () => {
    expect(checkoutFingerprint(withChange({ shippingCost: '0.00' }))).not.toBe(
      checkoutFingerprint(BASE),
    )
  })

  it('a different TOTAL', () => {
    expect(checkoutFingerprint(withChange({ totalAmount: '160.01' }))).not.toBe(
      checkoutFingerprint(BASE),
    )
  })

  it('🔴 a different USER — a token is not transferable between shoppers', () => {
    expect(checkoutFingerprint(withChange({ userId: 'user-2' }))).not.toBe(
      checkoutFingerprint(BASE),
    )
  })
})

describe('🔴 FIELD BOUNDARIES CANNOT BE BLURRED — the collision a naive join creates', () => {
  it('two genuinely different states do not fingerprint the same', () => {
    // ⚠️ THE DEFECT THIS PINS. Concatenating fields without escaping lets one
    // field absorb the next: quantity 1 + price "12.00" and quantity 11 +
    // price "2.00" both flatten to "…112.00…". The states are different, the
    // money is different, and the gate would wave the second one through
    // holding the first one's confirmation.
    const a = withChange({
      lines: [{ lineId: 'l', productId: 'p', quantity: 1, unitPrice: '12.00' }],
    })
    const b = withChange({
      lines: [{ lineId: 'l', productId: 'p', quantity: 11, unitPrice: '2.00' }],
    })
    expect(checkoutFingerprint(a)).not.toBe(checkoutFingerprint(b))
  })

  it('a value containing the delimiter cannot forge a neighbouring field', () => {
    const a = withChange({
      lines: [{ lineId: 'x', productId: 'p', quantity: 1, unitPrice: '1.00' }],
    })
    const b = withChange({
      lines: [{ lineId: 'x|p|1|1.00', productId: 'p', quantity: 1, unitPrice: '1.00' }],
    })
    expect(checkoutFingerprint(a)).not.toBe(checkoutFingerprint(b))
  })
})

describe('the shape of the value itself', () => {
  it('is a lowercase hex sha-256 digest, and carries no readable state', () => {
    const fingerprint = checkoutFingerprint(BASE)
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/)
    // 🔴 It travels to the browser and back. A fingerprint that embedded the
    // figures would be a second, client-held copy of the money — the §3.4
    // violation this mechanism was chosen to avoid.
    expect(fingerprint).not.toContain('160.00')
    expect(fingerprint).not.toContain('user-1')
  })
})
