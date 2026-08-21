import { useRef, type ReactNode, type RefObject } from 'react'
import { Modal } from './Modal'
import { usePresence } from '../../hooks/usePresence'

type ChatCardProps = {
  open: boolean
  onClose: () => void
  title: string
  titleVisuallyHidden?: boolean
  description?: string
  closeLabel?: string
  closeButtonRef?: RefObject<HTMLButtonElement | null>
  initialFocusRef?: RefObject<HTMLElement | null>
  returnFocusRef?: RefObject<HTMLElement | null>
  children: ReactNode
}

/**
 * ISSUE-146 — a floating conversation CARD anchored to the bottom
 * inline-end corner (where the agent FAB lives), replacing the full-height
 * edge drawer the user rejected for the assistant ("not a drawer — a form
 * that fits a chat").
 *
 * 🔴 The Drawer contract, verbatim: geometry and motion ONLY. All four §8
 * obligations (focus trap · Escape · focus return · background inert) come
 * from Modal and are not touched here — this is still a MODAL dialog with
 * a scrim, so the one-modal-at-a-time rule and the widget's focus-return
 * choreography keep holding unchanged.
 *
 * usePresence keeps the card mounted through its exit (rise-and-fade
 * reversed), exactly Drawer's reasoning: Modal's inertness and trap stay
 * in force until the card is actually gone.
 */
export function ChatCard({ open, onClose, children, ...modalProps }: ChatCardProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const { isMounted, phase } = usePresence(open, panelRef)

  if (!isMounted) return null

  const isOpen = phase === 'open'

  return (
    <Modal
      {...modalProps}
      open
      onClose={onClose}
      panelRef={panelRef}
      // Bottom inline-end corner — the FAB's own corner, both directions
      // (justify-end is direction-aware; no physical left/right).
      containerClassName="items-end justify-end p-3 md:p-5"
      scrimClassName={`transition-opacity ease-standard duration-[var(--dur)] motion-reduce:transition-none ${
        isOpen ? 'opacity-100' : 'opacity-0'
      }`}
      /*
       * A rounded card, capped in both axes: full width up to 400px, and
       * min(37.5rem, available height) tall — at 320px the card is simply
       * the viewport minus the container padding, no special casing. The
       * entrance rises from the FAB's corner (translate + fade); exit is
       * the same path reversed, watched by usePresence via transitionend.
       */
      panelClassName={`h-[min(37.5rem,100%)] w-full max-w-[400px] overflow-hidden rounded-2xl border border-border-hairline bg-well shadow-[0_24px_56px_rgb(31_37_46/0.28)] transition-[opacity,transform] ease-standard duration-[var(--dur)] motion-reduce:transition-none ${
        isOpen ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
      }`}
    >
      {children}
    </Modal>
  )
}
