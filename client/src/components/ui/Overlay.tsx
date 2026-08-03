type OverlayProps = {
  /** Click-outside dismissal. Omit for a dialog that must not close by clicking away. */
  onDismiss?: () => void
  className?: string
}

/**
 * The scrim behind a modal panel — `--scrim`, DESIGN_SYSTEM.md §3
 * (DEC-039). Purely presentational: it carries no ARIA role and is
 * aria-hidden, because the background it covers is already made
 * unreachable by `inert` (§8 obligation 4), not by this element.
 *
 * It is NOT the accessible way to close the dialog either — that is the
 * close button and Escape, both of which Modal always provides. Clicking
 * the scrim is a convenience for pointer users only, which is why
 * onDismiss is optional and no keyboard handler is attached here.
 */
export function Overlay({ onDismiss, className = '' }: OverlayProps) {
  return (
    <div
      aria-hidden="true"
      onClick={onDismiss}
      className={`fixed inset-0 z-[var(--z-overlay)] bg-scrim ${className}`}
    />
  )
}
