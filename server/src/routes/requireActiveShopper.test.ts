import { describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import type { Request, Response } from 'express'
import {
  createRequireActiveShopper,
  createRequireShopperAccount,
  createRequireVerifiedShopper,
} from './requireActiveShopper.js'

/**
 * 🔴 THE 401 MUST NOT LEAVE BEFORE THE SESSION ROW IS GONE.
 *
 * Found by CI on Dependabot's server bump (PR #3, 2026-08-27): the guard
 * fired `req.session.destroy(() => {})` and answered in the same tick, so a
 * client's very next request could still load the session — ordersRead's
 * DEC-074 test saw 200 after the 401 once the bump shifted the timing. The
 * integration suite can only catch that race when it loses; this test makes
 * the ordering a contract: the response is written only after the store's
 * destroy callback has run.
 */
function fakePrisma(user: { status: string } | null): PrismaClient {
  return { user: { findUnique: async () => user } } as unknown as PrismaClient
}

function harness(userId: string | undefined) {
  const events: string[] = []
  const session = userId
    ? {
        userId,
        destroy(cb: (err?: unknown) => void) {
          // The store's DELETE lands on a LATER tick — like a real database.
          setTimeout(() => {
            events.push('destroyed')
            cb()
          }, 5)
        },
      }
    : undefined
  const req = { session } as unknown as Request
  const res = {
    status(code: number) {
      events.push(`status:${code}`)
      return this
    },
    json() {
      events.push('json')
      return this
    },
  } as unknown as Response
  return { req, res, events }
}

const GUARDS = [
  ['createRequireActiveShopper', createRequireActiveShopper],
  ['createRequireShopperAccount', createRequireShopperAccount],
  ['createRequireVerifiedShopper', createRequireVerifiedShopper],
] as const

describe('the refusal waits for the session to be destroyed', () => {
  for (const [name, create] of GUARDS) {
    it(`${name}: a GONE user — destroyed BEFORE the 401 is written`, async () => {
      const { req, res, events } = harness('user-1')
      let nextCalled = false
      await create(fakePrisma(null))(req, res, () => {
        nextCalled = true
      })
      expect(nextCalled).toBe(false)
      expect(events).toEqual(['destroyed', 'status:401', 'json'])
    })
  }

  for (const [name, create] of [GUARDS[0], GUARDS[2]]) {
    it(`${name}: a DISABLED user — destroyed BEFORE the 401 is written`, async () => {
      const { req, res, events } = harness('user-1')
      await create(fakePrisma({ status: 'disabled' }))(req, res, () => {})
      expect(events).toEqual(['destroyed', 'status:401', 'json'])
    })
  }

  it('THE CONTROL — an active user passes through and nothing is destroyed', async () => {
    const { req, res, events } = harness('user-1')
    let nextCalled = false
    await createRequireActiveShopper(fakePrisma({ status: 'active' }))(req, res, () => {
      nextCalled = true
    })
    expect(nextCalled).toBe(true)
    expect(events).toEqual([])
  })

  it('an anonymous request has no session to destroy and is refused at once', async () => {
    const { req, res, events } = harness(undefined)
    await createRequireActiveShopper(fakePrisma(null))(req, res, () => {})
    expect(events).toEqual(['status:401', 'json'])
  })
})
