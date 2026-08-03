import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'

/**
 * Renders children into document.body.
 *
 * Not cosmetic: the overlay must sit OUTSIDE #root, because
 * useBackgroundInert marks #root inert. An overlay rendered in place —
 * as MobileMenu was, inside <header> — would be inside the subtree it just
 * disabled, and would become unreachable the moment it opened.
 *
 * Escaping ancestor overflow, transform and stacking contexts is a second
 * benefit: a `fixed` panel is positioned against the nearest transformed
 * ancestor, not the viewport, so an in-place overlay is one CSS transform
 * away from being mispositioned.
 */
export function Portal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body)
}
