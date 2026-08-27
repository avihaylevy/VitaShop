import { describe, expect, it } from 'vitest'
import estimateSource from '../../../server/src/lib/deliveryEstimate.ts?raw'
import he from './he/checkout.json'
import en from './en/checkout.json'

/**
 * Area 4 (DEC-110.3) review finding — the delivery method cards carry
 * STATIC estimate copy (`delivery.estCourier` etc.) restating the
 * SERVER's frozen ESTIMATES constants (deliveryEstimate.ts). Six copies
 * (2 locales × 3 methods) and nothing else ties them together: bump a
 * server range and the cards keep promising the old one while the
 * receipt's live estimate (from the quote) shows the new — the screen
 * contradicts itself silently. This suite pins each locale string to the
 * server SOURCE, the same technique checkoutApi.test.ts uses for the
 * method list.
 */

function serverRange(): { min: string; max: string } | null {
  const min = /minBusinessDays:\s*(\d+)/.exec(estimateSource)
  const max = /maxBusinessDays:\s*(\d+)/.exec(estimateSource)
  return min && max ? { min: min[1]!, max: max[1]! } : null
}

function serverReadyWithin(): string | null {
  const days = /businessDays:\s*(\d+)/.exec(estimateSource)
  return days ? days[1]! : null
}

describe('the method cards’ static estimate copy against the server source', () => {
  it('anti-vacuous: the server source still declares both estimate shapes', () => {
    // A regex that stopped matching would make the string checks below
    // compare against nothing.
    expect(serverRange()).not.toBeNull()
    expect(serverReadyWithin()).not.toBeNull()
  })

  it('courier and pickup_point carry the delivered-between range, both locales', () => {
    const range = serverRange()!
    for (const locale of [he, en]) {
      for (const key of ['estCourier', 'estPickupPoint'] as const) {
        const copy = locale.delivery[key]
        expect(copy).toContain(range.min)
        expect(copy).toContain(range.max)
      }
    }
  })

  it('self_pickup carries the ready-within day count, both locales', () => {
    const days = serverReadyWithin()!
    expect(he.delivery.estSelfPickup).toContain(days)
    expect(en.delivery.estSelfPickup).toContain(days)
  })
})
