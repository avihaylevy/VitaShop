/**
 * MILESTONE-008 Checkpoint F2c — INV-05's client half.
 *
 * 🔴 THE KEY IS WHAT MAKES A RETRY SAFE. The server answers `/checkout/pay`
 * from the stored order when it sees a key it has already used, which is the
 * only reason a dropped connection is recoverable rather than a second charge.
 * A key regenerated per attempt turns one order into two.
 *
 * ⚠️ `crypto.randomUUID` IS NOT ALWAYS THERE, and this is not hypothetical for
 * this project: it is undefined on an INSECURE ORIGIN, and this app is served
 * over plain HTTP on a LAN address in development — exactly where a shopper
 * would be testing. `orderService`'s own header names that trigger, and the
 * defect it produced was a blank key reaching the server, which then matched
 * every LATER checkout by the same shopper against the first order.
 *
 * The fallback is not cryptographically strong and does not need to be: this
 * value is a per-attempt de-duplication token scoped to one user, never a
 * secret and never an identifier anyone else can act on.
 */
export function newIdempotencyKey(): string {
  const uuid = globalThis.crypto?.randomUUID
  if (typeof uuid === 'function') return globalThis.crypto.randomUUID()

  const random = () => Math.random().toString(36).slice(2, 12)
  return `k-${Date.now().toString(36)}-${random()}${random()}`
}
