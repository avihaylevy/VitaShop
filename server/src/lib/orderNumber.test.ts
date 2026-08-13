import { describe, expect, it, vi } from 'vitest'
import {
  MAX_ORDER_NUMBER_ATTEMPTS,
  generateOrderNumber,
  orderNumberCandidate,
} from './orderNumber.js'

/**
 * 🔴 THIS FILE EXISTS BECAUSE THE MODULE ASKED FOR IT AND NOBODY WROTE IT.
 *
 * `orderNumber.ts`'s own header says "collisions are rare, which is exactly why
 * the collision path must be tested rather than assumed", and
 * `MAX_ORDER_NUMBER_ATTEMPTS` is exported for a test that did not exist. Until
 * now the format was asserted only incidentally, by a regex in a happy-path
 * integration test, and NEITHER retry path had ever run.
 *
 * ⚠️ That is this project's most-recorded defect shape — machinery that looks
 * correct and has never been executed. See ISSUE-067, where a security matcher
 * shipped dead for a whole milestone.
 */

const DAY = '20260813'

describe('the format', () => {
  it('is VS-YYYYMMDD-XXXXXX over the unambiguous alphabet', () => {
    expect(orderNumberCandidate(DAY)).toMatch(/^VS-20260813-[A-HJ-NP-Z2-9]{6}$/)
  })

  it('🔴 never emits 0, O, 1 or I — the characters people mistype off a screen', () => {
    // 400 draws x 6 characters. If any excluded character were reachable, a
    // sample this size finds it; asserting the alphabet constant instead would
    // only prove the constant matches itself.
    const suffixes = Array.from({ length: 400 }, () => orderNumberCandidate(DAY).slice(-6))
    expect(suffixes.join('')).not.toMatch(/[O0I1]/)
  })

  it('is not sequential — two consecutive numbers differ', () => {
    // 🔴 The DECISION, not a detail: a sequential number leaks the store's
    // order volume to anyone who places two orders and subtracts.
    const many = new Set(Array.from({ length: 200 }, () => orderNumberCandidate(DAY)))
    expect(many.size).toBeGreaterThan(190)
  })
})

describe('🔴 the date must come from the DATABASE, and a bad one fails LOUDLY', () => {
  it.each([
    ['empty', ''],
    ['not a date', 'not-a-date'],
    ['too short', '2026813'],
    ['an ISO date with separators', '2026-08-13'],
    ['undefined', undefined as unknown as string],
  ])('rejects %s rather than substituting a local clock', (_label, bad) => {
    // ⚠️ Falling back to a locally-computed date here is the exact bug the
    // parameter exists to remove, and it would be INVISIBLE — the number would
    // still look right. The app process and Postgres are two different clocks.
    expect(() => orderNumberCandidate(bad)).toThrow(/YYYYMMDD/)
  })
})

describe('🔴 the collision path — the machinery that had never run', () => {
  it('retries past a taken number and returns the first free one', async () => {
    const isTaken = vi
      .fn<(candidate: string) => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false)

    const result = await generateOrderNumber(isTaken, DAY)

    expect(isTaken).toHaveBeenCalledTimes(3)
    expect(result).toMatch(/^VS-20260813-[A-HJ-NP-Z2-9]{6}$/)
    // The number returned is the one that was CHECKED, not a fresh draw.
    expect(isTaken).toHaveBeenLastCalledWith(result)
  })

  it('🔴 gives up after the bound and throws — it does not loop forever', async () => {
    // Every candidate taken. At ~1e9 per day that is not luck, it is a broken
    // generator or a broken uniqueness check, and a loop would hide it behind
    // a hung request.
    const isTaken = vi.fn(async () => true)

    await expect(generateOrderNumber(isTaken, DAY)).rejects.toThrow(/not bad luck/)
    expect(isTaken).toHaveBeenCalledTimes(MAX_ORDER_NUMBER_ATTEMPTS)
  })

  it('🔴 never returns a number it was told was taken', async () => {
    // The failure that must never happen: reusing a number. A shopper can retry
    // a failed checkout; support cannot untangle two orders answering to one
    // name.
    const taken = new Set<string>()
    const isTaken = vi.fn(async (candidate: string) => {
      if (taken.size < 2) {
        taken.add(candidate)
        return true
      }
      return false
    })

    const result = await generateOrderNumber(isTaken, DAY)
    expect(taken.has(result)).toBe(false)
  })
})
