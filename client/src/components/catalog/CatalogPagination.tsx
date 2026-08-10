import { useTranslation } from 'react-i18next'
import { FOCUS_RING } from '../ui/focusRing'
import { VisuallyHidden } from '../ui/VisuallyHidden'
import { buildPaginationSlots } from '../../features/catalog/catalogQueryControls'

type CatalogPaginationProps = {
  /** The page the SERVER reported for the rendered results, never the in-flight one. */
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  className?: string
}

/**
 * MILESTONE-005 Checkpoint I — §10: "`<nav>` with an accessible name;
 * `aria-current="page"`; real controls, never bare clickable text."
 *
 * Every page target is a real `<button>` (44px minimum hit area), so keyboard
 * and assistive tech get button semantics without any ARIA patching. The
 * omitted-range marker is `aria-hidden` decoration — it is not a control and
 * must not appear in the tab order or be announced as one.
 *
 * Renders nothing at all when there is a single page or none: one page is not
 * navigation, and an empty `<nav>` would still be announced as a landmark.
 */
export function CatalogPagination({ page, totalPages, onPageChange, className = '' }: CatalogPaginationProps) {
  const { t } = useTranslation('catalog')
  const slots = buildPaginationSlots(page, totalPages)

  if (slots.length === 0) return null

  const hasPrevious = page > 1
  const hasNext = page < totalPages

  const controlClass = `${FOCUS_RING} inline-flex min-h-11 min-w-11 items-center justify-center rounded-compact border px-3 text-sm disabled:cursor-not-allowed disabled:text-text-muted`

  return (
    <nav aria-label={t('pagination.navLabel')} className={`mt-8 ${className}`}>
      <ul className="flex flex-wrap items-center gap-2">
        <li>
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={!hasPrevious}
            className={`${controlClass} border-border-control bg-well text-text-ink`}
          >
            {t('pagination.previous')}
          </button>
        </li>

        {slots.map((slot, index) =>
          slot === 'gap' ? (
            // Keyed by position: a gap has no identity of its own, and two
            // gaps in one control are legitimately distinct positions.
            <li key={`gap-${index}`} aria-hidden="true" className="px-1 text-sm text-text-muted">
              {t('pagination.truncated')}
            </li>
          ) : (
            <li key={slot}>
              <button
                type="button"
                onClick={() => onPageChange(slot)}
                aria-current={slot === page ? 'page' : undefined}
                className={`${controlClass} ${
                  slot === page
                    ? 'border-brand-teal bg-brand-teal font-semibold text-white'
                    : 'border-border-control bg-well text-text-ink'
                }`}
              >
                {/*
                  The digit is VISUAL only — `aria-hidden`, so the button's
                  accessible name is the full translated "Page N" below
                  rather than a bare numeral read twice. `dir="ltr"` keeps
                  the numeral from being reordered by the bidi algorithm
                  inside Hebrew RTL (§10, LTR numeric isolation).
                */}
                <span dir="ltr" aria-hidden="true">
                  {slot}
                </span>
                <VisuallyHidden>{t('pagination.page', { page: slot })}</VisuallyHidden>
              </button>
            </li>
          ),
        )}

        <li>
          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={!hasNext}
            className={`${controlClass} border-border-control bg-well text-text-ink`}
          >
            {t('pagination.next')}
          </button>
        </li>
      </ul>
    </nav>
  )
}
