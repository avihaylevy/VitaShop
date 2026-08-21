import { describe, expect, it } from 'vitest'
import {
  adminTransitionsFrom,
  ORDER_STATUSES,
  ORDER_ACTORS,
  transitionProblem,
  restoresStock,
  type OrderActor,
  type OrderStatusName,
  SHOPPER_CANCEL_WINDOW_DAYS,
  shopperCancelWindowClosed,
} from './orderTransitions.js'

/**
 * MILESTONE-008 Checkpoint E1 — §8.9's table, and nothing else.
 *
 * 🔴 §8.9's OWN RULE IS THAT THE DEFAULT IS REJECTION: *"every transition not in
 * this table is rejected, server-side, and the rejection is the default rather
 * than the exception. A table read as 'these are allowed, everything else is a
 * judgement call' is not a state machine."*
 *
 * ⚠️ SO THE CENTRAL TEST HERE IS EXHAUSTIVE, not a list of examples. Six
 * statuses × six statuses × three actors is 108 combinations; naming the seven
 * that are allowed proves nothing about the hundred and one that are not, and
 * the hundred and one are the whole point.
 */

/** §8.9's table, transcribed here INDEPENDENTLY of the module under test. */
const ALLOWED: readonly { from: OrderStatusName; to: OrderStatusName; actors: OrderActor[] }[] = [
  { from: 'pending_payment', to: 'paid', actors: ['system'] },
  { from: 'pending_payment', to: 'cancelled', actors: ['shopper', 'admin'] },
  { from: 'paid', to: 'processing', actors: ['admin'] },
  { from: 'paid', to: 'cancelled', actors: ['shopper', 'admin'] },
  { from: 'processing', to: 'shipped', actors: ['admin'] },
  // 🔴 ADMIN ONLY — the one asymmetry in the table. Fulfilment begins at
  // `processing`, and the user's rule is that a shopper may cancel until the
  // order is handed to fulfilment.
  { from: 'processing', to: 'cancelled', actors: ['admin'] },
  { from: 'shipped', to: 'delivered', actors: ['admin'] },
]

function isAllowed(from: OrderStatusName, to: OrderStatusName, actor: OrderActor): boolean {
  return ALLOWED.some((row) => row.from === from && row.to === to && row.actors.includes(actor))
}

describe('🔴 THE DEFAULT IS REJECTION — all 108 combinations, not seven examples', () => {
  it('permits exactly §8.9’s table and refuses everything else', () => {
    const wronglyAllowed: string[] = []
    const wronglyRefused: string[] = []

    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        for (const actor of ORDER_ACTORS) {
          const permitted = transitionProblem(from, to, actor) === null
          const shouldBe = isAllowed(from, to, actor)
          if (permitted && !shouldBe) wronglyAllowed.push(`${actor}: ${from} -> ${to}`)
          if (!permitted && shouldBe) wronglyRefused.push(`${actor}: ${from} -> ${to}`)
        }
      }
    }

    expect(wronglyAllowed).toEqual([])
    expect(wronglyRefused).toEqual([])
  })

  it('⚠️ the sweep really covers 108 combinations — the control on the loop', () => {
    // A loop over an empty or truncated list would report perfect agreement
    // above while checking nothing. This is the same all-pass shape the
    // browser-verification rules record.
    expect(ORDER_STATUSES).toHaveLength(6)
    expect(ORDER_ACTORS).toHaveLength(3)
    expect(ORDER_STATUSES.length * ORDER_STATUSES.length * ORDER_ACTORS.length).toBe(108)
    // And the table it is compared against is the seven rows §8.9 lists.
    expect(ALLOWED).toHaveLength(7)
  })
})

describe('the rejections say WHY, because the reasons need different answers', () => {
  it('a TERMINAL state refuses everything, and says so', () => {
    // "Terminal states: delivered and cancelled. Nothing leaves either."
    for (const terminal of ['delivered', 'cancelled'] as const) {
      for (const to of ORDER_STATUSES) {
        for (const actor of ORDER_ACTORS) {
          expect(transitionProblem(terminal, to, actor), `${terminal} -> ${to}`).toBe('TERMINAL')
        }
      }
    }
  })

  it('🔴 a move the table does not contain is NOT_A_TRANSITION', () => {
    // Skipping fulfilment entirely — a plausible mistake, and it must not be
    // reported as a permission problem, because no actor can do it.
    expect(transitionProblem('paid', 'shipped', 'admin')).toBe('NOT_A_TRANSITION')
    expect(transitionProblem('pending_payment', 'processing', 'admin')).toBe('NOT_A_TRANSITION')
    // 🔴 `shipped -> cancelled` is DELIBERATELY ABSENT: once goods are
    // dispatched the operation is a RETURN, a different flow with different
    // stock and money implications. Nothing in the spec asks for returns.
    expect(transitionProblem('shipped', 'cancelled', 'admin')).toBe('NOT_A_TRANSITION')
  })

  it('🔴 a real transition the WRONG ACTOR asked for is FORBIDDEN_FOR_ACTOR', () => {
    // The distinction is what lets a route answer 403 rather than 409 — and
    // tells the shopper "not yours to do" rather than "impossible".
    expect(transitionProblem('paid', 'processing', 'shopper')).toBe('FORBIDDEN_FOR_ACTOR')
    expect(transitionProblem('processing', 'cancelled', 'shopper')).toBe('FORBIDDEN_FOR_ACTOR')
    expect(transitionProblem('pending_payment', 'paid', 'admin')).toBe('FORBIDDEN_FOR_ACTOR')
  })

  it('a status cannot transition to ITSELF', () => {
    for (const status of ORDER_STATUSES) {
      for (const actor of ORDER_ACTORS) {
        expect(transitionProblem(status, status, actor)).not.toBeNull()
      }
    }
  })
})

