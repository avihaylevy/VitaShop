import type { ReactNode } from 'react'

type ToastProps = {
  /** The already-translated text; the toast renders nothing when empty. */
  children: ReactNode
  visible: boolean
  /**
   * Vertical slot. 'header' clears the two-row header; 'below-header' sits
   * one toast-height lower so the two app toasts (welcome, add-to-cart)
   * never overlap when both fire inside one six-second window.
   */
  slot?: 'header' | 'below-header'
}

/**
 * THE one toast shell — extracted from WelcomeToast when AddedToCartToast
 * arrived as a byte-for-byte copy (review of the fifth-list diff): one
 * owner for the wrapper, the bubble, the shadow and the entrance keyframe.
 *
 * 🔴 NON-INTERACTIVE by contract — no close button. A dismiss control
 * unmounts itself on use and drops focus to <body>: the unmount-takes-focus
 * family. Toasts leave on their own.
 *
 * 🔴 The role="status" wrapper is ALWAYS mounted (the live-region rule):
 * the announcement comes from a region that already existed. Entrance
 * motion is motion-safe-gated.
 *
 * top-32 (128px): the visible header's bottom edge measures ~118px after
 * the fifth list's taller nav row (h-12) — re-measured 2026-08-15; the
 * toast clears it with a gap at both breakpoints.
 */
export function Toast({ children, visible, slot = 'header' }: ToastProps) {
  return (
    <div
      role="status"
      className={`pointer-events-none fixed inset-x-0 ${
        slot === 'header' ? 'top-32' : 'top-44'
      } z-[var(--z-dropdown)] flex justify-center px-4`}
    >
      {visible && (
        <p className="rounded-card border border-border-hairline bg-well px-4 py-2 text-sm font-medium text-text-ink shadow-[0_8px_24px_rgba(31,37,46,0.12)] motion-safe:animate-[toast-in_200ms_var(--ease-standard)]">
          {children}
        </p>
      )}
    </div>
  )
}
