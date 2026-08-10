import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * MILESTONE-006 Checkpoint C — the session middleware's configuration.
 *
 * The store is captured through a mock so the frozen A6 / A6-CSRF options can
 * be asserted directly. These are contract clauses, not preferences: each one
 * here is a security control someone could plausibly "simplify" later.
 */

const sessionFactory = vi.fn((options: unknown) => {
  sessionFactory.lastOptions = options
  return () => undefined
}) as ReturnType<typeof vi.fn> & { lastOptions?: unknown }

const storeConstructor = vi.fn()

vi.mock('express-session', () => ({
  default: Object.assign(sessionFactory, { Store: class {} }),
}))

vi.mock('connect-pg-simple', () => ({
  default: () =>
    class {
      constructor(options: unknown) {
        storeConstructor(options)
      }
    },
}))

vi.mock('./sessionPool.js', () => ({ sessionPool: { __brand: 'pool' } }))

const { createSessionMiddleware } = await import('./session.js')

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  sessionFactory.mockClear()
  storeConstructor.mockClear()
  process.env.SESSION_SECRET = 'test-secret-not-a-real-one'
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

function optionsFrom() {
  createSessionMiddleware()
  return sessionFactory.lastOptions as {
    cookie: Record<string, unknown>
    resave: boolean
    saveUninitialized: boolean
    secret: string
  }
}

describe('createSessionMiddleware — A6 cookie contract', () => {
  it('sets httpOnly', () => {
    expect(optionsFrom().cookie.httpOnly).toBe(true)
  })

  it('🔴 sets sameSite=lax — this IS the CSRF control (A6-CSRF)', () => {
    // Not a default worth trusting: A6-CSRF records `lax` as the entire CSRF
    // mitigation for this project, on the ground that it withholds the cookie
    // from cross-site state-changing requests. Changing it to 'none' voids
    // that decision and requires CSRF tokens instead.
    expect(optionsFrom().cookie.sameSite).toBe('lax')
  })

  it('sets secure only in production', () => {
    process.env.NODE_ENV = 'production'
    expect(optionsFrom().cookie.secure).toBe(true)

    process.env.NODE_ENV = 'development'
    expect(optionsFrom().cookie.secure).toBe(false)
  })

  it('does not persist untouched anonymous sessions', () => {
    const options = optionsFrom()
    expect(options.saveUninitialized).toBe(false)
    expect(options.resave).toBe(false)
  })
})

describe('createSessionMiddleware — the store', () => {
  it('🔴 never lets the store create or alter the baselined session table', () => {
    // DEC-052 Part 2: the table is baselined and tracked by Prisma. If the
    // store creates or alters it, the schema drifts from the migration
    // history — the precise failure the baseline exists to prevent.
    createSessionMiddleware()
    const options = storeConstructor.mock.calls[0]?.[0] as Record<string, unknown>
    expect(options.createTableIfMissing).toBe(false)
    expect(options.tableName).toBe('session')
  })

  it('uses the shared pool, so A8 invalidation hits the same connection', () => {
    createSessionMiddleware()
    const options = storeConstructor.mock.calls[0]?.[0] as Record<string, unknown>
    expect(options.pool).toEqual({ __brand: 'pool' })
  })
})

describe('createSessionMiddleware — the secret', () => {
  it('🔴 throws when SESSION_SECRET is missing, rather than defaulting', () => {
    delete process.env.SESSION_SECRET
    expect(() => createSessionMiddleware()).toThrow(/SESSION_SECRET is not set/)
  })

  it('takes the secret from the environment', () => {
    process.env.SESSION_SECRET = 'another-test-value'
    expect(optionsFrom().secret).toBe('another-test-value')
  })
})
