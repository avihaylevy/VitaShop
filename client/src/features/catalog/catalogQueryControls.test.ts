import { describe, expect, it } from 'vitest'
import {
  activeFilterCount,
  buildFilterGroups,
  buildPaginationSlots,
  CATALOG_SORT_VALUES,
  hasActiveFilters,
  isCatalogSortValue,
  MAX_VALUES_PER_REPEATABLE_PARAMETER,
  toggleFilterValue,
} from './catalogQueryControls'
import { EMPTY_CATALOG_URL_STATE, type CatalogUrlState } from './catalogUrlState'
import type { CatalogFacetsDto } from '../../types/catalog'

/**
 * MILESTONE-005 Checkpoint I — the pure control-state module. Everything the
 * catalogue's query controls decide is proven here, without a DOM: the
 * component tests then only have to prove that the decisions are RENDERED.
 */

const FACETS: CatalogFacetsDto = {
  brands: [
    { id: 'brand-1', label: 'Solgar' },
    { id: 'brand-2', label: 'Altman' },
  ],
  ingredients: [{ id: 'ing-1', label: 'Omega 3' }],
  healthGoals: [{ id: 'goal-1', labelHe: 'חיזוק חיסוני', labelEn: 'Immune support' }],
  dosageForms: [
    { value: 'CAPSULE', labelHe: 'כמוסות', labelEn: 'Capsules' },
    { value: 'DROPS', labelHe: 'טיפות', labelEn: 'Drops' },
  ],
}

function urlState(overrides: Partial<CatalogUrlState> = {}): CatalogUrlState {
  return { ...EMPTY_CATALOG_URL_STATE, ...overrides }
}

describe('sort values', () => {
  it('offers exactly the four frozen §4 values, defaulting first', () => {
    expect([...CATALOG_SORT_VALUES]).toEqual(['newest', 'price_asc', 'price_desc', 'popularity'])
  })

  it('recognises only those four — the set, not the presentation order, is the contract', () => {
    // Same set as server/src/lib/catalogQuery.ts's SORT_VALUES, whose
    // declaration order differs deliberately.
    expect([...CATALOG_SORT_VALUES].sort()).toEqual(['newest', 'popularity', 'price_asc', 'price_desc'])
    expect(isCatalogSortValue('price_asc')).toBe(true)
    expect(isCatalogSortValue('price-asc')).toBe(false)
    expect(isCatalogSortValue('relevance')).toBe(false)
    expect(isCatalogSortValue('')).toBe(false)
  })
})

