/**
 * MILESTONE-008 Checkpoint E1 — §8.9's order status table, as data.
 *
 * 🔴 THE TABLE IS THE CONTRACT, AND THE DEFAULT IS REJECTION. §8.9 states it
 * plainly: *"every transition not in this table is rejected, server-side, and
 * the rejection is the default rather than the exception. A table read as
 * 'these are allowed, everything else is a judgement call' is not a state
 * machine."* This module is data plus a lookup, so there is no branch anywhere
 * that can quietly permit a move nobody wrote down.
 *
 * 🔴 PURE — NO DATABASE, NO PRISMA, NO IO. Applying a transition (atomically,
 * with the history row and the stock restoration) is Checkpoint E2's. Keeping
 * the RULE separate from the WRITE is what lets all 108 combinations be checked
 * exhaustively in milliseconds; a rule that needs a database gets tested by
 * example, and by example is how a state machine acquires holes.
 *
 * ⚠️ IT ABSORBS `lib/orderPaid.ts`'s RULE, and E2 will absorb its write. That
 * module was written narrow in Checkpoint D3 precisely so this could happen by
 * DELETION rather than by two implementations agreeing — the failure
 * `purchasability.ts` exists to make unrepresentable.
 *
 * 🔴 NO STATUS IS INVENTED. The six values are quoted from `OrderStatus` in
 * `schema.prisma`; adding one is a schema change and a stop-and-ask. ⚠️
 * REQ-F-046 (§4.5.7) lists only FIVE Hebrew labels — `pending_payment` has
 * none, because the specification did not anticipate a pre-payment state. That
 * is recorded as the spec being less granular, not as a contradiction, and the
 * LABEL is Checkpoint F's decision (confirmed with the user 2026-08-13). This
 * module deals in enum values and renders nothing.
 */

/** The six, quoted from `schema.prisma`. Order is display order, not a rank. */
export const ORDER_STATUSES = [
  'pending_payment',
  'paid',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
] as const

export type OrderStatusName = (typeof ORDER_STATUSES)[number]

/**
 * Who is asking.
 *
 * 🔴 `system` IS NOT A SUPER-USER. It is the actor with no human behind it —
 * the simulated payment — and §8.9 gives it exactly one move. Null in
 * `OrderStatusHistory.changedByUserId` means precisely this, and the schema
 * note is explicit that null is not "unknown". A `system` that could make moves
 * an admin cannot would turn that column into a way to launder an action.
 */
export const ORDER_ACTORS = ['system', 'shopper', 'admin'] as const

export type OrderActor = (typeof ORDER_ACTORS)[number]

/**
 * 🔴 TERMINAL MEANS TERMINAL. §8.9: *"Terminal states: delivered and cancelled.
 * Nothing leaves either."* Reported separately from an unknown move because the
 * two need different answers — a terminal order is finished, an unknown move is
 * a mistake.
 */
const TERMINAL: readonly OrderStatusName[] = ['delivered', 'cancelled']

export type OrderTransition = {
  from: OrderStatusName
  to: OrderStatusName
  /** Every actor §8.9's row names. Anyone else is refused. */
  actors: readonly OrderActor[]
  /**
   * 🔴 DEC-059 answer 4 — stock is restored in the SAME atomic transaction,
   * "because not restoring it loses inventory silently". Carried as data here
   * so E2's write reads the rule rather than re-deciding it.
   */
  restoresStock: boolean
}

/** §8.9's table, in its own order. Seven rows; there is no eighth. */
export const ORDER_TRANSITIONS: readonly OrderTransition[] = [
  { from: 'pending_payment', to: 'paid', actors: ['system'], restoresStock: false },
  { from: 'pending_payment', to: 'cancelled', actors: ['shopper', 'admin'], restoresStock: true },
  { from: 'paid', to: 'processing', actors: ['admin'], restoresStock: false },
  { from: 'paid', to: 'cancelled', actors: ['shopper', 'admin'], restoresStock: true },
  { from: 'processing', to: 'shipped', actors: ['admin'], restoresStock: false },
  // 🔴 ADMIN ONLY, and it is the table's single asymmetry. The user's rule is
  // that a shopper may cancel until the order is handed to fulfilment, and
  // fulfilment begins at `processing`.
  { from: 'processing', to: 'cancelled', actors: ['admin'], restoresStock: true },
  { from: 'shipped', to: 'delivered', actors: ['admin'], restoresStock: false },
  // 🔴 `shipped -> cancelled` IS DELIBERATELY ABSENT. Once goods are dispatched
  // the operation is a RETURN — a different flow with different stock, money
  // and status implications. Nothing in the specification asks for returns, and
  // inventing one inside a transition table is how scope arrives unannounced.
] as const

