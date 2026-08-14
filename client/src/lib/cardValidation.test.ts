import { describe, expect, it } from 'vitest'
import {
  DEMO_CARD_NUMBER,
  demoExpiry,
  cardIsComplete,
  cardNumberProblem,
  cvvLengthFor,
  cvvProblem,
  expiryProblem,
  passesLuhn,
} from './cardValidation'

/**
 * MILESTONE-008 — the demo card form's rules.
 *
 * 🔴 WHAT THESE TESTS DO NOT CLAIM. They prove a number was typed correctly.
 * They say nothing about whether a card exists, has funds, or belongs to the
 * person typing — only a bank knows that. The form is a demonstration of input
 * validation, and REQ-F-043 keeps the payment itself a simulation.
 */

describe('the Luhn checksum', () => {
  it.each([
    '4111111111111111', // Visa test number
    '5555555555554444', // Mastercard test number
    '378282246310005', // Amex test number, 15 digits
    '4111 1111 1111 1111', // spaces are ignored
    '4111-1111-1111-1111', // and so are dashes
  ])('accepts %s', (value) => {
    expect(passesLuhn(value)).toBe(true)
  })

  it('🔴 rejects a SINGLE transposed digit — the typo it exists to catch', () => {
    // 4111111111111111 is valid; swapping the last two is not.
    expect(passesLuhn('4111111111111121')).toBe(false)
  })

  it('rejects letters rather than treating them as zero', () => {
    expect(passesLuhn('4111 1111 1111 111a')).toBe(false)
  })
})

describe('the card number field', () => {
  it('accepts the pre-filled demo number, so pressing pay just works', () => {
    expect(cardNumberProblem(DEMO_CARD_NUMBER)).toBeNull()
  })

  it('asks for a value when empty', () => {
    expect(cardNumberProblem('   ')).toBe('REQUIRED')
  })

  it('rejects a wrong checksum with its own message', () => {
    expect(cardNumberProblem('4111 1111 1111 1112')).toBe('FAILS_CHECKSUM')
  })

  it.each(['411111111111', '41111111111111111111'])('rejects %s on length', (value) => {
    expect(cardNumberProblem(value)).toBe('WRONG_LENGTH')
  })

  it('🔴 accepts 13, 15 and 19 digits — not just 16', () => {
    // Visa issues 13- and 19-digit numbers and Amex 15. A hardcoded 16 rejects
    // real formats and teaches the wrong rule.
    expect(cardNumberProblem('4222222222222')).toBeNull() // 13, Visa test
    expect(cardNumberProblem('378282246310005')).toBeNull() // 15, Amex test
    // ⚠️ 19-digit case: the check digit was COMPUTED, not invented. The first
    // version of this test appended digits by hand, the number failed Luhn,
    // and the test failed for a reason that had nothing to do with length —
    // which is exactly how a length rule gets "fixed" by loosening the
    // checksum.
    expect(cardNumberProblem('4111111111111111110')).toBeNull() // 19, Luhn-valid
  })

  it('reports letters as NOT_DIGITS rather than a checksum failure', () => {
    // The messages differ because the fix differs: retype the digit versus
    // check the number.
    expect(cardNumberProblem('4111 1111 1111 11ab')).toBe('NOT_DIGITS')
  })
})

describe('the security code', () => {
  it('wants three digits on an ordinary card', () => {
    expect(cvvProblem('123', DEMO_CARD_NUMBER)).toBeNull()
    expect(cvvProblem('12', DEMO_CARD_NUMBER)).toBe('WRONG_LENGTH')
    expect(cvvProblem('1234', DEMO_CARD_NUMBER)).toBe('WRONG_LENGTH')
  })

  it('🔴 wants FOUR on American Express, which starts 34 or 37', () => {
    expect(cvvLengthFor('378282246310005')).toBe(4)
    expect(cvvProblem('1234', '378282246310005')).toBeNull()
    expect(cvvProblem('123', '378282246310005')).toBe('WRONG_LENGTH')
  })

  it('rejects letters and blanks', () => {
    expect(cvvProblem('12a', DEMO_CARD_NUMBER)).toBe('NOT_DIGITS')
    expect(cvvProblem('', DEMO_CARD_NUMBER)).toBe('REQUIRED')
  })
})

describe('the expiry date', () => {
  const NOW = new Date('2026-08-13T00:00:00Z')

  it('accepts a future month', () => {
    expect(expiryProblem('09/26', NOW)).toBeNull()
    expect(expiryProblem('01/30', NOW)).toBeNull()
  })

  it('🔴 accepts THIS month — a card is valid through its last day', () => {
    // The boundary a naive `<=` gets wrong, refusing a card that still works.
    expect(expiryProblem('08/26', NOW)).toBeNull()
  })

  it('rejects last month, and any earlier year', () => {
    expect(expiryProblem('07/26', NOW)).toBe('EXPIRED')
    expect(expiryProblem('12/25', NOW)).toBe('EXPIRED')
  })

  it('rejects a month that does not exist', () => {
    expect(expiryProblem('13/27', NOW)).toBe('BAD_FORMAT')
    expect(expiryProblem('00/27', NOW)).toBe('BAD_FORMAT')
  })

  it.each(['0926', '9/26', '2026-09', 'soon'])('rejects the malformed %s', (value) => {
    expect(expiryProblem(value, NOW)).toBe('BAD_FORMAT')
  })

  it('asks for a value when empty', () => {
    expect(expiryProblem('  ', NOW)).toBe('REQUIRED')
  })
})

describe('cardIsComplete — what the pay button waits for', () => {
  it('is true for the pre-filled demo card', () => {
    expect(cardIsComplete({ number: DEMO_CARD_NUMBER, expiry: '09/30', cvv: '123' })).toBe(true)
  })

  it.each([
    ['a bad number', { number: '4111 1111 1111 1112', expiry: '09/30', cvv: '123' }],
    ['an expired date', { number: DEMO_CARD_NUMBER, expiry: '01/20', cvv: '123' }],
    ['a short code', { number: DEMO_CARD_NUMBER, expiry: '09/30', cvv: '12' }],
  ])('is false with %s', (_label, card) => {
    expect(cardIsComplete(card)).toBe(false)
  })
})

describe('the pre-filled demo expiry', () => {
  /**
   * 🔴 TESTED AT A FUTURE CLOCK, and that is the whole point. The hardcoded
   * `12/30` it replaced is still valid TODAY, so a test that only asks "is the
   * default in the future?" against the real clock passes for another four
   * years and then the demo silently stops working. Injecting the date is what
   * makes the bug reachable now.
   */
  it.each([
    new Date('2026-08-13T00:00:00Z'),
    new Date('2031-06-01T00:00:00Z'),
    new Date('2044-01-01T00:00:00Z'),
  ])('is still in the future when "now" is %s', (now) => {
    expect(expiryProblem(demoExpiry(now), now)).toBeNull()
  })

  it('keeps the MM/YY shape the field expects', () => {
    expect(demoExpiry(new Date('2026-08-13T00:00:00Z'))).toMatch(/^\d{2}\/\d{2}$/)
  })
})
