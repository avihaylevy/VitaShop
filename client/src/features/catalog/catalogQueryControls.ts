/**
 * MILESTONE-005 Checkpoint I — pure presentation state for the catalogue
 * query controls (search · filters · sort · pagination). No React, no
 * hooks, no fetch, no routing, no i18n lookups, no side effects. Same input
 * -> same output, always.
 *
 * This module decides WHAT the controls should show for a given URL state +
 * facet payload. It never navigates and never talks to the server: turning a
 * user action into a URL is `catalogUrlState.ts`'s `nextCatalogUrlState`
 * (Checkpoint G, frozen), and issuing the request is `useCatalogData`'s job
 * (Checkpoint H, closed). Keeping the derivation here is what lets the whole
 * control surface be unit-tested without a DOM.
 *
 * 🔴 Filter VALUES are always the stable IDs the server contract requires
 * (§4b) — `Brand.id`, `ActiveIngredient.id`, `HealthGoal.id`, the
 * `dosageForm` enum identifier. Labels are for rendering only and never
 * submitted. That split is enforced by the types below: an option carries
 * both, and only `value` is ever written into the URL.
 */

import type { CatalogFacetsDto, DietaryFacetValue } from '../../types/catalog.js'
import type { SupportedLanguage } from '../../i18n/index.js'
import { isPresent, type CatalogUrlState } from './catalogUrlState.js'

/**
 * The four frozen §4 sort values, mirroring
 * `server/src/lib/catalogQuery.ts`'s `SORT_VALUES`. Declared here in the
 * order the UI offers them (default first, then price, then popularity)
 * rather than the server's declaration order — the set is identical, only
 * the presentation order differs, and the default matches
 * `catalogUrlState.ts`'s `DEFAULT_SORT`.
 */
export const CATALOG_SORT_VALUES = ['newest', 'price_asc', 'price_desc', 'popularity'] as const
export type CatalogSortValue = (typeof CATALOG_SORT_VALUES)[number]

export function isCatalogSortValue(value: string): value is CatalogSortValue {
  return (CATALOG_SORT_VALUES as readonly string[]).includes(value)
}

/**
 * §12a, frozen at Checkpoint A: max 10 values per repeatable parameter,
 * each ceiling independent, rejected — never truncated — server-side.
 * Mirrored here so the UI can stop a user at the ceiling instead of
 * letting them build a request that is guaranteed to 400. The UI never
 * truncates either: an 11th option is simply not selectable while 10 are
 * already checked, and every already-checked option stays unselectable-off
 * — i.e. it can always still be UNchecked.
 */
export const MAX_VALUES_PER_REPEATABLE_PARAMETER = 10

/** The four repeatable, ID-valued filter parameters (§4/§4b). */
export const REPEATABLE_FILTER_KEYS = ['brand', 'dosageForm', 'ingredient', 'healthGoal'] as const
export type RepeatableFilterKey = (typeof REPEATABLE_FILTER_KEYS)[number]

export interface FilterOptionModel {
  /** The stable ID (or enum identifier) submitted in the query string. */
  value: string
  /** Display text only — never submitted. */
  label: string
  checked: boolean
  /** True only for an UNCHECKED option in a group already at the §12a ceiling. */
  disabled: boolean
}

export interface FilterGroupModel {
  key: RepeatableFilterKey
  options: FilterOptionModel[]
  /** How many of this group's values the current URL state selects. */
  selectedCount: number
  /** True when this group has hit the §12a ceiling. */
  atCeiling: boolean
}

/**
 * Adds `value` to `values` when absent, removes it when present. Pure, order
 * preserving: an existing selection keeps its position, a new one is
 * appended. Order matters only for URL stability (repeated keys are emitted
 * in array order by `buildCatalogSearchParams`), never for semantics — the
 * server treats a repeatable parameter's values as a set (OR-within).
 */
export function toggleFilterValue(values: readonly string[], value: string): string[] {
  return values.includes(value) ? values.filter((candidate) => candidate !== value) : [...values, value]
}

