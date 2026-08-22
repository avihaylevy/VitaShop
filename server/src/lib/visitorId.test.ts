import { describe, expect, it, vi, afterEach } from 'vitest'
import type { Request, Response } from 'express'
import { ensureVisitorId, readVisitorCookie, VISITOR_COOKIE } from './visitorId.js'

/**
 * DEC-103 / ISSUE-189 — the durable visitor identity. The journey-level
 * guarantee (one id across guest → login → purchase) is proven over the
 * wire in funnel.integration.test.ts; these pin the cookie mechanics.
 */

const UUID = '0f9c2d31-4a5b-4c6d-8e7f-102938475601'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('readVisitorCookie', () => {
  it('finds the cookie among siblings, whitespace-tolerant', () => {
    expect(readVisitorCookie(`connect.sid=abc; ${VISITOR_COOKIE}=${UUID}; other=1`)).toBe(UUID)
    expect(readVisitorCookie(` ${VISITOR_COOKIE} = ${UUID} `)).toBe(UUID)
  })

  it('answers null for an absent header or cookie', () => {
    expect(readVisitorCookie(undefined)).toBeNull()
    expect(readVisitorCookie('connect.sid=abc')).toBeNull()
  })

  it('🔴 rejects a value that is not our minted shape — a tampered cookie must not become an attacker-chosen KPI bucket', () => {
    expect(readVisitorCookie(`${VISITOR_COOKIE}=hello`)).toBeNull()
    expect(readVisitorCookie(`${VISITOR_COOKIE}=`)).toBeNull()
    expect(readVisitorCookie(`${VISITOR_COOKIE}=${UUID}extra`)).toBeNull()
  })
})

function fakeReqRes(cookieHeader?: string, headersSent = false) {
  const cookie = vi.fn()
  const req = { headers: { cookie: cookieHeader } } as unknown as Request
  const res = { headersSent, cookie } as unknown as Response
  return { req, res, cookie }
}

describe('ensureVisitorId', () => {
  it('returns the existing id without re-setting the cookie', () => {
    const { req, res, cookie } = fakeReqRes(`${VISITOR_COOKIE}=${UUID}`)
    expect(ensureVisitorId(req, res)).toBe(UUID)
    expect(cookie).not.toHaveBeenCalled()
  })

  it('mints a UUID and sets it with the session cookie contract + a year maxAge', () => {
    const { req, res, cookie } = fakeReqRes()
    const id = ensureVisitorId(req, res)
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(cookie).toHaveBeenCalledWith(
      VISITOR_COOKIE,
      id,
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: false,
        maxAge: 365 * 24 * 60 * 60 * 1000,
      }),
    )
  })

  it('secure in production — the session cookie rule, shared not copied', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { req, res, cookie } = fakeReqRes()
    ensureVisitorId(req, res)
    expect(cookie).toHaveBeenCalledWith(
      VISITOR_COOKIE,
      expect.any(String),
      expect.objectContaining({ secure: true }),
    )
  })

  it('🔴 after headers are sent it still answers an id but writes no header', () => {
    const { req, res, cookie } = fakeReqRes(undefined, true)
    expect(ensureVisitorId(req, res)).toMatch(/^[0-9a-f-]{36}$/)
    expect(cookie).not.toHaveBeenCalled()
  })
})
