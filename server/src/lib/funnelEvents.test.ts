import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import {
  CHECKOUT_STARTED_DEDUPE_MS,
  recordCheckoutStarted,
  recordFunnelEvent,
} from './funnelEvents.js'

/**
 * DEC-101 — the recording lib's own guarantees, unit-tested with a mocked
 * client because they are about FAILURE handling: the wire tests prove the
 * rows land; these prove a broken insert can never escape to a caller.
 */

function mockPrisma(overrides: {
  create?: ReturnType<typeof vi.fn>
  findFirst?: ReturnType<typeof vi.fn>
}) {
  return {
    funnelEvent: {
      create: overrides.create ?? vi.fn().mockResolvedValue({}),
      findFirst: overrides.findFirst ?? vi.fn().mockResolvedValue(null),
    },
  } as unknown as PrismaClient
}

describe('recordFunnelEvent', () => {
  it('writes the event with nullable fields defaulted to null', async () => {
    const create = vi.fn().mockResolvedValue({})
    await recordFunnelEvent(mockPrisma({ create }), {
      eventType: 'product_view',
      sessionId: 'sess-1',
      productId: 'p-1',
    })
    expect(create).toHaveBeenCalledWith({
      data: {
        eventType: 'product_view',
        sessionId: 'sess-1',
        userId: null,
        productId: 'p-1',
        orderId: null,
      },
    })
  })

  it('🔴 a throwing insert is swallowed and logged — never rethrown', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const create = vi.fn().mockRejectedValue(new Error('db down'))
      await expect(
        recordFunnelEvent(mockPrisma({ create }), {
          eventType: 'add_to_cart',
          sessionId: 'sess-1',
        }),
      ).resolves.toBeUndefined()
      expect(error).toHaveBeenCalled()
    } finally {
      error.mockRestore()
    }
  })

  it('🔴 an empty session id is dropped, not written into one shared bucket', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const create = vi.fn().mockResolvedValue({})
      await recordFunnelEvent(mockPrisma({ create }), {
        eventType: 'product_view',
        sessionId: '',
      })
      expect(create).not.toHaveBeenCalled()
      expect(error).toHaveBeenCalled()
    } finally {
      error.mockRestore()
    }
  })
})

describe('recordCheckoutStarted — the /validate dedupe', () => {
  it('records when no recent start exists for the session', async () => {
    const create = vi.fn().mockResolvedValue({})
    const findFirst = vi.fn().mockResolvedValue(null)
    await recordCheckoutStarted(mockPrisma({ create, findFirst }), {
      sessionId: 'sess-1',
      userId: 'u-1',
    })
    expect(create).toHaveBeenCalledTimes(1)
    // The lookup is scoped to the session, the event type, and the window —
    // an unscoped lookup would dedupe one shopper's start against another's.
    const where = findFirst.mock.calls[0]?.[0]?.where
    expect(where?.eventType).toBe('checkout_started')
    expect(where?.sessionId).toBe('sess-1')
    const gte: unknown = where?.createdAt?.gte
    expect(gte).toBeInstanceOf(Date)
    const age = Date.now() - (gte as Date).getTime()
    expect(age).toBeGreaterThan(CHECKOUT_STARTED_DEDUPE_MS - 5_000)
    expect(age).toBeLessThan(CHECKOUT_STARTED_DEDUPE_MS + 5_000)
  })

  it('🔴 skips when a recent start exists — /validate is a repeated read', async () => {
    const create = vi.fn().mockResolvedValue({})
    const findFirst = vi.fn().mockResolvedValue({ id: 'existing' })
    await recordCheckoutStarted(mockPrisma({ create, findFirst }), { sessionId: 'sess-1' })
    expect(create).not.toHaveBeenCalled()
  })

  it('a failing dedupe lookup skips recording rather than double-counting', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const create = vi.fn().mockResolvedValue({})
      const findFirst = vi.fn().mockRejectedValue(new Error('db down'))
      await expect(
        recordCheckoutStarted(mockPrisma({ create, findFirst }), { sessionId: 'sess-1' }),
      ).resolves.toBeUndefined()
      expect(create).not.toHaveBeenCalled()
    } finally {
      error.mockRestore()
    }
  })
})
