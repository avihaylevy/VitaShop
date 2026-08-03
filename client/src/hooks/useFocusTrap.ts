import { useEffect, type RefObject } from 'react'
import { FOCUSABLE_SELECTOR, nextFocusIndex } from '../lib/focusables'
import { isTopmost } from '../lib/overlayStack'

type UseFocusTrapOptions = {
  open: boolean
  overlayId: string
  containerRef: RefObject<HTMLElement | null>
  /** Where focus lands on open. Defaults to the container itself. */
  initialFocusRef?: RefObject<HTMLElement | null>
}

/**
 * DOM adapter for DESIGN_SYSTEM.md §8 obligation 1 — Tab and Shift+Tab
 * cycle within the dialog, and focus moves into it on open. The index
 * arithmetic lives in lib/focusables.ts; every DOM query and .focus() call
 * lives here, and is manual-verified rather than unit tested.
 *
 * 🔴 Boundary-only interception, carried over deliberately from the
 * pre-migration MobileMenu. When focus is mid-list the browser's own Tab
 * handling is left alone, because the native tab order is authoritative
 * and FOCUSABLE_SELECTOR's document order is only an approximation of it
 * (a positive tabindex would diverge). Only the wrap points, where the
 * browser would leave the dialog, are intercepted.
 */
export function useFocusTrap({ open, overlayId, containerRef, initialFocusRef }: UseFocusTrapOptions): void {
  useEffect(() => {
    if (!open) return

    const containerOrNull = containerRef.current
    if (!containerOrNull) return
    // Rebound so the non-null type survives into handleKeyDown's closure.
    const container: HTMLElement = containerOrNull

    // Default to the panel, which carries tabIndex={-1}: a screen reader
    // then announces the dialog role and its title before the first
    // control. Callers wanting a specific control pass initialFocusRef —
    // MobileMenu passes its close button, preserving shipped behaviour.
    const initialTarget = initialFocusRef?.current ?? container
    initialTarget.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Tab') return
      if (!isTopmost(overlayId)) return

      const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))

      // An empty dialog still traps: Tab must not escape to the inert
      // background, so it is swallowed and focus stays on the panel.
      if (nodes.length === 0) {
        event.preventDefault()
        container.focus()
        return
      }

      const currentIndex = nodes.indexOf(document.activeElement as HTMLElement)

      // -1 means focus is on the panel itself rather than a listed
      // control. Shift+Tab from there would leave the dialog entirely, and
      // plain Tab is ambiguous, so both are handled explicitly.
      const isOutsideList = currentIndex === -1
      const wrapsForward = !event.shiftKey && currentIndex === nodes.length - 1
      const wrapsBackward = event.shiftKey && currentIndex === 0

      if (!isOutsideList && !wrapsForward && !wrapsBackward) return

      event.preventDefault()
      const targetIndex = nextFocusIndex(currentIndex, nodes.length, event.shiftKey)
      nodes[targetIndex]?.focus()
    }

    // Re-queried on every keypress rather than captured once, so controls
    // added while the dialog is open take part in the cycle.
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, overlayId, containerRef, initialFocusRef])
}
