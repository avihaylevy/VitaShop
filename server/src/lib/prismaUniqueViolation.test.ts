import { describe, expect, it } from 'vitest'
import { isUniqueViolationOn } from './prismaUniqueViolation.js'

/**
 * 🔴 KNOWN-ANSWER CONTROLS for the P2002 matcher. ISSUE-067 exists because a
 * security control was tested only against a SYNTHETIC error carrying a field
 * the real driver never sets. These cases fix answers that are known in
 * advance, in both directions — one that MUST match and one that MUST NOT.
 */

const adapterError = (fields: string[], constraintName: string) => ({
  code: 'P2002',
  meta: {
    modelName: 'User',
    driverAdapterError: {
      cause: {
        originalCode: '23505',
        originalMessage: `duplicate key value violates unique constraint "${constraintName}"`,
        constraint: { fields },
      },
    },
  },
})

describe('isUniqueViolationOn — the structured source is authoritative', () => {
  it('matches the email constraint as the adapter really reports it', () => {
    expect(isUniqueViolationOn(adapterError(['email'], 'users_email_key'), ['email'])).toBe(true)
  })

  it('🔴 pending_email must NOT match email — the case the OR version failed', () => {
    // fields ['pending_email'] correctly does NOT contain 'email', but the raw
    // message DOES. The previous version ORed the message test in
    // unconditionally, so this returned true and registration would have
    // answered ALREADY-REGISTERED for a collision unrelated to the address.
    const error = adapterError(['pending_email'], 'users_pending_email_key')
    expect(isUniqueViolationOn(error, ['email'])).toBe(false)
  })

  it('a precise structured NEGATIVE is not overridden by the message', () => {
    const error = adapterError(['session_id'], 'carts_session_id_key')
    expect(isUniqueViolationOn(error, ['email'])).toBe(false)
    expect(isUniqueViolationOn(error, ['sessionId'])).toBe(true) // normalised both sides
  })

  it('normalises case STYLE — snake_case fields match camelCase callers', () => {
    const error = adapterError(['cart_id', 'product_id'], 'cart_items_cart_id_product_id_key')
    expect(isUniqueViolationOn(error, ['cartId'])).toBe(true)
    expect(isUniqueViolationOn(error, ['productId'])).toBe(true)
  })

  it('still honours Prisma’s documented meta.target when the adapter path is absent', () => {
    // Both shapes are kept on purpose: understanding exactly one is what broke.
    expect(isUniqueViolationOn({ code: 'P2002', meta: { target: ['email'] } }, ['email'])).toBe(true)
  })
})

describe('the message fallback — only when nothing structured answered', () => {
  const messageOnly = (constraintName: string) => ({
    code: 'P2002',
    meta: {
      driverAdapterError: {
        cause: { originalMessage: `duplicate key value violates unique constraint "${constraintName}"` },
      },
    },
  })

  it('matches the quoted constraint name, with Postgres decoration', () => {
    expect(isUniqueViolationOn(messageOnly('users_email_key'), ['users_email_key'])).toBe(true)
    expect(isUniqueViolationOn(messageOnly('carts_session_id_key'), ['carts_session_id_key'])).toBe(true)
  })

  it('🔴 is NOT a substring sweep — pending_email still does not match email', () => {
    expect(isUniqueViolationOn(messageOnly('users_pending_email_key'), ['email'])).toBe(false)
  })

  it('returns false when there is no quoted constraint to read', () => {
    expect(
      isUniqueViolationOn(
        { code: 'P2002', meta: { driverAdapterError: { cause: { originalMessage: 'something odd' } } } },
        ['email'],
      ),
    ).toBe(false)
  })

  it('never matches a non-P2002 error', () => {
    expect(isUniqueViolationOn({ code: 'P2025', meta: {} }, ['email'])).toBe(false)
    expect(isUniqueViolationOn(null, ['email'])).toBe(false)
  })
})
