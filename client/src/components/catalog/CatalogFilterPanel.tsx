import { useEffect, useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/Button'
import { FOCUS_RING } from '../ui/focusRing'
import {
  MAX_VALUES_PER_REPEATABLE_PARAMETER,
  type FilterGroupModel,
  type RepeatableFilterKey,
} from '../../features/catalog/catalogQueryControls'

/*
 * ISSUE-048 — constraint attributes for the price inputs.
 *
 * 🔴 These MIRROR the server, they do not define the rule. `catalogQuery.ts`
 * is the authority: `MAX_PRICE_CENTS = 99_999_99` (₪99,999.99) and
 * `DECIMAL_PATTERN` allows at most two decimal places, which is what `step`
 * encodes. §3.4 — the client is not a source of truth, so these only make the
 * browser's own validation agree with the server's instead of letting a
 * doomed request leave at all.
 *
 * ⚠️ DUPLICATED VALUE, and worth naming as such: this is the same shape as
 * ISSUE-044's CATEGORY_EN. The server constant is not exported across the
 * package boundary, and inventing a different limit here would be worse than
 * restating this one — a client max BELOW the server's would silently block
 * valid input. If the server bound ever changes, this must change with it.
 */
const PRICE_INPUT_MIN = '0'
const PRICE_INPUT_MAX = '99999.99'
const PRICE_INPUT_STEP = '0.01'

type CatalogFilterPanelProps = {
  groups: readonly FilterGroupModel[]
  onToggleValue: (key: RepeatableFilterKey, value: string) => void
  /** Raw URL values — passed through untouched, never coerced (§5). */
  minPrice: string
  maxPrice: string
  onPriceCommit: (next: { minPrice: string; maxPrice: string }) => void
  inStockChecked: boolean
  onInStockChange: (checked: boolean) => void
  onClear: () => void
  clearDisabled: boolean
  className?: string
}

/**
 * MILESTONE-005 Checkpoint I — the filter surface (§10).
 *
 * - Native `<fieldset>`/`<legend>` + native checkboxes: the grouping is
 *   conveyed SEMANTICALLY, never by layout alone.
 * - 🔴 Labels render the facet label; the value submitted is always the
 *   stable ID (§4b). `buildFilterGroups` is what pairs them — this component
 *   never derives a value from a label.
 * - An empty facet group renders no fieldset at all, so the UI never offers
 *   a filter that can match nothing (§9d).
 * - §12a's ceiling is surfaced, not enforced by truncation: at 10 selected
 *   values the remaining unchecked boxes in THAT group are disabled (each
 *   group independently) and the hint is shown. Checked boxes always stay
 *   enabled so the user can never get stuck.
 * - Toggling a filter navigates immediately but does not move focus — the
 *   control keeps its identity across the re-render, so the checkbox the
 *   user just operated stays focused (§10).
 *
 * Presentation only: it holds no query state. Price inputs keep a local
 * DRAFT purely so typing does not navigate per keystroke; the draft is
 * re-synced from the URL whenever the committed value changes, and committed
 * on blur or Enter.
 */
export function CatalogFilterPanel({
  groups,
  onToggleValue,
  minPrice,
  maxPrice,
  onPriceCommit,
  inStockChecked,
  onInStockChange,
  onClear,
  clearDisabled,
  className = '',
}: CatalogFilterPanelProps) {
  const { t } = useTranslation('catalog')
  const minId = useId()
  const maxId = useId()
  const [minDraft, setMinDraft] = useState(minPrice)
  const [maxDraft, setMaxDraft] = useState(maxPrice)

  useEffect(() => {
    setMinDraft(minPrice)
  }, [minPrice])

  useEffect(() => {
    setMaxDraft(maxPrice)
  }, [maxPrice])

  function commitPrice(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    if (minDraft === minPrice && maxDraft === maxPrice) return
    onPriceCommit({ minPrice: minDraft, maxPrice: maxDraft })
  }

  return (
    <div className={`flex flex-col gap-6 ${className}`}>
      {groups.map((group) =>
        group.options.length === 0 ? null : (
          <fieldset key={group.key} className="min-w-0 border-0 p-0">
            <legend className="mb-2 text-sm font-semibold text-text-ink">{t(`filters.${group.key}`)}</legend>

            {group.atCeiling && (
              <p className="mb-2 text-xs text-text-muted">
                {t('filters.ceilingHint', { max: MAX_VALUES_PER_REPEATABLE_PARAMETER })}
              </p>
            )}

            <div className="flex flex-col gap-2">
              {group.options.map((option) => (
                <label
                  key={option.value}
                  className={`flex min-h-11 items-center gap-2 text-sm ${
                    option.disabled ? 'text-text-muted' : 'text-text-ink'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={option.checked}
                    disabled={option.disabled}
                    onChange={() => onToggleValue(group.key, option.value)}
                    className={`${FOCUS_RING} size-4 shrink-0 rounded-compact border border-border-control accent-brand-teal`}
                  />
                  <span className="min-w-0 break-words">{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ),
      )}

      <fieldset className="min-w-0 border-0 p-0">
        <legend className="mb-2 text-sm font-semibold text-text-ink">{t('filters.price')}</legend>
        {/*
          A nested form is the standard way to give two text inputs an
          Enter-to-commit affordance without a visible button; a blur commits
          too, so a user who tabs away never loses what they typed. Submitting
          it cannot submit an outer form — the catalogue page has none around
          this panel.
        */}
        <form onSubmit={commitPrice} className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor={minId} className="text-xs text-text-muted">
              {t('filters.minPrice')}
            </label>
            <input
              id={minId}
              /*
               * 🔴 ISSUE-048. Was `type="text"`, so the field had no stepper
               * controls, no arrow-key increment and no native range
               * validation. `inputMode="decimal"` was already correct and is
               * kept — it drives the TOUCH keyboard, which `type` does not.
               */
              type="number"
              min={PRICE_INPUT_MIN}
              max={PRICE_INPUT_MAX}
              step={PRICE_INPUT_STEP}
              inputMode="decimal"
              dir="ltr"
              value={minDraft}
              onChange={(event) => setMinDraft(event.target.value)}
              onBlur={() => commitPrice()}
              className={`${FOCUS_RING} h-11 w-24 rounded-compact border border-border-control bg-well px-3 text-base text-text-ink`}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor={maxId} className="text-xs text-text-muted">
              {t('filters.maxPrice')}
            </label>
            <input
              id={maxId}
              type="number"
              min={PRICE_INPUT_MIN}
              max={PRICE_INPUT_MAX}
              step={PRICE_INPUT_STEP}
              inputMode="decimal"
              dir="ltr"
              value={maxDraft}
              onChange={(event) => setMaxDraft(event.target.value)}
              onBlur={() => commitPrice()}
              className={`${FOCUS_RING} h-11 w-24 rounded-compact border border-border-control bg-well px-3 text-base text-text-ink`}
            />
          </div>
        </form>
      </fieldset>

      <fieldset className="min-w-0 border-0 p-0">
        <legend className="mb-2 text-sm font-semibold text-text-ink">{t('filters.availability')}</legend>
        <label className="flex min-h-11 items-center gap-2 text-sm text-text-ink">
          <input
            type="checkbox"
            checked={inStockChecked}
            onChange={(event) => onInStockChange(event.target.checked)}
            className={`${FOCUS_RING} size-4 shrink-0 rounded-compact border border-border-control accent-brand-teal`}
          />
          <span>{t('filters.inStock')}</span>
        </label>
      </fieldset>

      <Button type="button" variant="secondary" onClick={onClear} disabled={clearDisabled}>
        {t('filters.clear')}
      </Button>
    </div>
  )
}
