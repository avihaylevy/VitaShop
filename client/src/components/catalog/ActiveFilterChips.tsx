import { useTranslation } from 'react-i18next'
import type { CatalogFacetsDto } from '../../types/catalog'
import type { CatalogUrlState } from '../../features/catalog/catalogUrlState'
import { FOCUS_RING } from '../ui/focusRing'

/**
 * DEC-106 (the user, 2026-08-23, via the GPT shop review) — the applied
 * PANEL filters as removable chips under the chrome row, plus a short
 * clear action. The panel's filters were invisible once it closed: a
 * shopper who filtered by brand and forgot saw "no results" with no
 * visible cause. The URL already carries this state; the strip only
 * renders it.
 *
 * 🔴 SCOPE MATCHES THE FILTER BADGE, deliberately: panel filters only —
 * never `q` (its own visible field) and never `category` (the shelf). The
 * strip is the panel's contents made visible, so it must count exactly
 * what the badge counts. For the same reason "נקה סינון" clears ONLY the
 * panel filters — the panel's own "ניקוי כל המסננים" resets to a bare
 * /catalog (§5), but a strip that shows three chips and then also threw
 * away the category would clear more than it showed.
 *
 * Labels resolve from the SAME facets response the panel renders from —
 * ids never print. A value whose label cannot be resolved yet (facets
 * still loading, or a stale id the server will 400) renders no chip; the
 * strip states what it can name, nothing else.
 */

type ChipChange = Partial<CatalogUrlState>

type Chip = {
  key: string
  label: string
  /** The url-state change that removes exactly this value. */
  change: ChipChange
}

/** Every panel-scope filter reset to absent — the strip's clear action. */
export const PANEL_FILTERS_CLEARED: ChipChange = {
  brand: [],
  dosageForm: [],
  ingredient: [],
  healthGoal: [],
  minPrice: undefined,
  maxPrice: undefined,
  inStock: undefined,
  kosher: undefined,
  glutenFree: undefined,
  vegan: undefined,
}

export function ActiveFilterChips({
  urlState,
  facets,
  onChange,
}: {
  urlState: CatalogUrlState
  facets: CatalogFacetsDto
  onChange: (change: ChipChange) => void
}) {
  const { t, i18n } = useTranslation('catalog')
  const hebrew = i18n.language === 'he'

  const chips: Chip[] = []

  for (const id of urlState.brand) {
    const option = facets.brands.find((brand) => brand.id === id)
    if (!option) continue
    chips.push({
      key: `brand-${id}`,
      label: hebrew ? option.label : (option.labelEn ?? option.label),
      change: { brand: urlState.brand.filter((value) => value !== id) },
    })
  }
  for (const value of urlState.dosageForm) {
    const option = facets.dosageForms.find((form) => form.value === value)
    if (!option) continue
    chips.push({
      key: `dosageForm-${value}`,
      label: hebrew ? option.labelHe : option.labelEn,
      change: { dosageForm: urlState.dosageForm.filter((v) => v !== value) },
    })
  }
  for (const id of urlState.ingredient) {
    const option = facets.ingredients.find((ingredient) => ingredient.id === id)
    if (!option) continue
    chips.push({
      key: `ingredient-${id}`,
      label: option.label,
      change: { ingredient: urlState.ingredient.filter((value) => value !== id) },
    })
  }
  for (const id of urlState.healthGoal) {
    const option = facets.healthGoals.find((goal) => goal.id === id)
    if (!option) continue
    chips.push({
      key: `healthGoal-${id}`,
      label: hebrew ? option.labelHe : option.labelEn,
      change: { healthGoal: urlState.healthGoal.filter((value) => value !== id) },
    })
  }
  if (urlState.minPrice !== undefined && urlState.minPrice !== '') {
    chips.push({
      key: 'minPrice',
      label: t('filters.minPriceChip', { value: urlState.minPrice }),
      change: { minPrice: undefined },
    })
  }
  if (urlState.maxPrice !== undefined && urlState.maxPrice !== '') {
    chips.push({
      key: 'maxPrice',
      label: t('filters.maxPriceChip', { value: urlState.maxPrice }),
      change: { maxPrice: undefined },
    })
  }
  if (urlState.inStock !== undefined) {
    chips.push({ key: 'inStock', label: t('filters.inStock'), change: { inStock: undefined } })
  }
  for (const flag of ['kosher', 'glutenFree', 'vegan'] as const) {
    if (urlState[flag] === undefined) continue
    const option = facets.dietary.find((entry) => entry.value === flag)
    if (!option) continue
    chips.push({
      key: flag,
      label: hebrew ? option.labelHe : option.labelEn,
      change: { [flag]: undefined },
    })
  }

  if (chips.length === 0) return null

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="text-sm text-text-muted">{t('filters.activeLabel')}</span>
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={() => onChange(chip.change)}
          aria-label={t('filters.removeFilter', { label: chip.label })}
          // min-h-11 below md — the shelf/chrome touch-target rule; compact from md up.
          className={`${FOCUS_RING} inline-flex min-h-11 items-center gap-1.5 rounded-round border border-border-control bg-well px-3 text-sm text-text-ink transition-colors duration-150 ease-standard hover:border-brand-teal hover:text-brand-teal-strong md:min-h-9`}
        >
          {chip.label}
          <span aria-hidden="true" className="text-text-muted">
            ×
          </span>
        </button>
      ))}
      <button
        type="button"
        onClick={() => onChange(PANEL_FILTERS_CLEARED)}
        className={`${FOCUS_RING} inline-flex min-h-11 items-center rounded-compact px-1 text-sm text-brand-teal-strong underline underline-offset-2 hover:text-brand-teal md:min-h-9`}
      >
        {t('filters.clearShort')}
      </button>
    </div>
  )
}
