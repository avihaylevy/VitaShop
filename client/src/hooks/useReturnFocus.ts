import { useEffect, useRef, type RefObject } from 'react'

type UseReturnFocusOptions = {
  open: boolean
  /** Explicit trigger. Falls back to whatever was focused when the overlay opened. */
  returnFocusRef?: RefObject<HTMLElement | null>
}

/**
 * A trigger must be a live element inside the app wrapper.
 *
 * Rejecting anything else is what makes the capture survive React's
 * StrictMode replay. StrictMode runs setup, cleanup, then setup again; by
 * that second setup the focus trap has already moved focus to the panel's
 * close button, which lives in the portal OUTSIDE #root. Without this
 * check the re-capture records that close button — an element that is
 * detached moments later — and the real trigger is lost.
 *
 * <body> is rejected for a related reason: it is what activeElement
 * reports when nothing is focused, which happens whenever an overlay is
 * opened programmatically, and in Firefox and Safari where clicking a
 * button does not focus it. Storing it would defeat the isConnected check
 * and then focus() would silently no-op.
 */
function isPlausibleTrigger(element: Element | null): element is HTMLElement {
  if (!element || element === document.body) return false
  if (!element.isConnected) return false
  return document.getElementById('root')?.contains(element) ?? false
}

/**
 * DOM adapter for DESIGN_SYSTEM.md §8 obligation 3 — on close, focus
 * returns to the control that opened the dialog.
 *
 * 🔴 Must be called BEFORE useFocusTrap and useBackgroundInert in the
 * consuming component. Effects run in call order, so this one captures
 * document.activeElement while it is still the trigger — before the trap
 * moves focus into the panel, and before `inert` blurs whatever is focused
 * inside #root.
 */
export function useReturnFocus({ open, returnFocusRef }: UseReturnFocusOptions): void {
  const triggerRef = useRef<HTMLElement | null>(null)
  // Read inside the effect so a caller's inline ref object cannot retrigger it.
  const explicitRef = useRef(returnFocusRef)
  explicitRef.current = returnFocusRef

  useEffect(() => {
    if (!open) return

    const candidate = explicitRef.current?.current ?? document.activeElement

    // Only overwrite on a plausible candidate. An implausible one means
    // this is StrictMode's replay rather than a fresh open, and the
    // trigger already recorded is the one worth keeping.
    if (isPlausibleTrigger(candidate)) {
      triggerRef.current = candidate
    }

    return () => {
      const trigger = triggerRef.current
      // Deliberately NOT cleared here: StrictMode's cleanup is followed
      // immediately by another setup, and clearing would discard the
      // trigger just before the replay declines to re-capture it. A real
      // re-open overwrites it above.

      /*
       * 🔴 Deferred deliberately — restoring focus synchronously does not
       * work, and fails silently.
       *
       * React runs effect cleanups in declaration order, and this hook is
       * declared before useBackgroundInert so that the capture above
       * happens before #root becomes inert. That same ordering means this
       * cleanup runs while #root is STILL inert, and an element inside an
       * inert subtree cannot take focus. Both the trigger and the #main
       * fallback live inside #root, so a synchronous restore silently
       * no-ops and leaves focus on <body>.
       *
       * A microtask runs after the whole synchronous cleanup pass, by
       * which point useBackgroundInert has removed `inert`.
       */
      queueMicrotask(() => {
        // The trigger can be gone by now — a route change, or a control
        // rendered away while the overlay was open.
        if (trigger?.isConnected) {
          trigger.focus()
          // focus() is a request, not a guarantee: a disabled or hidden
          // element leaves focus on <body>.
          if (document.activeElement !== document.body) return
        }

        // Fallback: the main landmark. It carries tabIndex={-1} for
        // exactly this (and for the skip link).
        document.getElementById('main')?.focus()
      })
    }
  }, [open])
}
