import { useRef, type ReactNode, type RefObject } from 'react'
import { Modal } from './Modal'
import { usePresence } from '../../hooks/usePresence'

type DrawerProps = {
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
 * A modal dialog pinned to the inline-start edge — DESIGN_SYSTEM.md §11,
 * "the drawer enters from the inline-start (right) edge". Right in Hebrew
 * RTL, left in English LTR.
 *
 * 🔴 Adds geometry and motion ONLY. All four §8 obligations come from
 * Modal and are not touched here — UI_IMPLEMENTATION_PLAN.md §9:
 * "Implemented once in `Modal`, inherited by `Drawer`. Not reimplemented
 * per-usage."
 *
 * The one presence concern Drawer does own: it has an exit transition, so
 * it must outlive `open` becoming false. `usePresence` keeps it mounted
 * until the slide finishes, which keeps Modal's inertness, scroll lock and
 * focus trap in force until it is actually gone — and defers focus return
 * to the real unmount rather than firing it mid-slide.
 */
export function Drawer({ open, onClose, children, ...modalProps }: DrawerProps) {
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
      // items-stretch + justify-start pins the panel to the inline-start
      // edge at full height. `justify-start` is direction-aware; no
      // physical left/right anywhere.
      containerClassName="items-stretch justify-start"
      scrimClassName={`transition-opacity ease-standard duration-[var(--dur)] motion-reduce:transition-none ${
        isOpen ? 'opacity-100' : 'opacity-0'
      }`}
      /*
       * translateX is the one physical value here, and unavoidable: CSS has
       * no logical translate. It is made direction-aware with the `rtl:`
       * variant instead of a physical positioning property, so the panel
       * slides out through the edge it is pinned to in both directions.
       *
       * duration-[var(--dur)] reads DESIGN_SYSTEM.md §3's token rather than
       * repeating 200ms — the same value usePresence reads for its exit
       * fallback, so CSS and JS cannot drift apart.
       */
      /*
       * The 420px cap is md-gated, not unconditional: it must only apply
       * from the md breakpoint up. Ungated, it made the drawer 420px wide
       * on a 421–767px viewport instead of full width, leaving a strip of
       * scrim beside it that reads as a clipped panel. Below md it is
       * full-bleed; w-full alone can never exceed the viewport, so there
       * is no horizontal overflow either way.
       *
       * The gated class is written only in the template below, never
       * spelled out in prose here — Tailwind scans comments too, and an
       * ungated copy in a sentence emits a real, dead CSS rule.
       */
      panelClassName={`h-full w-full overflow-hidden border-e border-border-hairline bg-well transition-transform ease-standard duration-[var(--dur)] motion-reduce:transition-none md:max-w-[420px] ${
        isOpen ? 'translate-x-0' : '-translate-x-full rtl:translate-x-full'
      }`}
    >
      {children}
    </Modal>
  )
}
