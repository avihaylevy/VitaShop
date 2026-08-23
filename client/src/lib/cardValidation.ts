/**
 * The lecturer-fixes list (2026-08-23) — payment card validation, CLIENT
 * ONLY. This reverses DEC-098's "no card fields" at the user's explicit
 * instruction ("צריך להיות אופציה להכניס פרטי אשראי עם החוקיות המתאימה…
 * אבל לא לשמור אותם בשום מקום"):
 *
 * 🔴 THE DETAILS GO NOWHERE. Not to the server, not to storage, not to a
 * log — the form is a validation GATE in front of the same simulated
 * payment, and the pay request's shape is unchanged. Grep witnesses:
 * `payForCheckout` takes no card argument.
 *
 * Pure functions so the rules are unit-pinnable with exact numbers.
 */

/** Luhn checksum over 13–19 digits (spaces/dashes tolerated). */
export function cardNumberProblem(raw: string): 'CARD_NUMBER_REQUIRED' | 'CARD_NUMBER_INVALID' | null {
  const digits = raw.replace(/[\s-]/g, '')
  if (digits === '') return 'CARD_NUMBER_REQUIRED'
  if (!/^\d{13,19}$/.test(digits)) return 'CARD_NUMBER_INVALID'
  let sum = 0
  let double = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (double) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    double = !double
  }
  return sum % 10 === 0 ? null : 'CARD_NUMBER_INVALID'
}

/**
 * MM/YY (or MM/YYYY), must parse and must not be in the past. `now` is a
 * parameter so the boundary month is testable with exact dates — a card
 * expiring THIS month is still valid (industry convention: end of month).
 */
export function expiryProblem(
  raw: string,
  now: Date = new Date(),
): 'EXPIRY_REQUIRED' | 'EXPIRY_INVALID' | 'EXPIRY_PAST' | null {
  const trimmed = raw.trim()
  if (trimmed === '') return 'EXPIRY_REQUIRED'
  const match = /^(\d{2})\s*\/\s*(\d{2}|\d{4})$/.exec(trimmed)
  if (!match) return 'EXPIRY_INVALID'
  const month = Number(match[1])
  if (month < 1 || month > 12) return 'EXPIRY_INVALID'
  const year = match[2].length === 2 ? 2000 + Number(match[2]) : Number(match[2])
  // Valid through the last moment of the stated month.
  const endOfMonth = new Date(year, month, 1)
  return now < endOfMonth ? null : 'EXPIRY_PAST'
}

/** Exactly 3 or 4 digits. */
export function cvvProblem(raw: string): 'CVV_REQUIRED' | 'CVV_INVALID' | null {
  const trimmed = raw.trim()
  if (trimmed === '') return 'CVV_REQUIRED'
  return /^\d{3,4}$/.test(trimmed) ? null : 'CVV_INVALID'
}

/** Non-empty, after trimming — the same bar the address fields set. */
export function holderProblem(raw: string): 'HOLDER_REQUIRED' | null {
  return raw.trim() === '' ? 'HOLDER_REQUIRED' : null
}
