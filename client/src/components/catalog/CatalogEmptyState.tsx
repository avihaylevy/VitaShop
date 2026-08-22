import { textLinkClass } from '../ui/TextLink'

interface CatalogEmptyStateAction {
  label: string
  onClick: () => void
}

interface CatalogEmptyStateProps {
  heading: string
  message: string
  action?: CatalogEmptyStateAction
}

/**
 * Presentational shell only — Slice 9 Checkpoint B §6. Content-driven:
 * the caller (`CatalogPage`) resolves already-translated heading/message/
 * action text per its own state (catalog-empty, filtered-empty, or the
 * invalid-category shell reuse, §8) — this component knows none of those
 * state names, does not call `useTranslation`, and does not decide which
 * variant applies. `action` is omitted entirely for catalog-empty
 * (Checkpoint A: "informational only, no action"); when present it never
 * carries an implicit navigation — the caller passes a plain callback.
 */
export function CatalogEmptyState({ heading, message, action }: CatalogEmptyStateProps) {
  return (
    <div className="mt-4 flex flex-col items-start gap-3">
      <h2 className="heading-section">{heading}</h2>
      <p className="text-sm text-text-muted">{message}</p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className={textLinkClass()}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
