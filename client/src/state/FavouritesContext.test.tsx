// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import {
  FavouritesProvider,
  useFavourites,
  type FavouriteToggleResult,
} from './FavouritesContext'
import { addFavourite, fetchFavourites, removeFavourite } from '../lib/favouritesApi'

/**
 * 🔴 THE REAL PROVIDER'S FIRST TESTS. Until the ab8e374 review, every suite
 * that touched favourites mocked this module away, so none of the behaviour
 * below had a net. Each test here pins ONE of that review's fixes — reverting
 * a fix turns exactly its test red (the mutation-proof is the construction).
 */

vi.mock('../lib/favouritesApi', () => ({
  fetchFavourites: vi.fn(async () => ({ ok: false, reason: 'failed' as const })),
  addFavourite: vi.fn(async () => 'ok' as const),
  removeFavourite: vi.fn(async () => 'ok' as const),
}))

// Three-state session, mutable per test. The provider must distinguish
// 'loading' from 'guest' — that distinction IS one of the fixes.
let sessionStatus: 'loading' | 'authenticated' | 'guest' = 'guest'
vi.mock('./SessionContext', () => ({
  useSession: () => ({ status: sessionStatus, isSignedIn: sessionStatus === 'authenticated' }),
}))

const fetchMock = vi.mocked(fetchFavourites)
const addMock = vi.mocked(addFavourite)
const removeMock = vi.mocked(removeFavourite)

// The captured context value — refreshed on every provider render.
let ctx: ReturnType<typeof useFavourites>
function Capture() {
  ctx = useFavourites()
  return <p data-testid="count">{ctx.count}</p>
}

function renderProvider() {
  return render(
    <StrictMode>
      <FavouritesProvider>
        <Capture />
      </FavouritesProvider>
    </StrictMode>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionStatus = 'guest'
  fetchMock.mockResolvedValue({ ok: false, reason: 'failed' })
  addMock.mockResolvedValue('ok')
  removeMock.mockResolvedValue('ok')
})

afterEach(cleanup)

describe('FavouritesContext — the real provider', () => {
  it('a KNOWN guest gets auth-required without any request', async () => {
    renderProvider()
    let result: FavouriteToggleResult | undefined
    await act(async () => {
      result = await ctx.toggle('omega-3')
    })
    expect(result).toBe('auth-required')
    expect(addMock).not.toHaveBeenCalled()
    expect(removeMock).not.toHaveBeenCalled()
  })

  it("🔴 during the session probe ('loading') the write is ATTEMPTED — the cookie decides, never a redirect guess", async () => {
    sessionStatus = 'loading'
    renderProvider()
    let result: FavouriteToggleResult | undefined
    await act(async () => {
      result = await ctx.toggle('omega-3')
    })
    // The server confirmed, so the press succeeded — no /login bounce for a
    // signed-in shopper who pressed a heart before the probe resolved.
    expect(result).toBe('added')
    expect(addMock).toHaveBeenCalledTimes(1)
    // And a REAL guest still ends at auth-required, via the server's 401.
    addMock.mockResolvedValueOnce('unauthenticated')
    await act(async () => {
      result = await ctx.toggle('magnesium')
    })
    expect(result).toBe('auth-required')
  })

  it('🔴 a failed write returns failed, changes nothing, and is SAID from the always-mounted region', async () => {
    sessionStatus = 'authenticated'
    renderProvider()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    addMock.mockResolvedValueOnce('failed')
    let result: FavouriteToggleResult | undefined
    await act(async () => {
      result = await ctx.toggle('omega-3')
    })
    expect(result).toBe('failed')
    expect(ctx.isFavourite('omega-3')).toBe(false)
    // The provider's own polite region carries the announcement (§7.16 —
    // never silent), in the active language.
    const { default: i18n } = await import('../i18n')
    expect(screen.getByText(i18n.t('catalog:favourite.failed'))).toBeTruthy()
  })

  it('🔴 a second press while the first write is IN FLIGHT is a pending no-op, not a repeated same-direction write', async () => {
    sessionStatus = 'authenticated'
    renderProvider()
    let releaseFirst: (value: 'ok') => void
    addMock.mockImplementationOnce(
      () => new Promise((resolve) => (releaseFirst = resolve)),
    )
    let first: Promise<FavouriteToggleResult>
    let second: FavouriteToggleResult | undefined
    await act(async () => {
      first = ctx.toggle('omega-3')
      second = await ctx.toggle('omega-3')
      releaseFirst!('ok')
      await first
    })
    expect(second).toBe('pending')
    // ONE request total — the double-press cannot fire the same direction twice.
    expect(addMock).toHaveBeenCalledTimes(1)
    expect(ctx.isFavourite('omega-3')).toBe(true)
  })

  it('replaceAll lets the favourites page repair a failed hydration with its own server answer', async () => {
    sessionStatus = 'authenticated'
    renderProvider()
    // Hydration failed (the default mock) — set is empty.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(ctx.count).toBe(0)
    act(() => {
      ctx.replaceAll(['omega-3', 'magnesium'])
    })
    expect(ctx.count).toBe(2)
    expect(ctx.isFavourite('omega-3')).toBe(true)
    expect(ctx.isFavourite('vitamin-c')).toBe(false)
  })

  it('hydration fills the set from the server for an authenticated session', async () => {
    sessionStatus = 'authenticated'
    fetchMock.mockResolvedValue({
      ok: true,
      items: [{ slug: 'omega-3' } as never],
    })
    renderProvider()
    await waitFor(() => expect(ctx.count).toBe(1))
    expect(ctx.isFavourite('omega-3')).toBe(true)
  })
})