function toGroup(
  key: RepeatableFilterKey,
  selected: readonly string[],
  options: readonly { value: string; label: string }[],
): FilterGroupModel {
  const atCeiling = selected.length >= MAX_VALUES_PER_REPEATABLE_PARAMETER
  return {
    key,
    selectedCount: selected.length,
    atCeiling,
    options: options.map((option) => {
      const checked = selected.includes(option.value)
      return {
        value: option.value,
        label: option.label,
        checked,
        // A checked option is never disabled — unchecking must always
        // remain possible, or a user could get stuck at the ceiling.
        disabled: atCeiling && !checked,
      }
    }),
  }
}

/**
 * Maps the §9d facet payload plus the current URL state into the exact
 * groups the filter UI renders, language-resolved.
 *
 * 🔴 A group with zero options is still returned (with an empty `options`
 * array) rather than dropped, so the caller decides how to present an
 * absent group; §9d already guarantees the server never offers an option
 * that can match nothing, so an empty group means "the active catalogue has
 * none of these", not "not loaded".
 */
export function buildFilterGroups(
  facets: CatalogFacetsDto,
  urlState: CatalogUrlState,
  language: SupportedLanguage,
): FilterGroupModel[] {
  return [
    toGroup(
      'brand',
      urlState.brand,
      // Sixth list item 1 — the same pick as everywhere nameEn travels
      // (mapCatalogProduct, cartDisplay): the English UI prefers the Latin
      // form, falling back to the stored name.
      facets.brands.map((brand) => ({
        value: brand.id,
        label: (language === 'en' ? brand.labelEn : null) ?? brand.label,
      })),
    ),
    toGroup(
      'dosageForm',
      urlState.dosageForm,
      // Dosage-form labels come from the server payload, matching the
      // catalog namespace's own `dosageForm` keys — not re-derived here,
      // so the two cannot disagree about which forms exist.
      facets.dosageForms.map((form) => ({
        value: form.value,
        label: language === 'he' ? form.labelHe : form.labelEn,
      })),
    ),
    toGroup(
      'ingredient',
      urlState.ingredient,
      facets.ingredients.map((ingredient) => ({ value: ingredient.id, label: ingredient.label })),
    ),
    toGroup(
      'healthGoal',
      urlState.healthGoal,
      facets.healthGoals.map((goal) => ({
        value: goal.id,
        label: language === 'he' ? goal.labelHe : goal.labelEn,
      })),
    ),
  ]
}

/**
 * The three DEC-078/DEC-083 dietary filter keys — re-exported from the DTO
 * type module, NOT restated: the facet payload's `value` and the URL-state
 * key are the same identifier by contract, and one list cannot drift from
 * the other if only one list exists.
 */
export type DietaryFilterKey = DietaryFacetValue

export interface DietaryOptionModel {
  key: DietaryFilterKey
  /** Server-owned facet label, language-resolved — never submitted. */
  label: string
  checked: boolean
}

/**
 * Maps the facets payload's `dietary` list plus the URL state into the
 * boolean dietary checkboxes. 🔴 Offer-gated by the server (§9d / the
 * ISSUE-051 lesson): a flag no active product carries simply is not in the
 * payload, so the checkbox does not exist — never a filter over empty data.
 * A URL carrying a param whose option is not offered still filters (the
 * server accepts it); only the control is absent, matching DEC-078's
 * ingredient precedent.
 */
export function buildDietaryOptions(
  facets: CatalogFacetsDto,
  urlState: CatalogUrlState,
  language: SupportedLanguage,
): DietaryOptionModel[] {
  // No re-filter here: `catalogApi`'s isCatalogFacetsDto already rejects any
  // payload whose dietary value is outside the frozen three, so `value` is
  // the union by the time it arrives.
  return facets.dietary.map((option) => ({
    key: option.value,
    label: language === 'he' ? option.labelHe : option.labelEn,
    checked: urlState[option.value] === 'true',
  }))
}

/**
 * 🔴 THE narrowing predicate — one definition, two consumers. True when the
 * URL carries at least one narrowing parameter; sort and page reorder or
 * paginate, so neither counts.
 *
 * `useCatalogData` imports this for its `hasNarrowingQuery` result field
 * (which feeds §9c's catalog-empty vs filtered-empty decision), and the UI
 * uses it to decide whether "Clear filters" has anything to clear. Those
 * two MUST agree: if they drifted, the resolver could report an empty
 * catalogue while the UI still offered to clear filters, or the reverse.
 * Checkpoint I correction, finding 2 — the predicate was previously written
 * out twice, which is the same defect shape as Checkpoint H's finding 2.
 *
 * Uses `isPresent` so an empty `?q=` counts as absent here too, matching
 * what `buildCatalogSearchParams` actually sends.
 */