/**
 * MILESTONE-008 Checkpoint F3 — every move an ADMIN may make from a status,
 * derived from the table above rather than listed again.
 *
 * 🔴 THE ADMIN ORDERS PAGE NEEDS THIS, AND IT MUST NOT OWN A COPY OF §8.9.
 * The page renders one button per legal move; the alternative is the browser
 * holding its own copy of the transition table, which is the drift that
 * `purchasability.ts` exists to make unrepresentable — and which this
 * milestone already paid for once, when the client's hand-written
 * unpurchasable-reason list disagreed with the server's and blanked the
 * blocked-order screen.
 *
 * ⚠️ `adminOrders.ts`'s `ADMIN_TARGETS` answers a DIFFERENT question — which
 * targets an admin may ever ask for, regardless of the order. This answers
 * which are legal FROM a given status. The route still checks both: this list
 * is what a UI should offer, never a substitute for the guard.
 */
export function adminTransitionsFrom(from: OrderStatusName): readonly OrderStatusName[] {
  return ORDER_TRANSITIONS.filter(
    (row) => row.from === from && row.actors.includes('admin'),
  ).map((row) => row.to)
}

/**
 * The user's twelfth list (2026-08-21) — a shopper may not cancel an order
 * whose delivery window has long passed. Their example: a 3–5 business-day
 * order cannot be cancelled after 10 days, because the goods are presumed
 * received. Ten days (measured as elapsed time, 240h) from placement, for
 * every method — the one number the user named, kept as a single constant.
 *
 * ⚠️ AMENDING THE WINDOW IS A ONE-LINE CHANGE *HERE AND ONLY HERE*. The
 * client renders the server-computed `cancellable` flag on the order
 * summary (routes/orders.ts) and holds NO copy of this number — the drift
 * the hundred-second pass review caught before it shipped.
 *
 * 🔴 PAID ORDERS ONLY. "Goods presumed received" is a claim about an order
 * that was going to ship; a `pending_payment` order never shipped and never
 * will, and refusing its cancellation would strand the shopper's only exit
 * from an abandoned checkout — with its reserved stock locked forever
 * (found in the same review). The service applies this predicate only to
 * `paid -> cancelled` by the shopper; admin rows are untouched.
 *
 * 🔴 PURE, like the table above: the caller supplies both instants.
 */
export const SHOPPER_CANCEL_WINDOW_DAYS = 10

export function shopperCancelWindowClosed(createdAt: Date, now: Date): boolean {
  const windowMs = SHOPPER_CANCEL_WINDOW_DAYS * 24 * 60 * 60 * 1000
  return now.getTime() - createdAt.getTime() > windowMs
}

export type TransitionRejection =
  /** The order is finished. Nothing leaves `delivered` or `cancelled`. */
  | 'TERMINAL'
  /** No actor may make this move — it is not in the table at all. */
  | 'NOT_A_TRANSITION'
  /** A real transition, asked for by someone not entitled to make it. */
  | 'FORBIDDEN_FOR_ACTOR'

/**
 * `null` when the move is permitted.
 *
 * 🔴 THE THREE REJECTIONS ARE DISTINCT BECAUSE THE ANSWERS ARE. A route maps
 * `FORBIDDEN_FOR_ACTOR` to 403 and the others to 409, and a shopper told "not
 * yours to do" can ask someone who may — where "impossible" ends the
 * conversation. Collapsing them into one boolean throws that away at the only
 * place that knows the difference.
 */
export function transitionProblem(
  from: OrderStatusName,
  to: OrderStatusName,
  actor: OrderActor,
): TransitionRejection | null {
  // 🔴 CHECKED FIRST, so a terminal order is never reported as a permission
  // problem. Telling an admin they lack permission to un-deliver an order sends
  // them to find someone who can, and nobody can.
  if (TERMINAL.includes(from)) return 'TERMINAL'

  const row = ORDER_TRANSITIONS.find((t) => t.from === from && t.to === to)
  if (!row) return 'NOT_A_TRANSITION'
  if (!row.actors.includes(actor)) return 'FORBIDDEN_FOR_ACTOR'
  return null
}

/**
 * Whether this move puts the reserved units back on the shelf.
 *
 * ⚠️ IT ANSWERS FOR THE MOVE, NOT FOR THE CALLER'S RIGHT TO MAKE IT. A move
 * that is not in the table restores nothing — `shipped -> cancelled` reports
 * false, so a caller reading this before checking legality cannot restore stock
 * for goods that have already left.
 */
export function restoresStock(from: OrderStatusName, to: OrderStatusName): boolean {
  return ORDER_TRANSITIONS.find((t) => t.from === from && t.to === to)?.restoresStock ?? false
}
