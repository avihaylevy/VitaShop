import { useRef, type ReactNode, type RefObject } from 'react'
import { Modal } from './Modal'
import { usePresence } from '../../hooks/usePresence'

type CenterDialogProps = {
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
 * DEC-089a follow-up (user, 2026-08-16): a CENTERED compact dialog — the
 * cart asked for this shape instead of the edge-pinned Drawer ("centered
 * and smaller, not from the side").
 *
 * Drawer's sibling, same division of labour: Modal owns every §8
 * obligation (trap, Escape, scrim dismiss, scroll lock, inertness, focus
 * return), this file adds geometry and motion ONLY — a fade+scale in
 * place of Drawer's slide. `usePresence` keeps it mounted through the
 * exit so those obligations hold until it is actually gone.
 *
 * Geometry: centered both axes, `max-w-md` with p-4 gutters (never edge
 * to edge, even at 320px), capped at 85dvh with Modal's own scrollable
 * body taking the overflow. rounded + shadow + a hairline border so the
 * panel reads as a card above the scrim rather than a bleed-through
 * (the "blend" half of the report).
 */
export function CenterDialog({ open, onClose, children, ...modalProps }: CenterDialogProps) {
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
      containerClassName="items-center justify-center p-4"
      scrimClassName={`transition-opacity ease-standard duration-[var(--dur)] motion-reduce:transition-none ${
        isOpen ? 'opacity-100' : 'opacity-0'
      }`}
      panelClassName={`w-full max-w-md max-h-[85dvh] overflow-hidden rounded-card border border-border-hairline bg-well shadow-xl transition-[opacity,transform] ease-standard duration-[var(--dur)] motion-reduce:transition-none ${
        isOpen ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
      }`}
    >
      {children}
    </Modal>
  )
}
