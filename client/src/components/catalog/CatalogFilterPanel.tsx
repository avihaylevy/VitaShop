import { useEffect, useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { ChevronDownIcon } from '../icons'
import { VisuallyHidden } from '../ui/VisuallyHidden'
import { FOCUS_RING } from '../ui/focusRing'
import {
  MAX_VALUES_PER_REPEATABLE_PARAMETER,
  type DietaryFilterKey,
  type DietaryOptionModel,
  type FilterGroupModel,
  type RepeatableFilterKey,
} from '../../features/catalog/catalogQueryControls'

/*
 * ISSUE-050 / ISSUE-051 — a big group is a DISCLOSURE, not a wall.
 *
 * Measured (2026-08-13): the active-ingredient group was 2776px tall at 49
 * products — taller than every other group combined, twice over — and it
 * buried the dosage-form/brand groups the user then reported as "missing".
 * REQ-F-011 forbids REMOVING either spec-required group, so the redesign is
 * containment: a group whose option count reaches COLLAPSED_GROUP_MIN_OPTIONS
 * renders collapsed behind its own expand button (auto-open when the URL
 * already selects in it — arriving state is never hidden), and a group big
 * enough to need it (SEARCHABLE_GROUP_MIN_OPTIONS) gets a typeahead that
 * narrows the checkbox list client-side. Filtering the LIST display only —
 * the submitted values are untouched, §3.4 unthreatened.
 *
 * Thresholds: brand (8) and dosage form (5) stay open — they were never the
 * problem; health goal (9) and active ingredient (53) collapse; only the
 * ingredient list is big enough to warrant the typeahead.
 */
const COLLAPSED_GROUP_MIN_OPTIONS = 9
const SEARCHABLE_GROUP_MIN_OPTIONS = 16

function FilterGroup({
  group,
  onToggleValue,
}: {
  group: FilterGroupModel
  onToggleValue: (key: RepeatableFilterKey, value: string) => void
}) {
  const { t } = useTranslation('catalog')
  const regionId = useId()
  const collapsible = group.options.length >= COLLAPSED_GROUP_MIN_OPTIONS
  // Auto-open when the URL already selects here: a shared/bookmarked filter
  // link must land with its own state visible, not folded away.
  const [open, setOpen] = useState(!collapsible || group.selectedCount > 0)
  const searchable = group.options.length >= SEARCHABLE_GROUP_MIN_OPTIONS
  const [query, setQuery] = useState('')

  const trimmed = query.trim().toLowerCase()
  const visibleOptions =
    searchable && trimmed.length > 0
      ? group.options.filter((option) => option.label.toLowerCase().includes(trimmed))
      : group.options

  const label = t(`filters.${group.key}`)

  const options = (
    <>
      {group.atCeiling && (
        <p className="mb-2 text-xs text-text-muted">
          {t('filters.ceilingHint', { max: MAX_VALUES_PER_REPEATABLE_PARAMETER })}
        </p>
      )}

      {searchable && (
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('filters.searchGroup')}
          aria-label={t('filters.searchGroup')}
          className={`${FOCUS_RING} mb-2 h-9 w-full rounded-compact border border-border-control bg-well px-3 text-sm text-text-ink`}
        />
      )}

      <div className="flex flex-col gap-2">
        {visibleOptions.map((option) => (
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
        {searchable && visibleOptions.length === 0 && (
          <p className="text-sm text-text-muted">{t('filters.searchNoMatch')}</p>
        )}
      </div>
    </>
  )

  if (!collapsible) {
    return (
      <fieldset className="min-w-0 border-0 p-0">
        <legend className="mb-2 text-sm font-semibold text-text-ink">{label}</legend>
        {options}
      </fieldset>
    )
  }

  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? regionId : undefined}
        onClick={() => setOpen((value) => !value)}
        className={`${FOCUS_RING} flex min-h-11 w-full items-center justify-between gap-2 rounded-compact text-sm font-semibold text-text-ink`}
      >
        <span>
          {label}
          {group.selectedCount > 0 && <span aria-hidden="true"> ({group.selectedCount})</span>}
          {group.selectedCount > 0 && (
            <VisuallyHidden>{t('filters.groupSelectedCount', { count: group.selectedCount })}</VisuallyHidden>
          )}
        </span>
        <Icon size={14} className={`transition-transform duration-150 ease-standard ${open ? 'rotate-180' : ''}`}>
          <ChevronDownIcon />
        </Icon>
      </button>
      {open && (
        <fieldset id={regionId} className="mt-2 min-w-0 border-0 p-0">
          {/* The group name still reaches assistive tech as the FIELDSET's
              name — the disclosure button above is chrome, not the group. */}
          <legend className="sr-only">{label}</legend>
          {options}
        </fieldset>
      )}
    </div>
  )
}

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

/*
 * ISSUE-086 — 🔴 `step` IS NO LONGER A MIRROR OF THE SERVER, AND THAT IS A
 * DELIBERATE, APPROVED NARROWING (user, 2026-08-13).
 *
 * At `0.01` the spinner moved the price one agora per click, so reaching a
 * useful bound took hundreds of clicks — and no seeded product is priced in
 * single agorot, so the control was finer than the data it filters.
 *
 * ⚠️ ONE ATTRIBUTE CONTROLS TWO THINGS. `step` sets the arrow increment AND
 * `stepMismatch` validation, so raising it makes the browser refuse a
 * hand-typed `95.55` that the server's `DECIMAL_PATTERN` still accepts. This
 * is the client being STRICTER than the server, which the note above warns
 * about in the opposite direction — it blocks input rather than letting a
 * doomed request leave.
 *
 * The trade was put to the user with all three options (this · `step="any"`,
 * which removes the spinner ISSUE-048 added · explicit ±₪1 buttons beside a
 * `0.01` input) and this one was chosen. 🔴 `min` and `max` still mirror the
 * server exactly; only `step` diverges.
 */
const PRICE_INPUT_STEP = '0.1'

type CatalogFilterPanelProps = {
  groups: readonly FilterGroupModel[]
  onToggleValue: (key: RepeatableFilterKey, value: string) => void
  /**
   * DEC-078/DEC-083 — the ingredient group's replacement. Offer-gated by the
   * facets payload (an empty list renders no fieldset at all), labels are the
   * server's own; only the boolean param key is ever submitted.
   */
  dietaryOptions: readonly DietaryOptionModel[]
  onDietaryChange: (key: DietaryFilterKey, checked: boolean) => void
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
  dietaryOptions,
  onDietaryChange,
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
      {/*
        🔴 DEC-078 — the active-ingredient group is NOT OFFERED, by the
        user's decision (a knowing REQ-F-011 deviation, recorded). The API
        still accepts the `ingredient` parameter; a URL carrying one still
        filters and still counts on the trigger badge — the panel just no
        longer renders the group. Its replacement (kosher · gluten-free ·
        vegan) lands with the ISSUE-124 enrichment wave's sourced data.
      */}
      {groups.map((group) =>
        group.key === 'ingredient' || group.options.length === 0 ? null : (
          <FilterGroup key={group.key} group={group} onToggleValue={onToggleValue} />
        ),
      )}

      {/*
        DEC-078/DEC-083 — the ingredient group's replacement: kosher ·
        gluten-free · vegan, boolean params matching sourced-true rows only.
        Offer-gated: a flag with no sourced data is not in `dietaryOptions`
        and renders nothing (§9d / the ISSUE-051 empty-filter lesson).
      */}
      {dietaryOptions.length > 0 && (
        <fieldset className="min-w-0 border-0 p-0">
          <legend className="mb-2 text-sm font-semibold text-text-ink">{t('filters.dietary')}</legend>
          <div className="flex flex-col gap-1">
            {dietaryOptions.map((option) => (
              <label
                key={option.key}
                className="flex min-h-11 items-center gap-2 text-sm text-text-ink"
              >
                <input
                  type="checkbox"
                  checked={option.checked}
                  onChange={(event) => onDietaryChange(option.key, event.target.checked)}
                  className={`${FOCUS_RING} size-4 shrink-0 rounded-compact border border-border-control accent-brand-teal`}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
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
