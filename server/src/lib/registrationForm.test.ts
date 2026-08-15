import { describe, expect, it } from 'vitest'
import { normalisePhone, parseRegistration } from './registrationForm.js'

/**
 * TEST-030 — registration validation. REQ-F-030 / VALIDATION_RULES Table 3.
 *
 * 🔴 The "existing email" row of TEST-030 is NOT here. It was corrected on
 * 2026-08-10 away from "rejected": DEC-053 clause 4b requires the same
 * 200-shaped response as success. It is a service-level behaviour, covered in
 * registrationService.test.ts, not a validation rule.
 */

const valid = {
  firstName: 'משה',
  lastName: 'כהן',
  email: 'M@Gmail.com',
  password: 'Abcdef12',
  confirmPassword: 'Abcdef12',
  phone: '050-9871234',
  acceptedTerms: true,
}

function parseWith(overrides: Record<string, unknown>) {
  return parseRegistration({ ...valid, ...overrides })
}

describe('TEST-030 — password rules (Table 3 field 23)', () => {
  it('rejects `abc123` — 6 chars, no uppercase', () => {
    const result = parseWith({ password: 'abc123', confirmPassword: 'abc123' })
    expect(result.ok).toBe(false)
  })

  it('rejects `Abcdefgh` — no digit', () => {
    const result = parseWith({ password: 'Abcdefgh', confirmPassword: 'Abcdefgh' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.codes).toContain('PASSWORD_NEEDS_DIGIT')
  })

  it('rejects a password with no uppercase', () => {
    const result = parseWith({ password: 'abcdef12', confirmPassword: 'abcdef12' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.codes).toContain('PASSWORD_NEEDS_UPPERCASE')
  })

  it('accepts `Abcdef12`', () => {
    expect(parseWith({}).ok).toBe(true)
  })

  it('🔴 treats 8 as a MINIMUM — a long password with symbols is accepted', () => {
    // VALIDATION_RULES field 23: do not impose a low upper limit and do not
    // forbid special characters. Both are common "hardening" mistakes that
    // make passwords weaker.
    const long = 'A1' + '!@#$%^&*()_+-=[]{}|;:,.<>?'.repeat(3)
    expect(parseWith({ password: long, confirmPassword: long }).ok).toBe(true)
  })
})

describe('TEST-030 — confirmation, email, phone, terms', () => {
  it('rejects a mismatched confirmation (field 24, server-side)', () => {
    const result = parseWith({ confirmPassword: 'Abcdef13' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.codes).toContain('PASSWORD_CONFIRMATION_MISMATCH')
  })

  it('rejects a malformed email', () => {
    expect(parseWith({ email: 'not-an-email' }).ok).toBe(false)
  })

  it('lowercases and trims the email, so uniqueness is not case-dodgeable', () => {
    const result = parseWith({ email: '  Moshe@Example.COM ' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.email).toBe('moshe@example.com')
  })

  it('rejects an empty first or last name', () => {
    expect(parseWith({ firstName: '   ' }).ok).toBe(false)
    expect(parseWith({ lastName: '' }).ok).toBe(false)
  })

  it('accepts both Israeli mobile forms and normalises them', () => {
    const dashed = parseWith({ phone: '050-9871234' })
    const plain = parseWith({ phone: '0509871234' })
    expect(dashed.ok && plain.ok).toBe(true)
    if (dashed.ok && plain.ok) {
      expect(dashed.value.phone).toBe('0509871234')
      expect(plain.value.phone).toBe('0509871234')
    }
  })

  it('rejects a non-Israeli-mobile phone', () => {
    expect(parseWith({ phone: '03-1234567' }).ok).toBe(false)
    expect(parseWith({ phone: '05-9871234' }).ok).toBe(false)
  })

  it('🔴 rejects terms that are false or absent (field 26 must be true)', () => {
    expect(parseWith({ acceptedTerms: false }).ok).toBe(false)
    const { acceptedTerms: _omitted, ...withoutTerms } = valid
    expect(parseRegistration(withoutTerms).ok).toBe(false)
  })

  it('rejects a non-object body without throwing', () => {
    expect(parseRegistration(null).ok).toBe(false)
    expect(parseRegistration('nope').ok).toBe(false)
  })
})

describe('the seventh list, item 1 — the joinClub opt-in field', () => {
  it('ABSENT means "did not opt in" — parses ok with joinClub false', () => {
    const result = parseRegistration(valid)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.joinClub).toBe(false)
  })

  it('true and false both pass through', () => {
    const yes = parseWith({ joinClub: true })
    expect(yes.ok).toBe(true)
    if (yes.ok) expect(yes.value.joinClub).toBe(true)
    const no = parseWith({ joinClub: false })
    expect(no.ok).toBe(true)
    if (no.ok) expect(no.value.joinClub).toBe(false)
  })

  it('🔴 a PRESENT non-boolean rejects with the NAMED code, not a zod default', () => {
    // The client maps codes it knows; an unnamed message renders as a
    // submit that silently does nothing (review finding).
    const result = parseWith({ joinClub: 'true' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.codes).toContain('JOIN_CLUB_INVALID')
  })
})

describe('normalisePhone', () => {
  it('strips dashes only', () => {
    expect(normalisePhone('050-987-1234')).toBe('0509871234')
  })
})
