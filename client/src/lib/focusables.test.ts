import { describe, expect, it } from 'vitest'
import { FOCUSABLE_SELECTOR, nextFocusIndex } from './focusables'

/**
 * Pure arithmetic only. Anything that queries the DOM or calls .focus()
 * lives in hooks/useFocusTrap.ts and is NOT covered here — vitest runs in
 * the `node` environment (no jsdom), so a DOM assertion in this file would
 * be impossible, not merely absent. See UI_IMPLEMENTATION_PLAN.md §13:
 * real focus-trap traversal is Tier 2 and blocked on a dependency that
 * DEC-030 defers.
 */

describe('nextFocusIndex', () => {
  describe('Tab (forward)', () => {
    it('advances through the middle of the list', () => {
      expect(nextFocusIndex(0, 4, false)).toBe(1)
      expect(nextFocusIndex(2, 4, false)).toBe(3)
    })

    it('wraps from the last element back to the first', () => {
      expect(nextFocusIndex(3, 4, false)).toBe(0)
    })
  })

  describe('Shift+Tab (backward)', () => {
    it('retreats through the middle of the list', () => {
      expect(nextFocusIndex(3, 4, true)).toBe(2)
      expect(nextFocusIndex(1, 4, true)).toBe(0)
    })

    it('wraps from the first element round to the last', () => {
      expect(nextFocusIndex(0, 4, true)).toBe(3)
    })
  })

  describe('degenerate containers', () => {
    it('keeps a single focusable element focused in both directions', () => {
      expect(nextFocusIndex(0, 1, false)).toBe(0)
      expect(nextFocusIndex(0, 1, true)).toBe(0)
    })

    /**
     * An empty dialog cannot be trapped into. -1 is the caller's signal to
     * leave focus on the panel itself rather than focus nothing.
     */
    it('reports -1 when there is nothing focusable', () => {
      expect(nextFocusIndex(0, 0, false)).toBe(-1)
      expect(nextFocusIndex(0, 0, true)).toBe(-1)
    })

    /**
     * activeElement is often not in the list at all — focus may sit on the
     * panel (tabIndex={-1}) when Tab is first pressed. Forward from
     * "nowhere" must enter at the first element, backward at the last.
     */
    it('treats an index of -1 as entering the trap from outside', () => {
      expect(nextFocusIndex(-1, 3, false)).toBe(0)
      expect(nextFocusIndex(-1, 3, true)).toBe(2)
    })
  })
})

describe('FOCUSABLE_SELECTOR', () => {
  /**
   * Asserted literally rather than imported-and-compared, for the same
   * reason categoryTone.test.ts re-declares its mapping: a regression must
   * not be able to hide behind a matching re-export.
   */
  it('matches the selector the mobile menu shipped with', () => {
    expect(FOCUSABLE_SELECTOR).toBe(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
  })

  it('excludes tabindex="-1", which is what makes the panel itself skippable', () => {
    expect(FOCUSABLE_SELECTOR).toContain('[tabindex]:not([tabindex="-1"])')
  })
})
