/**
 * Shared refcount arithmetic for document-level effects that several
 * overlays may want at once — the body scroll lock and background
 * inertness. DOM-free by construction: it decides WHETHER to apply or undo
 * an effect and remembers what preceded it, but never performs either.
 * The hooks under src/hooks/ do that.
 *
 * Why a count and not a boolean: two overlays open together must not have
 * the first one to close undo the effect for both, and StrictMode invokes
 * every effect twice. A boolean gets both cases wrong.
 */

/**
 * Non-null so that `null` unambiguously means "not the last release".
 * Without the wrapper, a counter whose snapshot type is `undefined` (the
 * inert counter) could not distinguish the two.
 */
type Released<T> = { snapshot: T }

export type RefCounter<T> = {
  /**
   * Registers one holder.
   *
   * @param snapshot state to restore later. Kept ONLY when this is the
   *   first acquire — a later caller's snapshot would describe the state
   *   after the effect was already applied.
   * @returns true when the caller should apply the effect.
   */
  acquire: (snapshot: T) => boolean
  /**
   * Deregisters one holder. A release with no matching acquire is ignored
   * rather than driving the count negative.
   *
   * @returns the wrapped original snapshot when the last holder let go and
   *   the caller should undo the effect, otherwise null.
   */
  release: () => Released<T> | null
  count: () => number
}

export function createRefCounter<T>(): RefCounter<T> {
  let count = 0
  // Only meaningful while count > 0; the `held` flag avoids relying on a
  // sentinel value, since T itself may legitimately be undefined.
  let held = false
  let snapshot: T | undefined

  return {
    acquire(next: T): boolean {
      count += 1
      if (count > 1) return false

      snapshot = next
      held = true
      return true
    },

    release(): Released<T> | null {
      if (count === 0) return null

      count -= 1
      if (count > 0) return null

      const restored = held ? (snapshot as T) : (undefined as T)
      snapshot = undefined
      held = false
      return { snapshot: restored }
    },

    count(): number {
      return count
    },
  }
}
