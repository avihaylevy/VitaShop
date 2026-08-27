import type { ReactElement } from 'react'
import { TextLink, textLinkClass } from '../ui/TextLink'
import { Icon } from '../ui/Icon'
import { Surface } from '../ui/Surface'

/**
 * Two action shapes, discriminated on `to`:
 * - `onClick` — renders a <button>. Meant for in-place actions; note
 *   ISSUE-194: CatalogPage's current onClick callers actually navigate
 *   (goToAllProducts), a pre-existing button-pretending-to-be-a-link its
 *   a11y tests pin — converting them is that issue's work, not area 6's.
 * - `to` — a NAVIGATION; renders a real link (navigation is a link,
 *   never a button pretending — area 6 replaced FavouritesPage's
 *   navigate() button with this).
 *
 * The runtime branch checks the VALUE (`action.to !== undefined`), not
 * key presence: a caller that builds the object conditionally can own a
 * `to` key holding undefined, and an `in` check would hand TextLink an
 * undefined route.
 */
type CatalogEmptyStateAction =
  | { label: string; onClick: () => void; to?: never }
  | { label: string; to: string; onClick?: never }

interface CatalogEmptyStateProps {
  heading: string
  message: string
  action?: CatalogEmptyStateAction
  /** Decorative marker above the heading (area 6: the favourites heart) —
   *  a bare icon element; ui/Icon sizes it, so the element itself carries
   *  no width/height/stroke overrides. */
  icon?: ReactElement
  /**
   * Area 6 — the sparse-page treatment: a centered section surface instead
   * of the plain start-aligned stack. The catalog keeps the default: its
   * empty states sit inside an already-framed results region.
   */
  centered?: boolean
}

/**
 * Presentational shell only — Slice 9 Checkpoint B §6. Content-driven:
 * the caller (`CatalogPage`, `FavouritesPage`) resolves already-translated
 * heading/message/action text per its own state (catalog-empty,
 * filtered-empty, or the invalid-category shell reuse, §8) — this component
 * knows none of those state names, does not call `useTranslation`, and does
 * not decide which variant applies. `action` is omitted entirely for
 * catalog-empty (Checkpoint A: "informational only, no action").
 */
export function CatalogEmptyState({ heading, message, action, icon, centered = false }: CatalogEmptyStateProps) {
  const body = (
    <>
      {icon && (
        /* ui/Icon owns the decorative-icon contract (aria-hidden,
           inline-flex sizing — §12); a hand-rolled span here dropped the
           flex display and gained descender space under the svg
           (area-6 review finding). */
        <Icon size={44} className="text-text-muted">
          {icon}
        </Icon>
      )}
      <h2 className="heading-section">{heading}</h2>
      <p className={centered ? 'max-w-prose text-sm text-text-muted' : 'text-sm text-text-muted'}>{message}</p>
      {action &&
        (action.to !== undefined ? (
          <TextLink to={action.to} className={centered ? 'mt-1' : ''}>
            {action.label}
          </TextLink>
        ) : (
          <button type="button" onClick={action.onClick} className={textLinkClass()}>
            {action.label}
          </button>
        ))}
    </>
  )

  return centered ? (
    <Surface bordered className="mt-4 flex flex-col items-center gap-3 px-6 py-10 text-center">
      {body}
    </Surface>
  ) : (
    <div className="mt-4 flex flex-col items-start gap-3">{body}</div>
  )
}
