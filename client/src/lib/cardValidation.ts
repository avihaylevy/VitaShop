/**
 * MILESTONE-008 Checkpoint F2 — the DEMO card form's rules.
 *
 * 🔴 READ THIS BEFORE USING ANY OF IT ANYWHERE ELSE.
 *
 * REQ-F-043 makes the payment a SIMULATION with no real charge, and the
 * specification asks for no card fields at all — "card" appears in it only as
 * *product card*. This module exists because a marker should be able to see
 * input validation working, and for no other reason.
 *
 * 🔴 THESE CHECKS PROVE A NUMBER WAS TYPED CORRECTLY. THEY PROVE NOTHING ELSE.
 * Luhn catches a transposed digit. It does not say the card exists, has funds,
 * or belongs to the person typing — only a bank knows that, at authorisation
 * time. Treating a green tick here as "the payment is safe" is the
 * misunderstanding this comment exists to prevent.
 *
 * 🔴 NOTHING VALIDATED HERE MAY EVER LEAVE THE BROWSER. The card values are
 * never put in a request body, never stored, never logged. `/checkout/pay`
 * receives `simulatedOutcome` and nothing resembling a card — the server has
 * no field for one, by design, and `CheckoutPage.test.tsx` asserts the request
 * body carries none. Real shops keep card data off their own servers through
 * a provider's hosted fields; this project achieves the same property by not
 * having a card at all.
 */

/** The default value the field carries, so a marker can just press pay. */
export const DEMO_CARD_NUMBER = '4111 1111 1111 1111'

/**
 * The pre-filled expiry, ALWAYS IN THE FUTURE.
 *
 * 🔴 IT WAS A HARDCODED `12/30`, WHICH IS A DATED TIME BOMB. From 1 January
 * 2031 the pre-filled card would be expired on first render, `cardIsComplete`
 * would be false, and the pay button would sit disabled — silently, because
 * nothing had been blurred yet. A demo that stops working on a date nobody
 * wrote down is worse than one that never worked.
 */
export function demoExpiry(now: Date = new Date()): string {
  const year = (now.getFullYear() + 4) % 100
  return `12/${String(year).padStart(2, '0')}`
}

export type CardFieldProblem =
  | 'REQUIRED'
  | 'NOT_DIGITS'
  | 'WRONG_LENGTH'
  | 'FAILS_CHECKSUM'
  | 'BAD_FORMAT'
  | 'EXPIRED'

const digitsOnly = (value: string): string => value.replace(/[\s-]/g, '')

/**
 * The Luhn checksum — the arithmetic every card number satisfies.
 *
 * Doubling every second digit from the right and summing (subtracting 9 from
 * any result above 9) must land on a multiple of ten. It catches every
 * single-digit typo and almost every transposition, which is exactly what it
 * was designed for in 1954 and the whole of what it does.
 */
export function passesLuhn(number: string): boolean {
  const digits = digitsOnly(number)
  if (!/^\d+$/.test(digits)) return false

  let sum = 0
  let double = false
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let value = Number(digits[i])
    if (double) {
      value *= 2
      if (value > 9) value -= 9
    }
    sum += value
    double = !double
  }
  return sum % 10 === 0
}

/** `null` when the number is well formed. */
export function cardNumberProblem(value: string): CardFieldProblem | null {
  const digits = digitsOnly(value)
  if (digits === '') return 'REQUIRED'
  if (!/^\d+$/.test(digits)) return 'NOT_DIGITS'
  // 🔴 13 to 19, not "16". Visa issues 13- and 19-digit numbers, Amex 15,
  // Maestro up to 19 — a hardcoded 16 rejects real formats and teaches the
  // wrong rule.
  if (digits.length < 13 || digits.length > 19) return 'WRONG_LENGTH'
  if (!passesLuhn(digits)) return 'FAILS_CHECKSUM'
  return null
}

/** American Express uses a 4-digit code; everyone else uses 3. */
export function cvvLengthFor(cardNumber: string): 3 | 4 {
  const digits = digitsOnly(cardNumber)
  return digits.startsWith('34') || digits.startsWith('37') ? 4 : 3
}

export function cvvProblem(value: string, cardNumber: string): CardFieldProblem | null {
  const trimmed = value.trim()
  if (trimmed === '') return 'REQUIRED'
  if (!/^\d+$/.test(trimmed)) return 'NOT_DIGITS'
  return trimmed.length === cvvLengthFor(cardNumber) ? null : 'WRONG_LENGTH'
}

/**
 * `MM/YY`, and not in the past.
 *
 * ⚠️ A card is valid THROUGH the last day of its expiry month, so the
 * comparison is against the month, never the day. `now` is injectable because
 * a test that builds "next month" from the real clock passes in December for
 * the wrong reason.
 */
export function expiryProblem(value: string, now: Date = new Date()): CardFieldProblem | null {
  const trimmed = value.trim()
  if (trimmed === '') return 'REQUIRED'

  const match = /^(\d{2})\s*\/\s*(\d{2})$/.exec(trimmed)
  if (!match) return 'BAD_FORMAT'

  const month = Number(match[1])
  const year = 2000 + Number(match[2])
  if (month < 1 || month > 12) return 'BAD_FORMAT'

  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()
  if (year < currentYear) return 'EXPIRED'
  if (year === currentYear && month < currentMonth) return 'EXPIRED'
  return null
}

/** True when every field is well formed — what the pay button waits for. */
export function cardIsComplete(card: { number: string; expiry: string; cvv: string }): boolean {
  return (
    cardNumberProblem(card.number) === null &&
    expiryProblem(card.expiry) === null &&
    cvvProblem(card.cvv, card.number) === null
  )
}
