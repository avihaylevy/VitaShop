// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { CatalogFilterPanel } from './CatalogFilterPanel'
import type { DietaryOptionModel, FilterGroupModel } from '../../features/catalog/catalogQueryControls'

/**
 * ISSUE-050 / ISSUE-051 — the disclosure redesign. REQ-F-011 forbids
 * REMOVING the ingredient/health-goal groups, so the containment contract is
 * what these tests pin:
 *
 *   · a group at/over 9 options renders COLLAPSED — its checkboxes absent
 *     until its own button expands it
 *   · a collapsed group with a selection in the URL auto-opens (arriving
 *     state is never hidden)
 *   · a group at/over 16 options gets a typeahead that narrows the visible
 *     checkbox list — display only, selection untouched
 *   · a small group renders open, exactly as before the redesign
 */

function group(key: FilterGroupModel['key'], count: number, selected = 0): FilterGroupModel {
  return {
    key,
    selectedCount: selected,
    atCeiling: false,
    options: Array.from({ length: count }, (_, i) => ({
      value: `${key}-${i}`,
      label: `${key} option ${i}`,
      checked: i < selected,
      disabled: false,
    })),
  }
}

function renderPanel(
  groups: FilterGroupModel[],
  dietaryOptions: DietaryOptionModel[] = [],
  onDietaryChange = vi.fn(),
) {
  return render(
    <CatalogFilterPanel
      groups={groups}
      onToggleValue={vi.fn()}
      dietaryOptions={dietaryOptions}
      onDietaryChange={onDietaryChange}
      minPrice=""
      maxPrice=""
      onPriceCommit={vi.fn()}
      inStockChecked={false}
      onInStockChange={vi.fn()}
      onClear={vi.fn()}
      clearDisabled
    />,
  )
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

describe('DEC-078/DEC-083 — the dietary fieldset', () => {
  it('renders one labelled checkbox per OFFERED option, and fires the change with the key', () => {
    const onDietaryChange = vi.fn()
    renderPanel(
      [],
      [
        { key: 'kosher', label: 'Kosher', checked: false },
        { key: 'vegan', label: 'Vegan', checked: true },
      ],
      onDietaryChange,
    )
    const kosher = screen.getByRole('checkbox', { name: 'Kosher' })
    expect((screen.getByRole('checkbox', { name: 'Vegan' }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(kosher)
    expect(onDietaryChange).toHaveBeenCalledWith('kosher', true)
  })

  it('🔴 renders NO dietary fieldset at all when nothing is offered — a filter over empty data does not exist', () => {
    renderPanel([], [])
    // Only the availability checkbox remains.
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
    expect(screen.queryByText('Dietary & kosher')).toBeNull()
  })
})

describe('ISSUE-050/051 — big filter groups are disclosures', () => {
  it('🔴 DEC-078 — the ingredient group is NOT OFFERED, whatever its size', () => {
    renderPanel([group('ingredient', 53)])

    // Only the availability checkbox (always-visible fieldset) is present,
    // and no disclosure button for the group exists either.
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /active ingredient/i })).toBeNull()
  })

  it('🔴 a big group renders COLLAPSED: no checkboxes until its button expands it', () => {
    renderPanel([group('healthGoal', 53)])

    // Only the availability checkbox (always-visible fieldset) is present.
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)

    const toggle = screen.getByRole('button', { name: /health goal/i })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    // 53 group checkboxes + availability.
    expect(screen.getAllByRole('checkbox')).toHaveLength(54)
  })

  it('🔴 a collapsed group with a URL selection AUTO-OPENS — arriving state is never hidden', () => {
    renderPanel([group('healthGoal', 9, 2)])

    expect(screen.getByRole('button', { name: /health goal/i }).getAttribute('aria-expanded')).toBe('true')
    // 9 group checkboxes + availability; the two selected are checked.
    expect(screen.getAllByRole('checkbox')).toHaveLength(10)
    expect(screen.getAllByRole('checkbox', { checked: true })).toHaveLength(2)
  })

  it('the typeahead narrows the VISIBLE list only', () => {
    renderPanel([group('healthGoal', 20)])
    fireEvent.click(screen.getByRole('button', { name: /health goal/i }))
    expect(screen.getAllByRole('checkbox')).toHaveLength(21)

    fireEvent.change(screen.getByRole('searchbox', { name: /search this list/i }), {
      target: { value: 'option 1' },
    })
    // "option 1" matches option 1 and 10..19 → 11, plus availability.
    expect(screen.getAllByRole('checkbox')).toHaveLength(12)

    fireEvent.change(screen.getByRole('searchbox', { name: /search this list/i }), {
      target: { value: 'no-such-thing' },
    })
    expect(screen.getByText(/no matching options/i)).toBeTruthy()
  })

  it('🔴 THE CONTROL — a small group renders OPEN with no disclosure button, exactly as before', () => {
    renderPanel([group('brand', 8)])

    expect(screen.queryByRole('button', { name: /^brand$/i })).toBeNull()
    // 8 group checkboxes + availability, present without any interaction.
    expect(screen.getAllByRole('checkbox')).toHaveLength(9)
  })
})
