// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { CatalogFilterPanel } from './CatalogFilterPanel'

/**
 * ISSUE-086 — the price inputs' constraint attributes.
 *
 * 🔴 ISSUE-048 added `type="number"` with these attributes and NOTHING
 * asserted them, which is why raising `step` was a one-character change with
 * no test to break. This file is that missing cover, written with the change.
 */

function renderPanel() {
  return render(
    <CatalogFilterPanel
      groups={[]}
      onToggleValue={vi.fn()}
      dietaryOptions={[]}
      onDietaryChange={vi.fn()}
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

function priceInputs(): HTMLInputElement[] {
  return screen
    .getAllByRole('spinbutton')
    .filter((element): element is HTMLInputElement => element instanceof HTMLInputElement)
}

beforeEach(async () => {
  await i18n.changeLanguage('he')
})

afterEach(cleanup)

describe('the price range inputs', () => {
  it('renders exactly two of them', () => {
    renderPanel()
    // Anti-vacuous: every assertion below iterates this list, so a selector
    // that stopped matching would make all of them pass against nothing.
    expect(priceInputs()).toHaveLength(2)
  })

  it('steps in TENTHS of a shekel, not single agorot (ISSUE-086)', () => {
    renderPanel()
    for (const input of priceInputs()) {
      expect(input.step).toBe('0.1')
    }
  })

  it('still mirrors the server bounds exactly — only `step` diverges', () => {
    // 🔴 `MAX_PRICE_CENTS = 99_999_99` in the server's `catalogQuery.ts`. A
    // client max BELOW the server's would silently block valid input, which
    // is the failure the constant's own comment warns about.
    renderPanel()
    for (const input of priceInputs()) {
      expect(input.min).toBe('0')
      expect(input.max).toBe('99999.99')
    }
  })

  it('accepts a whole-shekel bound as valid', () => {
    renderPanel()
    const [min] = priceInputs()
    min!.value = '95'
    expect(min!.validity.stepMismatch).toBe(false)
  })

  it('🔴 REJECTS a two-decimal bound the SERVER would accept — the approved cost of the change', () => {
    // This is not a bug report disguised as a test. `step="0.1"` narrows the
    // browser's validation below the server's `DECIMAL_PATTERN`, the user was
    // shown that trade and chose it, and the test exists so the narrowing
    // cannot be forgotten or silently reverted without a failure explaining
    // itself.
    renderPanel()
    const [min] = priceInputs()
    min!.value = '95.55'
    expect(min!.validity.stepMismatch).toBe(true)
  })
})
