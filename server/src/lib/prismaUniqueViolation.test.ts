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

  it('🔴 matches when the caller lists the CONSTRAINT NAME — as both real call sites do', () => {
    // The previous version had a "decoration" branch meant to derive a column
    // from a constraint name. It was DEAD: the shared normaliser stripped
    // underscores, so `users_email_key` became `usersemailkey` and the
    // boundary regex could never fire. Its only positive test passed the whole
    // constraint name, which hit the equality branch and never reached it.
    expect(isUniqueViolationOn(messageOnly('users_email_key'), ['email', 'users_email_key'])).toBe(true)
    expect(
      isUniqueViolationOn(messageOnly('carts_session_id_key'), ['carts_session_id_key', 'sessionId']),
    ).toBe(true)
  })

  it('🔴 a FIELD NAME ALONE does not match — and that is a deliberate limit', () => {
    // users_email_key and users_pending_email_key BOTH yield 'email' as a
    // legitimate column reading, because the table prefix is unknown. Any rule
    // permissive enough to accept the first also accepts the second, which is
    // the false positive that would answer ALREADY-REGISTERED for an unrelated
    // collision. Field names are served by the STRUCTURED path.
    expect(isUniqueViolationOn(messageOnly('users_email_key'), ['email'])).toBe(false)
  })

  it('🔴 pending_email never matches the email constraint on this path either', () => {
    expect(isUniqueViolationOn(messageOnly('users_pending_email_key'), ['users_email_key'])).toBe(false)
    expect(isUniqueViolationOn(messageOnly('users_pending_email_key'), ['email'])).toBe(false)
  })

  it('returns false when there is no quoted constraint to read', () => {
    expect(
      isUniqueViolationOn(
        { code: 'P2002', meta: { driverAdapterError: { cause: { originalMessage: 'something odd' } } } },
        ['users_email_key'],
      ),
    ).toBe(false)
  })

  it('never matches a non-P2002 error', () => {
    expect(isUniqueViolationOn({ code: 'P2025', meta: {} }, ['users_email_key'])).toBe(false)
    expect(isUniqueViolationOn(null, ['email'])).toBe(false)
  })
})

describe('🔴 the real call sites list their constraint name, so the fallback can fire', () => {
  it('registrationService accepts email AND users_email_key', () => {
    // Pinned: if someone trims the constraint name from that call, the
    // fallback silently stops covering it and the module's stated reason for
    // keeping two lookups stops being true.
    const accepted = ['email', 'users_email_key']
    expect(
      isUniqueViolationOn(
        {
          code: 'P2002',
          meta: {
            driverAdapterError: {
              cause: {
                originalMessage: 'duplicate key value violates unique constraint "users_email_key"',
              },
            },
          },
        },
        accepted,
      ),
    ).toBe(true)
  })
})
