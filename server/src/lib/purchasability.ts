/**
 * 🔴 ONE RULE FOR "CAN THIS LINE BE BOUGHT", AND ONE PLACE FOR IT.
 *
 * DEC-059 answer 3 made not-purchasable a single condition. It was then
 * implemented TWICE — once in `cartService` for the shipping basis and the
 * blocking flag, once in `orderService` as checkout's pre-check — held together
 * by nothing but a comment saying they must agree.
 *
 * ⚠️ THEY DRIFTED TWICE, and both times the same defect came out:
 *
 *   1. the cart tested `isActive` only, so a SOLD-OUT line still bought free
 *      shipping and did not block checkout (ISSUE-076)
 *   2. the cart then tested `stockQuantity > 0`, while checkout needed
 *      `>= quantity` — so a cart of 3 against a stock of 1 still promised free
 *      shipping and checkout still refused it
 *
 * Each time the shopper removed the line the cart told them to remove and the
 * shipping price went UP — the reversal `shipping.ts`'s header says must never
 * happen. Each time the fix was to copy the new rule into the other file.
 *
 * 🔴 A comment cannot hold two implementations in agreement. This module makes
 * the agreement MECHANICAL: both callers ask the same function, so a third
 * drift is not something to remember to avoid — it is unrepresentable.
 */

/** Why a line cannot be bought. Three causes, because the shopper's move differs. */
export type UnpurchasableReason = 'WITHDRAWN' | 'SOLD_OUT' | 'SHORT_STOCK'

export type PurchasabilityInput = {
  quantity: number
  isActive: boolean
  stockQuantity: number
}

/**
 * `null` when the line can be bought as it stands.
 *
 * 🔴 The three causes are distinct because the RIGHT NEXT ACTION differs:
 * withdrawn is gone for good (remove it), sold out may return (remove it, or
 * wait), and short stock means some are there — so the move is to ask for
 * fewer, and calling that "sold out" hides the only action that works.
 */
export function unpurchasableReason(line: PurchasabilityInput): UnpurchasableReason | null {
  if (!line.isActive) return 'WITHDRAWN'
  if (line.stockQuantity <= 0) return 'SOLD_OUT'
  if (line.stockQuantity < line.quantity) return 'SHORT_STOCK'
  return null
}

/** The same rule, as a predicate — for filtering the shipping basis. */
export function isPurchasable(line: PurchasabilityInput): boolean {
  return unpurchasableReason(line) === null
}

/**
 * How many of this product the shopper could still buy.
 *
 * 🔴 ZERO unless the cause is SHORT_STOCK. `available` exists so a client can
 * say "there are N — ask for fewer", and that sentence is only true for short
 * stock. A withdrawn product with 10 units still on the shelf reports 0, because
 * offering the shopper those 10 sends them to the one action that cannot work.
 */
export function availableToBuy(line: PurchasabilityInput): number {
  return unpurchasableReason(line) === 'SHORT_STOCK' ? Math.max(line.stockQuantity, 0) : 0
}
