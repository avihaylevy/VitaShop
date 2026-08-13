import { describe, expect, it } from 'vitest'
// 🔴 `?raw` — Vite's own text import, the same build-time mechanism
// `i18n/resources.test.ts` already relies on. Deliberately NOT `node:fs`:
// the client tsconfig carries no Node types, and adding `@types/node` to buy
// one test a file read is a dependency change, which stops for the user.
// It is also the stronger form — if the server file is ever moved or renamed,
// this import fails to resolve and the suite says so, rather than reading
// nothing and comparing against it.
import serverTransitionsSource from '../../../server/src/lib/orderTransitions.ts?raw'
import ordersHe from '../locales/he/orders.json'
import ordersEn from '../locales/en/orders.json'
import {
  ORDER_STATUS_NAMES,
  isOrderStatusName,
  orderStatusLabelKey,
  type OrderStatusName,
} from './orderStatus'

/**
 * MILESTONE-008 Checkpoint F0 — the six status labels, and the two ways they
 * can rot: a key that no locale file defines, and a client list that has
 * drifted from the server's enum.
 */

/** Resolves a dotted key against a locale tree, or `undefined`. */
function resolve(tree: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, segment) => {
    if (node === null || typeof node !== 'object') return undefined
    return (node as Record<string, unknown>)[segment]
  }, tree)
}

describe('orderStatusLabelKey — every status resolves in BOTH locales', () => {
  // ⚠️ NOT `Object.keys(ordersHe.status)`. Iterating the file to check the
  // file is the shape of test this milestone produced six times: deleting a
  // label would delete its own assertion and stay green. The list under test
  // is the status set, and the locale file is what is checked against it.
  it.each(ORDER_STATUS_NAMES)('%s has a key, and a non-empty value in he and en', (status) => {
    const key = orderStatusLabelKey(status)
    expect(key).not.toBeNull()

    const he = resolve(ordersHe, key!)
    const en = resolve(ordersEn, key!)

    expect(typeof he).toBe('string')
    expect(typeof en).toBe('string')
    expect((he as string).trim()).not.toBe('')
    expect((en as string).trim()).not.toBe('')
  })

  it('maps the six to six DISTINCT keys — no two statuses share a label', () => {
    const keys = ORDER_STATUS_NAMES.map((status) => orderStatusLabelKey(status))
    expect(new Set(keys).size).toBe(ORDER_STATUS_NAMES.length)
  })

  it('carries §4.5.7 verbatim for the five the specification names', () => {
    // The specification's own Hebrew. `pending_payment` is deliberately absent
    // here — §4.5.7 gives it no label, DEC-050 recorded that gap, and F0
    // decides it. It is asserted separately below so the two are never
    // confused for each other.
    const spec: Partial<Record<OrderStatusName, string>> = {
      paid: 'התקבלה',
      processing: 'בליקוט',
      shipped: 'נשלחה',
      delivered: 'סופקה',
      cancelled: 'בוטלה',
    }

    for (const [status, label] of Object.entries(spec)) {
      expect(resolve(ordersHe, orderStatusLabelKey(status)!)).toBe(label)
    }
  })

  it('gives pending_payment the label F0 decided, which the specification does not name', () => {
    expect(resolve(ordersHe, orderStatusLabelKey('pending_payment')!)).toBe('ממתינה לתשלום')
    expect(resolve(ordersEn, orderStatusLabelKey('pending_payment')!)).toBe('Awaiting payment')
  })
})

describe('orderStatusLabelKey — anything else', () => {
  it('returns null for an unknown status rather than echoing it', () => {
    expect(orderStatusLabelKey('refunded')).toBeNull()
    expect(orderStatusLabelKey('')).toBeNull()
    expect(orderStatusLabelKey('PAID')).toBeNull()
  })

  it('rejects the camelCase KEY spelling — the wire value is snake_case', () => {
    // A caller passing `pendingPayment` has taken the key for the status.
    expect(orderStatusLabelKey('pendingPayment')).toBeNull()
  })

  it('isOrderStatusName narrows only for the six', () => {
    expect(isOrderStatusName('paid')).toBe(true)
    expect(isOrderStatusName('refunded')).toBe(false)
    expect(isOrderStatusName(null)).toBe(false)
    expect(isOrderStatusName(7)).toBe(false)
  })
})

/**
 * 🔴 THE DRIFT GUARD. The client cannot import from `server/`, so the list in
 * `orderStatus.ts` is a copy — and a copy nobody compares is a copy that
 * diverges. This reads the server's own `ORDER_STATUSES` off disk.
 */
describe('the client status list against the server enum', () => {
  function serverStatuses(): string[] {
    const block = /export const ORDER_STATUSES = \[([\s\S]*?)\] as const/.exec(
      serverTransitionsSource,
    )
    if (block === null) return []
    return [...block[1]!.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]!)
  }

  // 🔴 ANTI-VACUOUS, AND IT IS THE POINT. A regex that stops matching — the
  // server renames the constant, reformats the array, moves the file — would
  // return [] and make the comparison below pass against nothing. This
  // milestone shipped two false all-clears from exactly that. Six is asserted
  // as a literal, not as `ORDER_STATUS_NAMES.length`, so a client list that
  // lost an entry cannot lower the bar it is being measured against.
  it('finds a non-empty list of exactly six in the server source', () => {
    const found = serverStatuses()
    expect(found.length).toBe(6)
  })

  it('agrees with the server, in the same order', () => {
    expect(serverStatuses()).toEqual([...ORDER_STATUS_NAMES])
  })
})
