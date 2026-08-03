import { createRefCounter } from './refCounter'

/**
 * Refcount + remembered body styles for the overlay scroll lock.
 * DOM-free: it holds the values but never reads or writes document.body.
 * hooks/useScrollLock.ts is the only place that touches the element.
 */

/**
 * The exact inline values body carried before the first overlay locked it.
 * Captured as strings — restoring '' is NOT equivalent to restoring the
 * original when a stylesheet or another script set them deliberately.
 *
 * paddingInlineEnd, not paddingRight: replacing the scrollbar's width has
 * to follow the writing direction, and Hebrew RTL puts the scrollbar on
 * the left (DESIGN_SYSTEM.md §11 — logical properties only).
 */
export type BodyScrollSnapshot = {
  overflow: string
  paddingInlineEnd: string
}

export const scrollLockState = createRefCounter<BodyScrollSnapshot>()
