import { describe, expect, it } from 'vitest'
import { createRefCounter } from './refCounter'

/**
 * The arithmetic behind both the body scroll lock and background inertness.
 * Pure by construction: it never touches the DOM, it only answers "is this
 * the transition that should apply or undo the effect, and what was the
 * state before?". Applying that answer is the hooks' job.
 *
 * Refcounting rather than a boolean is what makes rapid open/close and
 * StrictMode's double-invoked effects safe.
 *
 * release() returns a WRAPPER ({ snapshot }) rather than the snapshot
 * itself, so "nothing to undo yet" (null) stays distinguishable from "undo
 * now, and the previous state was undefined" — which is exactly the case
 * for inertness, whose snapshot type is undefined.
 */

type Snapshot = { overflow: string }

describe('createRefCounter', () => {
  it('starts released', () => {
    const counter = createRefCounter<Snapshot>()
    expect(counter.count()).toBe(0)
  })

  it('tells the first acquirer to apply the effect', () => {
    const counter = createRefCounter<Snapshot>()
    expect(counter.acquire({ overflow: 'visible' })).toBe(true)
    expect(counter.count()).toBe(1)
  })

  /** Second overlay must not re-apply, or it would snapshot the LOCKED state. */
  it('tells subsequent acquirers not to re-apply', () => {
    const counter = createRefCounter<Snapshot>()
    counter.acquire({ overflow: 'visible' })

    expect(counter.acquire({ overflow: 'hidden' })).toBe(false)
    expect(counter.count()).toBe(2)
  })

  it('returns nothing to restore while overlays remain open', () => {
    const counter = createRefCounter<Snapshot>()
    counter.acquire({ overflow: 'visible' })
    counter.acquire({ overflow: 'hidden' })

    expect(counter.release()).toBeNull()
    expect(counter.count()).toBe(1)
  })

  it('returns the original snapshot when the last overlay closes', () => {
    const counter = createRefCounter<Snapshot>()
    counter.acquire({ overflow: 'visible' })
    counter.acquire({ overflow: 'hidden' })
    counter.release()

    expect(counter.release()).toEqual({ snapshot: { overflow: 'visible' } })
    expect(counter.count()).toBe(0)
  })

  /**
   * The failure this guards against: restoring a hardcoded '' instead of
   * whatever the page actually had. A page that set overflow deliberately
   * must get exactly that value back.
   */
  it('restores the first snapshot verbatim, never a later one', () => {
    const counter = createRefCounter<Snapshot>()
    counter.acquire({ overflow: 'scroll' })
    counter.acquire({ overflow: 'hidden' })
    counter.release()

    expect(counter.release()).toEqual({ snapshot: { overflow: 'scroll' } })
  })

  it('ignores a release that was never paired with an acquire', () => {
    const counter = createRefCounter<Snapshot>()

    expect(counter.release()).toBeNull()
    expect(counter.count()).toBe(0)
  })

  it('never lets the count go negative on repeated stray releases', () => {
    const counter = createRefCounter<Snapshot>()
    counter.release()
    counter.release()

    expect(counter.count()).toBe(0)
    // A real acquire after stray releases must still apply the effect.
    expect(counter.acquire({ overflow: 'visible' })).toBe(true)
  })

  it('applies again after a full acquire/release cycle', () => {
    const counter = createRefCounter<Snapshot>()
    counter.acquire({ overflow: 'visible' })
    counter.release()

    expect(counter.acquire({ overflow: 'auto' })).toBe(true)
    expect(counter.release()).toEqual({ snapshot: { overflow: 'auto' } })
  })

  /** Rapid open/close: ten balanced pairs must leave nothing latched. */
  it('stays balanced across repeated rapid cycles', () => {
    const counter = createRefCounter<Snapshot>()

    for (let i = 0; i < 10; i += 1) {
      counter.acquire({ overflow: 'visible' })
      counter.release()
    }

    expect(counter.count()).toBe(0)
  })

  /**
   * Inertness needs the refcount but carries no state to restore. The
   * wrapper is what keeps its "undo now" signal readable.
   */
  it('supports an undefined snapshot for effects with nothing to restore', () => {
    const counter = createRefCounter<undefined>()

    expect(counter.acquire(undefined)).toBe(true)
    expect(counter.acquire(undefined)).toBe(false)
    expect(counter.release()).toBeNull()
    expect(counter.release()).toEqual({ snapshot: undefined })
    expect(counter.count()).toBe(0)
  })

  it('isolates counters from one another', () => {
    const a = createRefCounter<Snapshot>()
    const b = createRefCounter<Snapshot>()

    a.acquire({ overflow: 'visible' })

    expect(b.count()).toBe(0)
    expect(b.acquire({ overflow: 'hidden' })).toBe(true)
  })
})
