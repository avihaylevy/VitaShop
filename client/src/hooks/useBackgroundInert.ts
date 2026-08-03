import { useEffect } from 'react'
import { inertState } from '../lib/inertState'

/**
 * DOM adapter for DESIGN_SYSTEM.md §8 obligation 4 — the obligation that
 * existed nowhere in this codebase before Slice 4.
 *
 * `inert` and not `aria-hidden`: §8 is explicit that "aria-hidden alone
 * does not block focus". `inert` removes the subtree from the tab order,
 * from the accessibility tree, and from pointer events in one attribute.
 *
 * The target is #root — the app wrapper. Overlays portal into
 * document.body, which is #root's SIBLING, so making #root inert never
 * reaches the overlay itself. Anything portalled elsewhere under #root
 * would be caught by this and must not be.
 *
 * Refcounted so the first of two stacked overlays to close does not
 * un-inert the background while the other is still open. Arithmetic lives
 * in lib/inertState.ts; this file is the only place that sets the property.
 */
export function useBackgroundInert(active: boolean): void {
  useEffect(() => {
    if (!active) return

    const appRoot = document.getElementById('root')
    // No wrapper, nothing to make inert. Returning before acquire() keeps
    // the count balanced — there is no cleanup to mismatch it.
    if (!appRoot) return

    if (inertState.acquire(undefined)) {
      appRoot.inert = true
    }

    return () => {
      if (inertState.release()) {
        appRoot.inert = false
      }
    }
  }, [active])
}
