// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { FavouriteButton } from './FavouriteButton'

/**
 * Pass 131, the user's call: the FILLED heart is red (--fav-heart), the
 * unfilled one stays ink. The colour class rides the svg itself; this file
 * pins both directions so a Button/IconButton refactor cannot silently
 * swallow it.
 */
const favouritedState = { value: false }
vi.mock('../../state/FavouritesContext', () => ({
  useFavourites: () => ({
    count: 0,
    isFavourite: () => favouritedState.value,
    toggle: async () => 'added' as const,
  }),
}))

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

describe('the favourite heart colour (pass 131)', () => {
  it('favourited → the svg carries text-fav-heart (red fill via currentColor)', () => {
    favouritedState.value = true
    const { container } = render(
      <MemoryRouter>
        <FavouriteButton slug="fixture" />
      </MemoryRouter>,
    )
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('class') ?? '').toContain('text-fav-heart')
    expect(svg?.getAttribute('fill')).toBe('currentColor')
  })

  it('🔴 the CONTROL — not favourited → no red class, no fill', () => {
    favouritedState.value = false
    const { container } = render(
      <MemoryRouter>
        <FavouriteButton slug="fixture" />
      </MemoryRouter>,
    )
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('class') ?? '').not.toContain('text-fav-heart')
    expect(svg?.getAttribute('fill')).toBe('none')
  })
})
