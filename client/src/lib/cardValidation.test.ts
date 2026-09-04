import { describe, expect, it } from 'vitest'
import {
  cardNumberProblem,
  cvvProblem,
  expiryProblem,
  holderProblem,
  simulatedOutcomeForCard,
} from './cardValidation'

/**
 * Both controls per rule (browser-verification.md's screen rule): every
 * validator is fed something that MUST pass and something that MUST fail.
 */
describe('cardNumberProblem', () => {
  it('accepts a Luhn-valid number, with or without spaces', () => {
    expect(cardNumberProblem('4580458045804580')).toBeNull()
    expect(cardNumberProblem('4580 4580 4580 4580')).toBeNull()
  })
  it('rejects a Luhn-invalid number of the right length', () => {
    expect(cardNumberProblem('4580458045804581')).toBe('CARD_NUMBER_INVALID')
  })
  it('rejects wrong lengths and non-digits; empty is REQUIRED', () => {
    expect(cardNumberProblem('4580')).toBe('CARD_NUMBER_INVALID')
    expect(cardNumberProblem('4580-4580-4580-abcd')).toBe('CARD_NUMBER_INVALID')
    expect(cardNumberProblem('')).toBe('CARD_NUMBER_REQUIRED')
  })
})

describe('simulatedOutcomeForCard', () => {
  it('the decline test card (ending 0002, spaces tolerated) asks for FAILURE; it is also Luhn-valid so it reaches the pay call', () => {
    expect(simulatedOutcomeForCard('4000 0000 0000 0002')).toBe('failure')
    expect(simulatedOutcomeForCard('4000000000000002')).toBe('failure')
    expect(cardNumberProblem('4000 0000 0000 0002')).toBeNull()
  })
  it('any other card asks for SUCCESS (the control: a number ending 0001 pays)', () => {
    expect(simulatedOutcomeForCard('4111 1111 1111 1111')).toBe('success')
    expect(simulatedOutcomeForCard('4000 0000 0000 0001')).toBe('success')
  })
})

describe('expiryProblem', () => {
  const now = new Date(2026, 7, 23) // 2026-08-23
  it('accepts a future month and the CURRENT month (valid through month end)', () => {
    expect(expiryProblem('12/27', now)).toBeNull()
    expect(expiryProblem('08/26', now)).toBeNull()
    expect(expiryProblem('08/2026', now)).toBeNull()
  })
  it('rejects last month as PAST, and nonsense as INVALID', () => {
    expect(expiryProblem('07/26', now)).toBe('EXPIRY_PAST')
    expect(expiryProblem('13/26', now)).toBe('EXPIRY_INVALID')
    expect(expiryProblem('banana', now)).toBe('EXPIRY_INVALID')
    expect(expiryProblem('', now)).toBe('EXPIRY_REQUIRED')
  })
})

describe('cvvProblem', () => {
  it('accepts 3 and 4 digits', () => {
    expect(cvvProblem('123')).toBeNull()
    expect(cvvProblem('1234')).toBeNull()
  })
  it('rejects everything else', () => {
    expect(cvvProblem('12')).toBe('CVV_INVALID')
    expect(cvvProblem('12345')).toBe('CVV_INVALID')
    expect(cvvProblem('12a')).toBe('CVV_INVALID')
    expect(cvvProblem('')).toBe('CVV_REQUIRED')
  })
})

describe('holderProblem', () => {
  it('accepts a name, rejects blank/whitespace', () => {
    expect(holderProblem('ישראל ישראלי')).toBeNull()
    expect(holderProblem('   ')).toBe('HOLDER_REQUIRED')
  })
})
