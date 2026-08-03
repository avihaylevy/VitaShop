import { useEffect, useRef } from 'react'

/**
 * Tailwind's `md`. DESIGN_SYSTEM.md §10 lists 375 · 768 · 1024 · 1440.
 *
 * This duplicates the value Tailwind uses for the `md:hidden` class that
 * hides the mobile header, and the two must agree: if they drift, the
 * hamburger disappears at one width while the menu keeps itself open past
 * another. Tailwind v4 exposes no breakpoint custom property to read at
 * runtime, so a matching literal is the only option — flagged here rather
 * than left silent.
 */
const DESKTOP_QUERY = '(min-width: 768px)'

/**
 * Closes a mobile-only overlay when the viewport grows past `md`.
 *
 * The defect this fixes: `MobileMenu`'s container is `md:hidden`, so
 * resizing from mobile to desktop while it is open leaves a `display:none`
 * dialog mounted — and with it `inert` on #root and the body scroll lock.
 * The page is then unusable with no visible cause.
 *
 * It only ever closes. Growing past the breakpoint dismisses the menu;
 * shrinking back below it does nothing, because a menu must never open
 * itself.
 *
 * 🔴 No cleanup logic lives here. It flips the caller's open state and
 * Modal's existing unmount path does the rest — releasing inert, restoring
 * body styles, and returning focus (which safely falls back to #main,
 * since the hamburger is `display:none` and unfocusable at desktop width).
 * Duplicating any of that here is exactly the per-usage reimplementation
 * DESIGN_SYSTEM.md §8 warns against.
 */
export function useCloseAboveBreakpoint(open: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return

    const query = window.matchMedia(DESKTOP_QUERY)

    // Already past the breakpoint when it opened — possible if the menu is
    // opened programmatically, or if the resize happened between renders.
    if (query.matches) {
      onCloseRef.current()
      return
    }

    function handleChange(event: MediaQueryListEvent) {
      if (event.matches) onCloseRef.current()
    }

    query.addEventListener('change', handleChange)
    return () => query.removeEventListener('change', handleChange)
  }, [open])
}
