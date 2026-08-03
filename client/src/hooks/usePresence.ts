import { useEffect, useRef, useState, type RefObject } from 'react'
import { parseCssDuration } from '../lib/cssDuration'

export type PresencePhase = 'entering' | 'open' | 'exiting'

export type Presence = {
  /** Keep rendering. Stays true through the exit transition. */
  isMounted: boolean
  phase: PresencePhase
}

/**
 * Last-resort value only, used when --dur cannot be read. It mirrors
 * DESIGN_SYSTEM.md §3's `--dur: 200ms`; the token is the source of truth
 * and is read at runtime, so this is never the normal path.
 */
const FALLBACK_DURATION_MS = 200

/**
 * Added to the token duration before the fallback timer fires, so the
 * timer only ever wins when `transitionend` genuinely never arrives —
 * never in a race with a transition that is about to complete normally.
 */
const TRANSITION_GRACE_MS = 50

/**
 * Which transitionend events mean "the drawer has finished leaving".
 *
 * `transform` alone is not enough, and assuming it was is a real trap:
 * Tailwind v4's translate utilities animate the standalone `translate`
 * property, and `transition-transform` expands to
 * `transition-property: transform, translate, scale, rotate`. Verified in
 * the built CSS. Listening only for `transform` matches nothing, so the
 * safety timer silently becomes the only mechanism — the drawer still
 * works, which is precisely why the mistake would go unnoticed.
 */
const EXIT_TRANSITION_PROPERTIES = new Set(['transform', 'translate'])

function readMotionDuration(): number {
  const declared = getComputedStyle(document.documentElement).getPropertyValue('--dur')
  return parseCssDuration(declared, FALLBACK_DURATION_MS)
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Keeps an element mounted through its exit transition.
 *
 * Deliberately narrow — this is not an animation framework. It answers one
 * question: may the overlay unmount yet? That matters because Modal ties
 * background inertness, the scroll lock, the focus trap and focus return
 * to being mounted. Unmounting the instant `open` flips false would undo
 * all four while the drawer is still on screen, and would return focus to
 * the trigger mid-slide.
 *
 * Exit completion is detected with `transitionend` on the panel, because
 * the transition's real duration is a CSS concern. The timer behind it is
 * a safety net, not the mechanism: `transitionend` does not fire when the
 * transition never starts — a display:none ancestor, an unchanged
 * transform, an interrupted transition — and without the net the drawer
 * would stay mounted forever with the background inert.
 *
 * Under prefers-reduced-motion there is no transition to wait for, so the
 * unmount is immediate (UI_IMPLEMENTATION_PLAN.md §12: the drawer still
 * opens, it just does not slide).
 */
export function usePresence(open: boolean, nodeRef: RefObject<HTMLElement | null>): Presence {
  const [isMounted, setIsMounted] = useState(open)
  const [phase, setPhase] = useState<PresencePhase>(open ? 'open' : 'exiting')

  // Lets the closing branch tell "never opened" from "open, now closing"
  // without adding isMounted to the effect's dependencies, which would
  // re-run the exit logic on its own state change.
  const isMountedRef = useRef(isMounted)
  isMountedRef.current = isMounted

  useEffect(() => {
    if (open) {
      setIsMounted(true)
      setPhase('entering')

      // Two frames: the first lets React commit the panel in its closed
      // transform, the second flips it. Within one frame the browser
      // collapses both states into the final one and no transition runs.
      let innerFrame = 0
      const outerFrame = requestAnimationFrame(() => {
        innerFrame = requestAnimationFrame(() => setPhase('open'))
      })

      return () => {
        cancelAnimationFrame(outerFrame)
        cancelAnimationFrame(innerFrame)
      }
    }

    // Closed and never opened: nothing to tear down, and setting state
    // here would mount the panel just to unmount it.
    if (!isMountedRef.current) return

    if (prefersReducedMotion()) {
      setPhase('exiting')
      setIsMounted(false)
      return
    }

    setPhase('exiting')

    const node = nodeRef.current
    let settled = false

    function finish() {
      if (settled) return
      settled = true
      setIsMounted(false)
    }

    function handleTransitionEnd(event: TransitionEvent) {
      // Ignore transitions bubbling up from content inside the panel, and
      // any property other than the ones that actually move it.
      if (event.target !== node) return
      if (!EXIT_TRANSITION_PROPERTIES.has(event.propertyName)) return
      finish()
    }

    node?.addEventListener('transitionend', handleTransitionEnd)
    const timer = window.setTimeout(finish, readMotionDuration() + TRANSITION_GRACE_MS)

    return () => {
      node?.removeEventListener('transitionend', handleTransitionEnd)
      window.clearTimeout(timer)
    }
  }, [open, nodeRef])

  return { isMounted, phase }
}
