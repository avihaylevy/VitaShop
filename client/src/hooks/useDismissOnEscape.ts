import { useEffect, useRef } from 'react'
import { isTopmost } from '../lib/overlayStack'

type UseDismissOnEscapeOptions = {
  open: boolean
  overlayId: string
  onClose: () => void
}

/**
 * DOM adapter for DESIGN_SYSTEM.md §8 obligation 2 — Escape dismisses the
 * dialog from anywhere inside it.
 *
 * Listens on document rather than the panel so Escape works even when
 * focus has been moved somewhere unexpected, which is why the isTopmost
 * gate matters: with two overlays open, one Escape must close one dialog.
 */
export function useDismissOnEscape({ open, overlayId, onClose }: UseDismissOnEscapeOptions): void {
  // Callers almost always pass an inline arrow, which changes identity on
  // every render. Holding it in a ref keeps the listener attached once per
  // open instead of being torn down and re-added on each render.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      if (!isTopmost(overlayId)) return

      event.preventDefault()
      onCloseRef.current()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, overlayId])
}
