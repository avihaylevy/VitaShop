import { describe, expect, it } from 'vitest'
import { DELIVERY_METHODS } from './shipping.js'
import { deliveryEstimate, type DeliveryEstimate } from './deliveryEstimate.js'

describe('DEC-059 answer 5 — the delivery estimate is STATIC, never computed', () => {
  it('self pickup is READY WITHIN 2 business days — not a range', () => {
    // 🔴 The wording in DEC-059 answer 5 is "ready within 2 business days", and
    // the shape follows it. Forcing this into a range would make the client
    // render "0–2 business days", which is a sentence nobody decided.
    expect(deliveryEstimate('self_pickup')).toEqual({
      kind: 'ready_within',
      businessDays: 2,
    } satisfies DeliveryEstimate)
  })

  it('courier is DELIVERED BETWEEN 3 and 5 business days', () => {
    expect(deliveryEstimate('courier')).toEqual({
      kind: 'delivered_between',
      minBusinessDays: 3,
      maxBusinessDays: 5,
    } satisfies DeliveryEstimate)
  })

  it('🔴 a pickup point is a DELIVERY, so it carries the courier range', () => {
    // The same split `shipping.ts` makes: only SELF pickup is collection. Goods
    // are transported to a locker or a shop, so the estimate is about a
    // delivery arriving, not about an order being ready to collect.
    expect(deliveryEstimate('pickup_point')).toEqual(deliveryEstimate('courier'))
  })

  it('🔴 every method REQ-F-040 defines has an estimate — no method falls through', () => {
    // ⚠️ Not a restatement of the three tests above. Those name three methods
    // this test does not: it walks `DELIVERY_METHODS` itself, so adding a fourth
    // method without an estimate fails HERE rather than shipping a checkout
    // screen with a blank delivery promise.
    for (const method of DELIVERY_METHODS) {
      expect(deliveryEstimate(method)).toBeDefined()
    }
  })

  it('🔴 the estimate is a VALUE, not a sentence — no language is baked in', () => {
    // The email is Hebrew-only (DEC-054 / A11-SERVER) and the UI is bilingual.
    // A module returning "3–5 ימי עסקים" would force one of the two to
    // re-derive the numbers, which is the drift `purchasability.ts` exists to
    // make unrepresentable.
    for (const method of DELIVERY_METHODS) {
      expect(JSON.stringify(deliveryEstimate(method))).not.toMatch(/[֐-׿]/)
    }
  })

  it('⚠️ the returned object cannot be mutated by a caller', () => {
    // These are shared constants. A caller that adjusted one would change the
    // promise every later checkout makes, with nothing to point at.
    const estimate = deliveryEstimate('courier')
    expect(() => {
      // @ts-expect-error — deliberately violating the readonly contract
      estimate.maxBusinessDays = 99
    }).toThrow()
    expect(deliveryEstimate('courier')).toEqual({
      kind: 'delivered_between',
      minBusinessDays: 3,
      maxBusinessDays: 5,
    })
  })
})
