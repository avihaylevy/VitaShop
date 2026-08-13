/**
 * MILESTONE-008 Checkpoint F0 — REQ-F-046's six order statuses, and the ONE
 * place a wire status becomes a translation key.
 *
 * 🔴 WHY THIS IS ITS OWN SLICE. Three screens render these labels: the
 * checkout confirmation (F2), the admin orders page (F3) and, later, the
 * shopper's order history (Checkpoint G). Deciding the wording inside
 * whichever screen happened to ship first would leave the others to copy it,
 * and a copied label drifts.
 *
 * ⚠️ §4.5.7 NAMES FIVE LABELS FOR SIX STATUSES. `pending_payment` has none —
 * DEC-050 recorded that gap explicitly as "the specification being less
 * granular, not a contradiction", and left the display meaning to the UI.
 * The other five are the specification's own Hebrew, verbatim.
 *
 * 🔴 THE KEYS ARE camelCase ON PURPOSE. i18next reads a trailing `_suffix` as
 * a plural category, so a key named `status.pending_payment` would be parsed
 * as base `status.pending` in category `payment` — and the locale-integrity
 * validator would then judge it against the categories Hebrew actually
 * resolves. The wire value keeps its snake_case; only the key differs.
 */

/**
 * The six values `OrderStatus` carries in `schema.prisma`, in the order the
 * status machine moves through them (§8.9), with the two terminal states last.
 *
 * 🔴 THIS LIST IS MIRRORED FROM THE SERVER, NOT IMPORTED — the client cannot
 * import from `server/`. `orderStatus.test.ts` reads the server's own
 * `ORDER_STATUSES` off disk and fails if the two ever disagree.
 */
export const ORDER_STATUS_NAMES = [
  'pending_payment',
  'paid',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
] as const

export type OrderStatusName = (typeof ORDER_STATUS_NAMES)[number]

/** The `orders` namespace key each status renders through. */
const STATUS_LABEL_KEYS: Record<OrderStatusName, string> = {
  pending_payment: 'status.pendingPayment',
  paid: 'status.paid',
  processing: 'status.processing',
  shipped: 'status.shipped',
  delivered: 'status.delivered',
  cancelled: 'status.cancelled',
}

export function isOrderStatusName(value: unknown): value is OrderStatusName {
  return typeof value === 'string' && (ORDER_STATUS_NAMES as readonly string[]).includes(value)
}

/**
 * The translation key for a status, or `null` for anything else.
 *
 * 🔴 RETURNS `null` RATHER THAN THROWING, AND RATHER THAN ECHOING THE INPUT.
 * A status this build does not know is a server that moved ahead of the
 * client; rendering the raw `pending_payment` to a shopper is worse than
 * rendering nothing, and throwing would take a whole order list down over one
 * unrecognised row. The caller decides what an unknown status looks like.
 */
export function orderStatusLabelKey(status: string): string | null {
  return isOrderStatusName(status) ? STATUS_LABEL_KEYS[status] : null
}
