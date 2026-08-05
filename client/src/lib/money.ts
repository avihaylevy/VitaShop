/**
 * Minor-unit money handling for the client cart domain — Slice 7.
 *
 * 🔴 Prices arrive as strings (Prisma `Decimal` serialised over JSON, e.g.
 * "94.90"). This module converts them to an integer count of agorot and
 * back. It NEVER uses `Number(price)`, `parseFloat(price)`, floating-point
 * addition or floating-point multiplication on a money value — every
 * arithmetic operand here is an integer.
 *
 * 🔴 Scope constraint (CLAUDE.md rule 1 / spec §3.4 /
 * UI_IMPLEMENTATION_PLAN.md §4): the server is the source of truth for
 * price and totals. This module exists so the cart domain can hold an
 * exact value, not so the client can display a computed total. Nothing in
 * Slice 7 renders a value derived here. A future cart API supersedes it
 * for anything displayed.
 */

/**
 * A non-negative decimal with at most two fraction digits. Deliberately
 * strict: it rejects exponent notation, signs, whitespace, thousands
 * separators and over-precise fractions rather than silently reinterpreting
 * them. The 9-digit integer bound keeps `whole * 100` well inside
 * Number.MAX_SAFE_INTEGER even before quantities multiply it.
 */
const PRICE_PATTERN = /^\d{1,9}(\.\d{1,2})?$/

const MINOR_UNITS_PER_MAJOR = 100

/**
 * Returns the price in agorot, or `null` when the input is not a price this
 * module is willing to interpret. Never throws, never guesses, never
 * repairs. A `null` return is the caller's signal to reject the transition
 * outright — not to substitute zero.
 */
export function parsePriceToMinor(price: string): number | null {
  if (!PRICE_PATTERN.test(price)) {
    return null
  }

  const [whole, fraction = ''] = price.split('.')
  // padEnd, not a multiply: "7.5" is 7 shekels 50 agorot, not 7 shekels 5.
  const paddedFraction = fraction.padEnd(2, '0')

  return Number(whole) * MINOR_UNITS_PER_MAJOR + Number(paddedFraction)
}

/**
 * Reconstructs the canonical two-decimal price string from agorot, so the
 * existing `formatPrice` (Intl.NumberFormat — the only formatter in the
 * codebase, per DESIGN_SYSTEM.md §2) stays the single display path. No
 * Slice 7 UI calls this; it exists so a later slice does not invent a
 * second, hand-rolled formatting route.
 */
export function minorToPriceString(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor < 0) {
    throw new RangeError(`minorToPriceString expects a non-negative safe integer, received: ${minor}`)
  }

  const whole = Math.floor(minor / MINOR_UNITS_PER_MAJOR)
  const fraction = minor % MINOR_UNITS_PER_MAJOR

  return `${whole}.${String(fraction).padStart(2, '0')}`
}

/** A quantity the cart domain is willing to store: a positive integer. */
export function isValidQuantity(quantity: number): boolean {
  return Number.isSafeInteger(quantity) && quantity > 0
}
