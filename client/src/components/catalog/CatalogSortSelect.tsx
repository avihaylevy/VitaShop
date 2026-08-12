import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { FOCUS_RING } from '../ui/focusRing'
import { CATALOG_SORT_VALUES } from '../../features/catalog/catalogQueryControls'

type CatalogSortSelectProps = {
  /** The raw `sort` value from the URL — may be an unrecognized string (§5 faithful pass-through). */
  value: string
  onChange: (sort: string) => void
  className?: string
}

/**
 * MILESTONE-005 Checkpoint I — §10: "a labelled native `<select>` preferred
 * over a custom listbox". Native gives keyboard, screen-reader and mobile
 * behaviour for free; nothing here reimplements a listbox.
 *
 * An unrecognized `sort` in the URL (which `catalogUrlState.ts` deliberately
 * passes through rather than coercing, so the server's 400 can surface) is
 * NOT silently displayed as the default: the select renders no matching
 * option and falls back to showing nothing selected, which is the honest
 * representation of "this URL asks for a sort that does not exist". The
 * value is never rewritten here.
 */
export function CatalogSortSelect({ value, onChange, className = '' }: CatalogSortSelectProps) {
  const { t } = useTranslation('catalog')
  const selectId = useId()

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <label htmlFor={selectId} className="whitespace-nowrap text-sm text-text-muted">
        {t('sort.label')}
      </label>
      <select
        id={selectId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`${FOCUS_RING} h-11 rounded-compact border border-border-control bg-well px-3 text-base text-text-ink`}
      >
        {CATALOG_SORT_VALUES.map((sortValue) => (
          <option key={sortValue} value={sortValue}>
            {t(`sort.${sortValue}`)}
          </option>
        ))}
      </select>
    </div>
  )
}
