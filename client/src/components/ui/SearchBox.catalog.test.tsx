// @vitest-environment jsdom
import { StrictMode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import { SearchBox } from './SearchBox'

/**
 * ISSUE-110 — the header's SearchBox is THE search field, and this file pins
 * the /catalog contract it absorbed from the deleted CatalogSearchField:
 *
 *   · on /catalog it REFLECTS the committed q (§10) and re-syncs when the
 *     URL changes
 *   · its submit routes through nextCatalogUrlState — §5's page-reset rule
 *     applies and every other committed parameter survives
 *   · an emptied submit clears q entirely (never sends `?q=`)
 *   · anywhere else, submit navigates to /catalog?q=…
 */

function LocationProbe() {
  const location = useLocation()
  return <p data-testid="url">{location.pathname + location.search}</p>
}

function renderAt(url: string) {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={[url]}>
        <SearchBox />
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </StrictMode>,
  )
}

function submit(value?: string) {
  const input = screen.getByRole('searchbox')
  if (value !== undefined) fireEvent.change(input, { target: { value } })
  fireEvent.submit(input.closest('form')!)
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

describe('ISSUE-110 — SearchBox on /catalog', () => {
  it('🔴 reflects the committed q rather than starting empty (§10)', () => {
    renderAt('/catalog?q=magnesium')
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('magnesium')
  })

  it('🔴 submit PRESERVES other committed params and RESETS the page (§5)', () => {
    renderAt('/catalog?category=vitamins&inStock=true&page=3')
    submit('omega')

    const url = screen.getByTestId('url').textContent!
    expect(url).toContain('/catalog')
    expect(url).toContain('q=omega')
    expect(url).toContain('category=vitamins')
    expect(url).toContain('inStock=true')
    // §5: q changed, so the page resets — page=3 must be gone (page 1 is
    // the omitted default).
    expect(url).not.toContain('page=')
  })

  it('an emptied submit clears q entirely — never `?q=`', () => {
    renderAt('/catalog?q=omega&category=vitamins')
    submit('')

    const url = screen.getByTestId('url').textContent!
    expect(url).not.toContain('q=')
    expect(url).toContain('category=vitamins')
  })

  it('🔴 THE CONTROL — elsewhere it still navigates to /catalog?q=…', () => {
    renderAt('/')
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('')
    submit('iron')
    expect(screen.getByTestId('url').textContent).toBe('/catalog?q=iron')
  })
})