export function hasActiveFilters(urlState: CatalogUrlState): boolean {
  return (
    isPresent(urlState.q) ||
    isPresent(urlState.category) ||
    urlState.brand.length > 0 ||
    urlState.dosageForm.length > 0 ||
    urlState.ingredient.length > 0 ||
    urlState.healthGoal.length > 0 ||
    isPresent(urlState.minPrice) ||
    isPresent(urlState.maxPrice) ||
    isPresent(urlState.inStock) ||
    isPresent(urlState.kosher) ||
    isPresent(urlState.glutenFree) ||
    isPresent(urlState.vegan)
  )
}

/**
 * How many values the FILTER PANEL itself currently holds — the number on
 * the mobile trigger's badge.
 *
 * 🔴 Deliberately excludes `q` and `category` (Checkpoint I correction,
 * finding 3). Both are narrowing parameters, but neither lives in the
 * panel: search has its own visible field and category its own shelf, both
 * on screen already. Counting them made the trigger promise something it
 * could not show — `/catalog?q=omega&category=vitamins` read "Filters (2)"
 * and announced "2 active filters", then opened onto a panel with nothing
 * selected. A badge is a claim about what is behind the control.
 *
 * This is NOT the narrowing predicate: `hasActiveFilters` above still
 * counts `q` and `category`, because "Clear filters" clears to a bare
 * `/catalog` (§5) — including both of them.
 */
export function activeFilterCount(urlState: CatalogUrlState): number {
  return (
    urlState.brand.length +
    urlState.dosageForm.length +
    urlState.ingredient.length +
    urlState.healthGoal.length +
    (isPresent(urlState.minPrice) ? 1 : 0) +
    (isPresent(urlState.maxPrice) ? 1 : 0) +
    (isPresent(urlState.inStock) ? 1 : 0) +
    (isPresent(urlState.kosher) ? 1 : 0) +
    (isPresent(urlState.glutenFree) ? 1 : 0) +
    (isPresent(urlState.vegan) ? 1 : 0)
  )
}

export type PaginationSlot = number | 'gap'

/**
 * The page slots a pagination control renders: always the first and last
 * page, always `current` with one neighbour either side, and a `'gap'`
 * marker wherever a run of pages is omitted.
 *
 * Returns `[]` when there is nothing to paginate (`totalPages <= 1`), so a
 * caller can render no `<nav>` at all rather than a one-page control — a
 * single page is not navigation.
 *
 * Defensive about inputs it should never see: a non-integer or out-of-range
 * `current` (e.g. a malformed `?page=abc`, which `catalogUrlState.ts`
 * deliberately parses to `NaN` rather than "correcting") still produces a
 * well-formed slot list, because §5a canonicalization only covers a
 * WELL-FORMED past-the-end page — a malformed one reaches the server and
 * 400s, and this control must not crash while that round trip is in flight.
 */
export function buildPaginationSlots(current: number, totalPages: number): PaginationSlot[] {
  if (!Number.isInteger(totalPages) || totalPages <= 1) return []

  const safeCurrent = Number.isInteger(current) ? Math.min(Math.max(current, 1), totalPages) : 1

  const shown = new Set<number>([1, totalPages, safeCurrent])
  if (safeCurrent - 1 >= 1) shown.add(safeCurrent - 1)
  if (safeCurrent + 1 <= totalPages) shown.add(safeCurrent + 1)

  const pages = [...shown].sort((a, b) => a - b)
  const slots: PaginationSlot[] = []
  let previous: number | undefined

  for (const page of pages) {
    // A single omitted page is rendered as that page, not as a gap — a
    // "…" standing for exactly one number is worse than the number.
    if (previous !== undefined && page - previous === 2) {
      slots.push(previous + 1)
    } else if (previous !== undefined && page - previous > 2) {
      slots.push('gap')
    }
    slots.push(page)
    previous = page
  }

  return slots
}
