// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../../i18n'
import i18n from '../../i18n'
import { ActiveFilterChips, PANEL_FILTERS_CLEARED } from './ActiveFilterChips'
import { EMPTY_CATALOG_URL_STATE } from '../../features/catalog/catalogUrlState'
import type { CatalogFacetsDto } from '../../types/catalog'

/**
 * DEC-106 — the applied-filters strip. What is pinned:
 * - labels resolve from facets (ids never print; unresolvable ids render
 *   NO chip rather than a raw id)
 * - a chip's press removes exactly its own value
 * - the strip's clear action resets every panel-scope filter and ONLY
 *   those (q/category/sort survive — the strip must not clear more than
 *   it shows)
 * - no active panel filters -> the strip renders nothing at all
 */

const facets: CatalogFacetsDto = {
  brands: [
    { id: 'b1', label: 'נטורליס', labelEn: 'Naturalis' },
    { id: 'b2', label: 'סופהרב', labelEn: null },
  ],
  ingredients: [{ id: 'i1', label: 'מגנזיום' }],
  healthGoals: [{ id: 'g1', labelHe: 'שינה', labelEn: 'Sleep' }],
  dosageForms: [{ value: 'CAPSULE', labelHe: 'כמוסות', labelEn: 'Capsules' }],
  dietary: [{ value: 'kosher', labelHe: 'כשר', labelEn: 'Kosher' }],
}

function renderChips(urlState: typeof EMPTY_CATALOG_URL_STATE, onChange = vi.fn()) {
  render(
    <StrictMode>
      <ActiveFilterChips urlState={urlState} facets={facets} onChange={onChange} />
    </StrictMode>,
  )
  return onChange
}

afterEach(cleanup)

describe('ActiveFilterChips', () => {
  it('renders nothing at all when no panel filter is active — q and category do not count', () => {
    renderChips({ ...EMPTY_CATALOG_URL_STATE, q: 'omega', category: 'vitamins' })
    expect(screen.queryByText(i18n.t('catalog:filters.activeLabel'))).toBeNull()
  })

  it('resolves every chip label from facets, and an unresolvable id renders NO chip', () => {
    renderChips({
      ...EMPTY_CATALOG_URL_STATE,
      brand: ['b1', 'ghost'],
      dosageForm: ['CAPSULE'],
      healthGoal: ['g1'],
      minPrice: '20',
      inStock: 'true',
      kosher: 'true',
    })
    expect(screen.getByText('נטורליס')).toBeTruthy()
    expect(screen.getByText('כמוסות')).toBeTruthy()
    expect(screen.getByText('שינה')).toBeTruthy()
    expect(screen.getByText('כשר')).toBeTruthy()
    expect(screen.getByText(i18n.t('catalog:filters.inStock'))).toBeTruthy()
    expect(screen.queryByText('ghost')).toBeNull()
  })

  it('a chip removes exactly its own value', () => {
    const onChange = renderChips({ ...EMPTY_CATALOG_URL_STATE, brand: ['b1', 'b2'] })
    fireEvent.click(
      screen.getByRole('button', {
        name: i18n.t('catalog:filters.removeFilter', { label: 'נטורליס' }),
      }),
    )
    expect(onChange).toHaveBeenCalledWith({ brand: ['b2'] })
  })

  it('the clear action resets the panel-scope filters and nothing else', () => {
    const onChange = renderChips({ ...EMPTY_CATALOG_URL_STATE, brand: ['b1'], minPrice: '10' })
    fireEvent.click(screen.getByRole('button', { name: i18n.t('catalog:filters.clearShort') }))
    expect(onChange).toHaveBeenCalledWith(PANEL_FILTERS_CLEARED)
    // The clear payload must never touch q, category, sort or page keys.
    expect(Object.keys(PANEL_FILTERS_CLEARED)).not.toContain('q')
    expect(Object.keys(PANEL_FILTERS_CLEARED)).not.toContain('category')
    expect(Object.keys(PANEL_FILTERS_CLEARED)).not.toContain('sort')
  })
})
