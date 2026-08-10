import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { invalidateUserSessions } from './sessionInvalidation.js'

/**
 * MILESTONE-006 clause A8.
 *
 * These tests use a fake pool rather than a live database: the thing under
 * test is the SQL and its bound parameters, and the silent failure A8 warns
 * about is a parameter-type bug, not a connectivity one.
 */

function fakePool(rowCount = 0) {
  const query = vi.fn().mockResolvedValue({ rowCount })
  return { pool: { query } as unknown as Pool, query }
}

describe('invalidateUserSessions — A8', () => {
  it('matches on the sess->>userId JSON predicate, not a column', () => {
    const { pool, query } = fakePool()
    void invalidateUserSessions('user-1', { pool })

    const [sql] = query.mock.calls[0] as [string, unknown[]]
    // connect-pg-simple's table has no user-id column; A8's whole mechanism
    // is the JSON predicate. If this ever becomes `WHERE user_id = $1`,
    // someone has "fixed" it against a column that does not exist.
    expect(sql).toContain(`"sess"->>'userId' = $1`)
    expect(sql).toContain('DELETE FROM "session"')
  })

  it('🔴 binds the user id as a STRING when given a string', () => {
    const { pool, query } = fakePool()
    void invalidateUserSessions('user-1', { pool })

    const [, params] = query.mock.calls[0] as [string, unknown[]]
    expect(params[0]).toBe('user-1')
    expect(typeof params[0]).toBe('string')
  })

  it('🔴 coerces a NUMERIC id to a string — the silent failure A8 names', () => {
    const { pool, query } = fakePool()
    // A caller passing a number is the realistic mistake: `sess->>'userId'`
    // returns TEXT, so Postgres would compare text to a number, the predicate
    // would match nothing, and the DELETE would succeed having removed zero
    // rows. No error is raised — the sessions a password reset was supposed
    // to kill simply stay alive. The helper must not let that happen.
    void invalidateUserSessions(42 as unknown as string, { pool })

    const [, params] = query.mock.calls[0] as [string, unknown[]]
    expect(params[0]).toBe('42')
    expect(typeof params[0]).toBe('string')
    expect(params[0]).not.toBe(42)
  })

  it('excludes the acting session when exceptSid is given', () => {
    const { pool, query } = fakePool()
    void invalidateUserSessions('user-1', { pool, exceptSid: 'keep-me' })

    const [sql, params] = query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('"sid" <> $2')
    expect(params).toEqual(['user-1', 'keep-me'])
  })

  it('omits the sid exclusion entirely when exceptSid is absent', () => {
    const { pool, query } = fakePool()
    void invalidateUserSessions('user-1', { pool })

    const [sql, params] = query.mock.calls[0] as [string, unknown[]]
    expect(sql).not.toContain('"sid" <>')
    expect(params).toHaveLength(1)
  })

  it('reports how many sessions were removed', async () => {
    const { pool } = fakePool(3)
    await expect(invalidateUserSessions('user-1', { pool })).resolves.toBe(3)
  })

  it('reports 0 rather than null when the driver returns no rowCount', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: null })
    const pool = { query } as unknown as Pool
    await expect(invalidateUserSessions('user-1', { pool })).resolves.toBe(0)
  })
})
