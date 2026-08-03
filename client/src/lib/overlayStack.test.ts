import { afterEach, describe, expect, it } from 'vitest'
import { depth, isTopmost, pop, push, reset } from './overlayStack'

afterEach(() => {
  reset()
})

describe('overlayStack', () => {
  it('reports an empty stack before anything opens', () => {
    expect(depth()).toBe(0)
    expect(isTopmost('anything')).toBe(false)
  })

  it('makes a single overlay topmost', () => {
    push('a')
    expect(depth()).toBe(1)
    expect(isTopmost('a')).toBe(true)
  })

  /** The whole point: a stacked overlay must silence the one beneath it. */
  it('gives topmost to the most recently pushed overlay only', () => {
    push('a')
    push('b')
    push('c')

    expect(depth()).toBe(3)
    expect(isTopmost('c')).toBe(true)
    expect(isTopmost('b')).toBe(false)
    expect(isTopmost('a')).toBe(false)
  })

  it('restores topmost to the overlay beneath when the top one closes', () => {
    push('a')
    push('b')
    pop('b')

    expect(depth()).toBe(1)
    expect(isTopmost('a')).toBe(true)
    expect(isTopmost('b')).toBe(false)
  })

  /**
   * React does not guarantee sibling unmount order, so an overlay in the
   * middle can be removed first. The survivors must keep their relative
   * order rather than the stack collapsing to "last pushed wins".
   */
  it('removes an overlay from the middle without disturbing the rest', () => {
    push('a')
    push('b')
    push('c')
    pop('b')

    expect(depth()).toBe(2)
    expect(isTopmost('c')).toBe(true)
    expect(isTopmost('a')).toBe(false)

    pop('c')
    expect(isTopmost('a')).toBe(true)
  })

  it('ignores popping an id that was never pushed', () => {
    push('a')
    pop('ghost')

    expect(depth()).toBe(1)
    expect(isTopmost('a')).toBe(true)
  })

  it('ignores a double pop of the same id', () => {
    push('a')
    push('b')
    pop('b')
    pop('b')

    expect(depth()).toBe(1)
    expect(isTopmost('a')).toBe(true)
  })

  /**
   * StrictMode double-invokes effects: push/pop/push must leave exactly
   * one entry, and a repeated push must not create a duplicate that a
   * single pop would fail to clear.
   */
  it('survives StrictMode double mounting without duplicating an entry', () => {
    push('a')
    push('a')
    expect(depth()).toBe(1)

    pop('a')
    expect(depth()).toBe(0)
    expect(isTopmost('a')).toBe(false)
  })

  it('keeps a re-pushed id at the top rather than at its old position', () => {
    push('a')
    push('b')
    push('a')

    expect(depth()).toBe(2)
    expect(isTopmost('a')).toBe(true)
  })
})
