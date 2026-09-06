// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
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
const toggleResult = { value: 'added' as 'added' | 'removed' | 'auth-required' | 'failed' }
vi.mock('../../state/FavouritesContext', () => ({
  useFavourites: () => ({
    count: 0,
    isFavourite: () => favouritedState.value,
    toggle: async () => toggleResult.value,
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

  it('the pressed heart is a WASH, not a block: fill-opacity below 1 when favourited, absent otherwise', () => {
    favouritedState.value = true
    const on = render(
      <MemoryRouter>
        <FavouriteButton slug="fixture" />
      </MemoryRouter>,
    )
    expect(Number(on.container.querySelector('svg')?.getAttribute('fill-opacity'))).toBeLessThan(1)
    cleanup()
    favouritedState.value = false
    const off = render(
      <MemoryRouter>
        <FavouriteButton slug="fixture" />
      </MemoryRouter>,
    )
    expect(off.container.querySelector('svg')?.getAttribute('fill-opacity')).toBeNull()
  })
})

describe('the heart moves (2026-09-06) — motion-safe, and only after the server has answered', () => {
  it('hover/focus scale classes are always present and motion-safe-gated', () => {
    const { container } = render(
      <MemoryRouter>
        <FavouriteButton slug="fixture" />
      </MemoryRouter>,
    )
    const cls = container.querySelector('svg')?.getAttribute('class') ?? ''
    expect(cls).toContain('motion-safe:group-hover:scale-110')
    expect(cls).toContain('motion-safe:group-focus-visible:scale-110')
    expect(container.querySelector('button')?.getAttribute('class') ?? '').toContain('group')
    // 🔴 no pop before any toggle
    expect(cls).not.toContain('fav-heart-pop')
  })

  it('🔴 a CONFIRMED toggle plays the pop; the auth redirect does NOT (both controls)', async () => {
    toggleResult.value = 'added'
    const confirmed = render(
      <MemoryRouter>
        <FavouriteButton slug="fixture" />
      </MemoryRouter>,
    )
    fireEvent.click(confirmed.getByRole('button'))
    await waitFor(() =>
      expect(confirmed.container.querySelector('svg')?.getAttribute('class') ?? '').toContain(
        'motion-safe:animate-[fav-heart-pop',
      ),
    )
    cleanup()

    toggleResult.value = 'auth-required'
    const redirected = render(
      <MemoryRouter>
        <FavouriteButton slug="fixture" />
      </MemoryRouter>,
    )
    fireEvent.click(redirected.getByRole('button'))
    await new Promise((r) => setTimeout(r, 20))
    expect(redirected.container.querySelector('svg')?.getAttribute('class') ?? '').not.toContain('fav-heart-pop')
  })
})