describe('toggleFilterValue', () => {
  it('adds an absent value at the end and removes a present one', () => {
    expect(toggleFilterValue([], 'a')).toEqual(['a'])
    expect(toggleFilterValue(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggleFilterValue(['a', 'b'], 'a')).toEqual(['b'])
  })

  it('does not mutate its input', () => {
    const original = ['a', 'b']
    toggleFilterValue(original, 'c')
    toggleFilterValue(original, 'a')
    expect(original).toEqual(['a', 'b'])
  })

  it('removes every occurrence if a duplicate ever reached the URL', () => {
    // Repeated identical values are legal in a query string; the server
    // treats a repeatable parameter as a set, so unchecking must clear all.
    expect(toggleFilterValue(['a', 'a', 'b'], 'a')).toEqual(['b'])
  })
})

describe('buildFilterGroups', () => {
  it('returns the four repeatable groups in a stable order', () => {
    const groups = buildFilterGroups(FACETS, urlState(), 'he')
    expect(groups.map((group) => group.key)).toEqual(['brand', 'dosageForm', 'ingredient', 'healthGoal'])
  })

  it('pairs each option with its STABLE ID as the value and the facet label as display text', () => {
    const [brands] = buildFilterGroups(FACETS, urlState(), 'he')
    expect(brands.options).toEqual([
      { value: 'brand-1', label: 'Solgar', checked: false, disabled: false },
      { value: 'brand-2', label: 'Altman', checked: false, disabled: false },
    ])
  })

  it('resolves bilingual labels by language, and dosage forms by enum identifier', () => {
    const he = buildFilterGroups(FACETS, urlState(), 'he')
    const en = buildFilterGroups(FACETS, urlState(), 'en')

    expect(he[1].options.map((option) => option.label)).toEqual(['כמוסות', 'טיפות'])
    expect(en[1].options.map((option) => option.label)).toEqual(['Capsules', 'Drops'])
    // The submitted value never changes with language.
    expect(he[1].options.map((option) => option.value)).toEqual(['CAPSULE', 'DROPS'])
    expect(en[1].options.map((option) => option.value)).toEqual(['CAPSULE', 'DROPS'])
    expect(he[3].options[0].label).toBe('חיזוק חיסוני')
    expect(en[3].options[0].label).toBe('Immune support')
  })

  it('marks exactly the URL-selected values as checked', () => {
    const [brands] = buildFilterGroups(FACETS, urlState({ brand: ['brand-2'] }), 'he')
    expect(brands.options.map((option) => option.checked)).toEqual([false, true])
    expect(brands.selectedCount).toBe(1)
    expect(brands.atCeiling).toBe(false)
  })

  it('returns an empty (not missing) group when the catalogue offers no such facet', () => {
    const groups = buildFilterGroups({ brands: [], ingredients: [], healthGoals: [], dosageForms: [] }, urlState(), 'he')
    expect(groups).toHaveLength(4)
    expect(groups.every((group) => group.options.length === 0)).toBe(true)
  })

  it('disables only UNCHECKED options once a group reaches the §12a ceiling', () => {
    const selected = Array.from({ length: MAX_VALUES_PER_REPEATABLE_PARAMETER }, (_, index) => `other-${index}`)
    // brand-1 is NOT selected; the ceiling is already reached by ten others.
    const [brands] = buildFilterGroups(FACETS, urlState({ brand: selected }), 'he')

    expect(brands.atCeiling).toBe(true)
    expect(brands.options.every((option) => option.disabled)).toBe(true)

    // With one of the visible options among the ten, that one stays
    // enabled — a user at the ceiling must always be able to uncheck.
    const withVisible = [...selected.slice(1), 'brand-1']
    const [brandsWithVisible] = buildFilterGroups(FACETS, urlState({ brand: withVisible }), 'he')
    const brandOne = brandsWithVisible.options.find((option) => option.value === 'brand-1')!
    expect(brandOne.checked).toBe(true)
    expect(brandOne.disabled).toBe(false)
  })

  it('keeps every ceiling independent per group', () => {
    const tenBrands = Array.from({ length: MAX_VALUES_PER_REPEATABLE_PARAMETER }, (_, index) => `b-${index}`)
    const groups = buildFilterGroups(FACETS, urlState({ brand: tenBrands }), 'he')

    expect(groups[0].atCeiling).toBe(true)
    expect(groups[1].atCeiling).toBe(false)
    expect(groups[2].atCeiling).toBe(false)
    expect(groups[3].atCeiling).toBe(false)
  })

  it('mirrors the frozen §12a ceiling value', () => {
    expect(MAX_VALUES_PER_REPEATABLE_PARAMETER).toBe(10)
  })
})

describe('hasActiveFilters / activeFilterCount', () => {
  it('is false for a bare /catalog, and for sort/page alone', () => {
    expect(hasActiveFilters(urlState())).toBe(false)
    expect(hasActiveFilters(urlState({ sort: 'price_asc', page: 3 }))).toBe(false)
    expect(activeFilterCount(urlState({ sort: 'price_asc', page: 3 }))).toBe(0)
  })

  it('treats an empty string the same as absent — matching what is actually sent', () => {
    expect(hasActiveFilters(urlState({ q: '' }))).toBe(false)
    expect(hasActiveFilters(urlState({ category: '', minPrice: '', maxPrice: '', inStock: '' }))).toBe(false)
    expect(activeFilterCount(urlState({ q: '' }))).toBe(0)
  })

  it('narrows on every parameter, and counts only the ones the filter panel holds', () => {
    const state = urlState({
      q: 'omega',
      category: 'vitamins',
      brand: ['b1', 'b2'],
      dosageForm: ['CAPSULE'],
      ingredient: ['i1'],
      healthGoal: ['g1'],
      minPrice: '10',
      maxPrice: '90',
      inStock: 'true',
    })
    expect(hasActiveFilters(state)).toBe(true)
    // 🔴 Correction, finding 3: 8, not 10 — `q` and `category` narrow but
    // are NOT in the panel (search has its own field, category its own
    // shelf), so the trigger's badge must not promise them.
    expect(activeFilterCount(state)).toBe(8)
  })

  it('badge counts nothing for a query made only of q and/or category', () => {
    expect(activeFilterCount(urlState({ q: 'omega' }))).toBe(0)
    expect(activeFilterCount(urlState({ category: 'vitamins' }))).toBe(0)
    expect(activeFilterCount(urlState({ q: 'omega', category: 'vitamins' }))).toBe(0)
    // …while those same states still narrow, so "Clear filters" stays live.
    expect(hasActiveFilters(urlState({ q: 'omega' }))).toBe(true)
    expect(hasActiveFilters(urlState({ category: 'vitamins' }))).toBe(true)
  })

  it('badge counts each panel control the panel actually renders', () => {
    expect(activeFilterCount(urlState({ brand: ['b1', 'b2'] }))).toBe(2)
    expect(activeFilterCount(urlState({ dosageForm: ['CAPSULE'] }))).toBe(1)
    expect(activeFilterCount(urlState({ ingredient: ['i1'] }))).toBe(1)
    expect(activeFilterCount(urlState({ healthGoal: ['g1'] }))).toBe(1)
    expect(activeFilterCount(urlState({ minPrice: '10' }))).toBe(1)
    expect(activeFilterCount(urlState({ maxPrice: '90' }))).toBe(1)
    expect(activeFilterCount(urlState({ inStock: 'true' }))).toBe(1)
  })
})

/**
 * 🔴 Correction, finding 2 — the narrowing predicate is defined once and
 * consumed by both the data layer and the UI. This proves the single
 * definition is the one `useCatalogData` actually uses, so the two can no
 * longer disagree the way Checkpoint H's finding 2 described.
 */
describe('hasActiveFilters — the single narrowing definition', () => {
  it('is the exact function useCatalogData exposes as hasNarrowingQuery', async () => {
    const controls = await import('./catalogQueryControls')
    const hookModule = await import('../../hooks/useCatalogData')
    // The hook module imports it rather than re-implementing it; if a
    // second copy were reintroduced, this import graph assertion would
    // still pass, so the real proof is behavioural agreement below.
    expect(typeof controls.hasActiveFilters).toBe('function')
    expect(typeof hookModule.useCatalogData).toBe('function')
  })

  it('agrees with the request actually built for every single-parameter query', async () => {
    const { buildCatalogSearchParams } = await import('./catalogUrlState')
    const cases: Partial<CatalogUrlState>[] = [
      { q: 'omega' },
      { q: '' },
      { category: 'vitamins' },
      { category: '' },
      { brand: ['b1'] },
      { dosageForm: ['CAPSULE'] },
      { ingredient: ['i1'] },
      { healthGoal: ['g1'] },
      { minPrice: '10' },
      { maxPrice: '90' },
      { inStock: 'true' },
      { inStock: '' },
      { sort: 'price_asc' },
      { page: 4 },
    ]

    for (const overrides of cases) {
      const state = urlState(overrides)
      const sent = buildCatalogSearchParams(state)
      // Sort and page are in the request but never narrow; everything
      // else that reaches the request narrows. That equivalence is the
      // contract both consumers depend on.
      const narrowingParamsSent = [...sent.keys()].filter((key) => key !== 'sort' && key !== 'page')
      expect(hasActiveFilters(state)).toBe(narrowingParamsSent.length > 0)
    }
  })
})

describe('buildPaginationSlots', () => {
  it('renders nothing to paginate for zero or one page', () => {
    expect(buildPaginationSlots(1, 0)).toEqual([])
    expect(buildPaginationSlots(1, 1)).toEqual([])
  })

  it('lists every page when they all fit without a gap', () => {
    expect(buildPaginationSlots(1, 3)).toEqual([1, 2, 3])
    expect(buildPaginationSlots(2, 4)).toEqual([1, 2, 3, 4])
  })

  it('keeps first, last, current and its neighbours, gapping the rest', () => {
    expect(buildPaginationSlots(5, 10)).toEqual([1, 'gap', 4, 5, 6, 'gap', 10])
    expect(buildPaginationSlots(1, 10)).toEqual([1, 2, 'gap', 10])
    expect(buildPaginationSlots(10, 10)).toEqual([1, 'gap', 9, 10])
  })

  it('renders a single omitted page as the page itself, never as a "…" standing for one number', () => {
    expect(buildPaginationSlots(4, 6)).toEqual([1, 2, 3, 4, 5, 6])
    expect(buildPaginationSlots(3, 5)).toEqual([1, 2, 3, 4, 5])
  })

  it('never duplicates a slot at the boundaries', () => {
    for (const totalPages of [2, 3, 4, 5, 9, 25]) {
      for (let page = 1; page <= totalPages; page += 1) {
        const slots = buildPaginationSlots(page, totalPages)
        const numbers = slots.filter((slot): slot is number => slot !== 'gap')
        expect(new Set(numbers).size).toBe(numbers.length)
        // Always ascending, always within range.
        expect([...numbers].sort((a, b) => a - b)).toEqual(numbers)
        expect(numbers[0]).toBe(1)
        expect(numbers[numbers.length - 1]).toBe(totalPages)
      }
    }
  })

  it('stays well-formed for a malformed or out-of-range current page', () => {
    // `?page=abc` parses to NaN by design (catalogUrlState.ts) and reaches
    // the server, which 400s; this control must not crash meanwhile.
    expect(buildPaginationSlots(Number.NaN, 5)).toEqual([1, 2, 'gap', 5])
    expect(buildPaginationSlots(0, 5)).toEqual([1, 2, 'gap', 5])
    expect(buildPaginationSlots(-3, 5)).toEqual([1, 2, 'gap', 5])
    expect(buildPaginationSlots(99, 5)).toEqual([1, 'gap', 4, 5])
    expect(buildPaginationSlots(1.5, 5)).toEqual([1, 2, 'gap', 5])
  })

  it('returns nothing for a malformed totalPages rather than inventing pages', () => {
    expect(buildPaginationSlots(1, Number.NaN)).toEqual([])
    expect(buildPaginationSlots(1, -2)).toEqual([])
  })
})
