import { useId, useRef, type ReactNode, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { CloseIcon } from '../icons'
import { IconButton } from './IconButton'
import { Overlay } from './Overlay'
import { Portal } from './Portal'
import { useBackgroundInert } from '../../hooks/useBackgroundInert'
import { useDismissOnEscape } from '../../hooks/useDismissOnEscape'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useOverlayId } from '../../hooks/useOverlayId'
import { useReturnFocus } from '../../hooks/useReturnFocus'
import { useScrollLock } from '../../hooks/useScrollLock'

type ModalProps = {
  open: boolean
  onClose: () => void
  /** Required: every dialog is labelled. Rendered as the panel's heading. */
  title: string
  /** Keeps the title as the accessible name while hiding it visually. */
  titleVisuallyHidden?: boolean
  /** Optional supporting text, wired to aria-describedby. */
  description?: string
  /** Defaults to common:dialog.close. Pass one to preserve an existing label. */
  closeLabel?: string
  /**
   * Receives the built-in close button. Pass the SAME ref as
   * initialFocusRef to open with focus on the close control.
   */
  closeButtonRef?: RefObject<HTMLButtonElement | null>
  /** Where focus lands on open. Defaults to the panel itself. */
  initialFocusRef?: RefObject<HTMLElement | null>
  /** Explicit return target. Defaults to whatever was focused on open. */
  returnFocusRef?: RefObject<HTMLElement | null>
  /** Scrim + click-outside. Off for an opaque full-screen panel. */
  scrim?: boolean
  /** Extra classes on the scrim — used by Drawer for its fade. */
  scrimClassName?: string
  /**
   * The panel element. Supply one when the caller needs the node itself
   * (Drawer watches it for `transitionend`); Modal uses it for the focus
   * trap either way.
   */
  panelRef?: RefObject<HTMLDivElement | null>
  /**
   * 🔴 REPLACES the default container layout, never merges with it.
   * Appending would leave two equal-specificity utilities (`p-0` vs `p-4`)
   * to be resolved by stylesheet order — exactly the bug behind ISSUE-021.
   * Structural classes (fixed, inset-0, z, flex) are always applied.
   */
  containerClassName?: string
  /** REPLACES the default panel appearance, for the same reason. */
  panelClassName?: string
  children: ReactNode
}

/** Layout only. `fixed inset-0 z-... flex` is structural and always applied. */
const DEFAULT_CONTAINER_LAYOUT = 'items-center justify-center p-4 md:p-7'

/** Appearance only. Flex/focus behaviour is structural and always applied. */
const DEFAULT_PANEL_APPEARANCE =
  'max-h-full w-full max-w-xl overflow-hidden rounded-card border border-border-hairline bg-well'

/**
 * 🔴 The single implementation of DESIGN_SYSTEM.md §8's four obligations:
 * focus trap, Escape closes, focus returns to the trigger, background
 * inert. UI_IMPLEMENTATION_PLAN.md §9: "Implemented once in `Modal`,
 * inherited by `Drawer`. Not reimplemented per-usage."
 *
 * Declaring role="dialog" aria-modal="true" without those behaviours is
 * worse than not declaring them, because assistive technology is told the
 * background is unavailable when it is not. That is why the ARIA and the
 * behaviour ship in the same component and cannot be taken separately.
 *
 * Unmounts when closed rather than hiding: there is no exit animation to
 * wait for, and an unmounted panel cannot leak focus or listeners.
 */
export function Modal({
  open,
  onClose,
  title,
  titleVisuallyHidden = false,
  description,
  closeLabel,
  closeButtonRef,
  initialFocusRef,
  returnFocusRef,
  scrim = true,
  scrimClassName = '',
  panelRef,
  containerClassName,
  panelClassName,
  children,
}: ModalProps) {
  const { t } = useTranslation('common')
  const internalPanelRef = useRef<HTMLDivElement>(null)
  const resolvedPanelRef = panelRef ?? internalPanelRef
  const titleId = useId()
  const descriptionId = useId()

  const overlayId = useOverlayId(open)

  // Order matters: useReturnFocus must capture the trigger before
  // useFocusTrap moves focus into the panel. Effects run in call order.
  useReturnFocus({ open, returnFocusRef })
  useFocusTrap({ open, overlayId, containerRef: resolvedPanelRef, initialFocusRef })
  useDismissOnEscape({ open, overlayId, onClose })
  useScrollLock(open)
  useBackgroundInert(open)

  if (!open) return null

  return (
    <Portal>
      <div
        className={`fixed inset-0 z-[var(--z-modal)] flex ${containerClassName ?? DEFAULT_CONTAINER_LAYOUT}`}
      >
        {scrim && <Overlay onDismiss={onClose} className={scrimClassName} />}

        <div
          ref={resolvedPanelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
          // Makes the panel itself a focus target without putting it in the
          // tab sequence — FOCUSABLE_SELECTOR excludes tabindex="-1".
          tabIndex={-1}
          className={`relative z-[var(--z-modal)] flex flex-col focus:outline-none ${panelClassName ?? DEFAULT_PANEL_APPEARANCE}`}
        >
          <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border-hairline px-4 py-3">
            <h2
              id={titleId}
              className={titleVisuallyHidden ? 'sr-only' : 'text-base font-semibold text-text-ink'}
            >
              {title}
            </h2>
            <IconButton
              ref={closeButtonRef}
              icon={<CloseIcon />}
              aria-label={closeLabel ?? t('dialog.close')}
              onClick={onClose}
              className="shrink-0"
            />
          </div>

          {description && (
            <p id={descriptionId} className="px-4 pt-3 text-sm text-text-muted">
              {description}
            </p>
          )}

          {/* overscroll-contain — reaching the end of this scroll must not
              start scrolling the page behind the overlay (mobile chaining). */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        </div>
      </div>
    </Portal>
  )
}
