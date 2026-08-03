import { useEffect } from 'react'
import { scrollLockState } from '../lib/scrollLockState'

/**
 * DOM adapter for the body scroll lock — DESIGN_SYSTEM.md §8 obligation 4,
 * the "not scrollable" half. The refcount arithmetic and the remembered
 * styles live in lib/scrollLockState.ts; this file is the only place that
 * reads or writes document.body, and is deliberately thin because it
 * cannot be unit tested in the `node` environment.
 */
export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return

    const body = document.body

    // The gap must be measured BEFORE overflow:hidden removes the
    // scrollbar, or it always measures 0 and the page jumps sideways.
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth

    const isFirstHolder = scrollLockState.acquire({
      overflow: body.style.overflow,
      paddingInlineEnd: body.style.paddingInlineEnd,
    })

    if (isFirstHolder) {
      body.style.overflow = 'hidden'
      // Logical, not paddingRight: Hebrew RTL puts the scrollbar on the
      // left (DESIGN_SYSTEM.md §11).
      if (scrollbarWidth > 0) {
        body.style.paddingInlineEnd = `${scrollbarWidth}px`
      }
    }

    return () => {
      const released = scrollLockState.release()
      if (!released) return

      // Restored verbatim — assigning '' would discard a value the page
      // set deliberately.
      body.style.overflow = released.snapshot.overflow
      body.style.paddingInlineEnd = released.snapshot.paddingInlineEnd
    }
  }, [active])
}
