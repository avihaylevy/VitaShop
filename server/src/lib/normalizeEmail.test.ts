import { describe, expect, it } from 'vitest'
import { normalizeEmail } from './normalizeEmail.js'
import { parseRegistration } from './registrationForm.js'

/**
 * One normalisation, used by registration, login and password reset.
 * The drift this guards against is silent: an account stored under one form
 * and looked up under another is simply unreachable, and A1's message
 * correctly refuses to explain why.
 */

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Moshe@Example.COM ')).toBe('moshe@example.com')
  })

  it('is idempotent — normalising twice changes nothing', () => {
    const once = normalizeEmail(' A@B.com ')
    expect(normalizeEmail(once)).toBe(once)
  })

  it('🔴 does NOT strip dots or +tags — they address different mailboxes', () => {
    // Treating a+shop@x.com as a@x.com would let one registration block
    // another person's real address.
    expect(normalizeEmail('a+shop@example.com')).toBe('a+shop@example.com')
    expect(normalizeEmail('first.last@example.com')).toBe('first.last@example.com')
  })
})

describe('registration stores exactly what login will look up', () => {
  it('🔴 the parsed email equals normalizeEmail of the raw input', () => {
    const raw = '  Moshe@Example.COM '
    const result = parseRegistration({
      firstName: 'משה',
      lastName: 'כהן',
      email: raw,
      password: 'Abcdef12',
      confirmPassword: 'Abcdef12',
      phone: '050-9871234',
      acceptedTerms: true,
    })

    expect(result.ok).toBe(true)
    // If these two ever diverge, registration creates accounts that login
    // cannot find, and nothing anywhere reports it.
    if (result.ok) expect(result.value.email).toBe(normalizeEmail(raw))
  })
})