describe('🔴 WHERE THE SHOPPER’S POWER STOPS — the rule behind the asymmetry', () => {
  it('a shopper may cancel from pending_payment and paid, and nowhere else', () => {
    expect(transitionProblem('pending_payment', 'cancelled', 'shopper')).toBeNull()
    expect(transitionProblem('paid', 'cancelled', 'shopper')).toBeNull()
    // Fulfilment has begun.
    expect(transitionProblem('processing', 'cancelled', 'shopper')).toBe('FORBIDDEN_FOR_ACTOR')
    expect(transitionProblem('shipped', 'cancelled', 'shopper')).toBe('NOT_A_TRANSITION')
  })

  it('🔴 the SYSTEM can do exactly ONE thing — take a payment', () => {
    // Null actor means SYSTEM in `OrderStatusHistory`, and it must not become a
    // skeleton key for transitions no human is allowed to make.
    const systemCan: string[] = []
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        if (transitionProblem(from, to, 'system') === null) systemCan.push(`${from} -> ${to}`)
      }
    }
    expect(systemCan).toEqual(['pending_payment -> paid'])
  })
})

describe('🔴 WHICH TRANSITIONS RESTORE STOCK — INV-01 in reverse', () => {
  it('every cancellation restores it, and nothing else does', () => {
    // DEC-059 answer 4: stock is restored in the same atomic transaction,
    // "because not restoring it loses inventory silently".
    const restoring: string[] = []
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        if (restoresStock(from, to)) restoring.push(`${from} -> ${to}`)
      }
    }
    expect(restoring.sort()).toEqual([
      'paid -> cancelled',
      'pending_payment -> cancelled',
      'processing -> cancelled',
    ])
  })

  it('⚠️ it never claims a restore for a move that is not even legal', () => {
    // `shipped -> cancelled` is absent from the table. If this reported true,
    // a future caller reading it before checking legality would restore stock
    // for goods that are already out of the door.
    expect(restoresStock('shipped', 'cancelled')).toBe(false)
    expect(restoresStock('delivered', 'cancelled')).toBe(false)
  })
})

/**
 * MILESTONE-008 Checkpoint F3 — what the admin screen is allowed to OFFER.
 *
 * 🔴 DERIVED FROM §8.9's TABLE, NEVER LISTED AGAIN. The screen renders one
 * button per legal move; the alternative is the browser holding its own copy
 * of the table, which is the drift that blanked the blocked-order screen
 * earlier in this milestone.
 */
describe('adminTransitionsFrom', () => {
  it('gives a PAID order the two moves an admin has', () => {
    expect([...adminTransitionsFrom('paid')].sort()).toEqual(['cancelled', 'processing'])
  })

  it('gives a PROCESSING order shipped and cancelled', () => {
    expect([...adminTransitionsFrom('processing')].sort()).toEqual(['cancelled', 'shipped'])
  })

  it('🔴 gives a SHIPPED order only `delivered` — there is no cancel after dispatch', () => {
    // The table's deliberate omission: once goods are dispatched the operation
    // is a RETURN, a flow nothing in the specification asks for.
    expect(adminTransitionsFrom('shipped')).toEqual(['delivered'])
  })

  it('gives a PENDING_PAYMENT order only `cancelled` — `paid` belongs to the SYSTEM', () => {
    expect(adminTransitionsFrom('pending_payment')).toEqual(['cancelled'])
  })

  it.each(['delivered', 'cancelled'] as const)('gives a TERMINAL %s order nothing', (status) => {
    expect(adminTransitionsFrom(status)).toEqual([])
  })

  it('🔴 never offers a move the ADMIN ROUTE would refuse', () => {
    // `ADMIN_TARGETS` in adminOrders.ts is narrower than the enum on purpose:
    // `paid` and `pending_payment` are the system's and the shopper's. A list
    // that offered either would render a button that always 403s.
    for (const status of ORDER_STATUSES) {
      for (const target of adminTransitionsFrom(status)) {
        expect(['processing', 'shipped', 'delivered', 'cancelled']).toContain(target)
      }
    }
  })
})

describe("🔴 the user's twelfth list — the shopper's 10-day cancel window", () => {
  const DAY = 24 * 60 * 60 * 1000
  const placed = new Date('2026-08-01T12:00:00.000Z')

  it('is 10 calendar days, the one number the user named', () => {
    expect(SHOPPER_CANCEL_WINDOW_DAYS).toBe(10)
  })

  it('⚠️ THE CONTROL — inside the window the cancel is still open', () => {
    expect(shopperCancelWindowClosed(placed, new Date(placed.getTime() + 9 * DAY))).toBe(false)
  })

  it('exactly 10 days is still OPEN — the refusal begins past it', () => {
    expect(shopperCancelWindowClosed(placed, new Date(placed.getTime() + 10 * DAY))).toBe(false)
  })

  it('🔴 one millisecond past 10 days is CLOSED', () => {
    expect(shopperCancelWindowClosed(placed, new Date(placed.getTime() + 10 * DAY + 1))).toBe(true)
  })

  it("eleven days — the user's own example — is closed", () => {
    expect(shopperCancelWindowClosed(placed, new Date(placed.getTime() + 11 * DAY))).toBe(true)
  })
})
