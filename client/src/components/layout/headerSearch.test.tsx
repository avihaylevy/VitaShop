// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { CartProvider } from '../../state/CartContext'
import { FavouritesProvider } from '../../state/FavouritesContext'
import { SessionProvider } from '../../state/SessionContext'
import { Header } from './Header'
import { MobileHeader } from './MobileHeader'
import { shouldRenderHeaderSearch } from './headerSearch'

/**
 * ISSUE-085 — `/catalog` rendered TWO visible search fields: the header's
 * global `SearchBox` and the page's own `CatalogSearchField`, identical in
 * markup, placeholder and accessible name, and both `role="search"`.
 *
 * The page's field is the one that must stay: §10 requires it to reflect the
 * committed `q`, and §5's page-reset rule lives in the page's own navigation.
 * So the HEADER's field stands down on that one route.
 */

function renderWithProviders(ui: React.ReactElement, path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SessionProvider>
        <FavouritesProvider>
          <CartProvider>{ui}</CartProvider>
        </FavouritesProvider>
      </SessionProvider>
    </MemoryRouter>,
  )
}

/** Every search input, visible or not — jsdom does no layout, so count nodes. */
function searchFields(): HTMLElement[] {
  return screen.queryAllByRole('searchbox')
}

beforeEach(async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }) as unknown as Response),
  )
  await i18n.changeLanguage('he')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('shouldRenderHeaderSearch — the rule on its own', () => {
  it('is false on the catalogue route, true everywhere else', () => {
    expect(shouldRenderHeaderSearch('/catalog')).toBe(false)
    expect(shouldRenderHeaderSearch('/')).toBe(true)
    expect(shouldRenderHeaderSearch('/cart')).toBe(true)
    expect(shouldRenderHeaderSearch('/login')).toBe(true)
  })

  it('holds for a catalogue URL carrying a query string or a trailing slash', () => {
    // The live defect was reproduced at `/catalog?q=…`; a rule that only
    // matched the bare path would leave the duplicate in place for every
    // search result page, which is where a shopper actually is.
    expect(shouldRenderHeaderSearch('/catalog?q=magnesium')).toBe(false)
    expect(shouldRenderHeaderSearch('/catalog/')).toBe(false)
  })

  it('does NOT match a different route that merely starts with the same letters', () => {
    // `/catalogue-of-something` is not the catalogue route.
    expect(shouldRenderHeaderSearch('/catalogx')).toBe(true)
  })

  it('treats a product page as an ordinary route — it has no search of its own', () => {
    expect(shouldRenderHeaderSearch('/product/magnesium-citrate')).toBe(true)
  })
})

describe('Header (desktop)', () => {
  it('renders its search off the catalogue route', () => {
    renderWithProviders(<Header />, '/')
    expect(searchFields()).toHaveLength(1)
  })

  it('renders NO search on /catalog', () => {
    renderWithProviders(<Header />, '/catalog')
    expect(searchFields()).toHaveLength(0)
  })

  it('keeps the rest of the header intact when the search stands down', () => {
    // 🔴 The failure this guards against is deleting more than the field.
    // The logo link and the navigation must survive.
    renderWithProviders(<Header />, '/catalog')
    expect(screen.getByRole('navigation', { name: i18n.t('layout:nav.mainLabel') })).toBeTruthy()
    expect(screen.getAllByRole('link').length).toBeGreaterThan(1)
  })
})

describe('MobileHeader', () => {
  it('renders its search off the catalogue route', () => {
    renderWithProviders(<MobileHeader />, '/')
    expect(searchFields()).toHaveLength(1)
  })

  it('renders NO search on /catalog — the same rule, not a desktop-only fix', () => {
    // The reported screenshot was desktop, but the mobile header carries its
    // own SearchBox, so a desktop-only fix would leave the duplicate at every
    // width below `md` — where the panel and the field are stacked and the
    // duplication is worse.
    renderWithProviders(<MobileHeader />, '/catalog')
    expect(searchFields()).toHaveLength(0)
  })
})
