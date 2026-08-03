import { useEffect, useId } from 'react'
import { pop, push } from '../lib/overlayStack'

/**
 * Registers an open overlay in the shared stack and hands back its id.
 *
 * DOM adapter only in the loosest sense — it touches no element, but it is
 * an effect and so is not unit tested; the arithmetic it drives lives in
 * lib/overlayStack.ts, which is.
 *
 * Escape and the Tab trap are document-level listeners, so with two
 * overlays open both would fire. Every handler gates on `isTopmost(id)`.
 */
export function useOverlayId(open: boolean): string {
  const id = useId()

  useEffect(() => {
    if (!open) return

    push(id)
    return () => pop(id)
  }, [open, id])

  return id
}
