// @vitest-environment jsdom
import { act, render, renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { createMemoryRouter, MemoryRouter, RouterProvider, useSearchParams } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCatalogData, type UseCatalogDataResult } from './useCatalogData'
import type { CatalogFallbackDto, CatalogProductDto, CatalogProductsEnvelope } from '../types/catalog'

/**
 * MILESTONE-005 Checkpoint H correction — behavioral coverage for
 * `useCatalogData`'s effect: the monotonic request-id guard, the
 * AbortError cancellation contract (§9b), §5a past-the-end
 * canonicalization via a replace-navigate (including the `replace: true`
 * navigation action itself, via `createMemoryRouter`'s
 * `router.state.historyAction`), and the zero-total guard. Every other
 * checkpoint test file in this repo uses `renderToStaticMarkup`, which
 * never runs `useEffect` — this hook's async orchestration is entirely
 * inside one, so it cannot be proven any other way. `jsdom` and
 * `@testing-library/react` are added as devDependencies ONLY for this
 * file (file-scoped `@vitest-environment` pragma above — every other
 * test file keeps vitest's default `node` environment, untouched;
 * DEC-051).
 *
 * The hook detects cancellation via `controller.signal.aborted`, not via
 * `err instanceof Error && err.name === 'AbortError'` (correction #3 —
 * the latter is realm-fragile: jsdom's `DOMException` does not extend
 * `Error`, unlike Node's native `DOMException` and real browsers', both
 * of which do). Because of that, every AbortError-shaped rejection below
 * uses a real `DOMException` — no synthetic fixture is needed.
 */

const BASE_URL = 'http://localhost:3000'

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', BASE_URL)
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

function validProduct(overrides: Partial<CatalogProductDto> = {}): CatalogProductDto {
  return {
    slug: 'solgar-omega-3',
    nameHe: 'אומגה 3',
    nameEn: 'Omega 3',
    categoryNameHe: 'אומגה ושומנים',
    categoryNameEn: 'Omega & Fats',
    categorySlug: 'omega-fats',
    brandName: 'סולגאר',
    brandNameEn: 'Solgar',
    dosageForm: 'CAPSULE',
    packageQuantity: 100,
    price: '94.90',
    stockQuantity: 60,
    lowStockThreshold: 5,
    imageFile: 'solgar-omega-3.jpg',
    ...overrides,
  }
}

function envelope(overrides: Partial<CatalogProductsEnvelope> = {}): CatalogProductsEnvelope {
  return {
    items: [],
    page: 1,
    pageSize: 24,
    totalItems: 0,
    totalPages: 0,
    fallback: null,
    ...overrides,
  }
}

function makeWrapper(url: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(MemoryRouter, { initialEntries: [url] }, children)
  }
}

function renderWithSearch(url: string) {
  return renderHook(
    () => {
      const data = useCatalogData('he')
      const [params] = useSearchParams()
      return { data, search: params.toString() }
    },
    { wrapper: makeWrapper(url) },
  )
}

describe('useCatalogData — request-id guard (§9b)', () => {
  it('a stale response that resolves AFTER a retry supersedes it is discarded — the retry response wins', async () => {
    const stale = deferred<Response>()
    fetchMock.mockImplementationOnce(() => stale.promise)
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(
        mockResponse(200, envelope({ items: [validProduct({ slug: 'fresh' })], totalItems: 1, totalPages: 1 })),
      ),
    )

    const { result } = renderWithSearch('/catalog')

    act(() => {
      result.current.data.retry()
    })

    await waitFor(() => expect(result.current.data.loading).toBe(false))
    expect(result.current.data.totalItems).toBe(1)
    expect(result.current.data.products[0]?.slug).toBe('fresh')

    // The stale request now resolves — its (very different) payload must
    // never overwrite the state the newer request already committed.
    await act(async () => {
      stale.resolve(mockResponse(200, envelope({ items: [validProduct({ slug: 'stale' })], totalItems: 999, totalPages: 5 })))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.data.totalItems).toBe(1)
    expect(result.current.data.products[0]?.slug).toBe('fresh')
  })
})

describe('useCatalogData — cancellation contract (§9b)', () => {
  it('a superseded request that rejects (its controller genuinely aborted by the retry\'s effect cleanup) never sets error or invalidCategory — a later success is unaffected', async () => {
    const stale = deferred<Response>()
    fetchMock.mockImplementationOnce(() => stale.promise)
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(mockResponse(200, envelope({ items: [validProduct()], totalItems: 1, totalPages: 1 }))),
    )

    const { result } = renderWithSearch('/catalog')

    act(() => {
      // React runs the FIRST effect's cleanup — which calls the first
      // request's real controller.abort() — before running the second
      // effect. By the time `stale` rejects below, its signal is
      // genuinely aborted; no synthetic AbortError shape is needed.
      result.current.data.retry()
    })

    await waitFor(() => expect(result.current.data.loading).toBe(false))
    expect(result.current.data.error).toBeNull()
    expect(result.current.data.invalidCategory).toBe(false)
    expect(result.current.data.totalItems).toBe(1)

    // The superseded request now rejects the way a real aborted fetch
    // would — this must produce NO normalized result at all.
    await act(async () => {
      stale.reject(new DOMException('The operation was aborted.', 'AbortError'))
      await Promise.resolve().catch(() => {})
      await Promise.resolve()
    })

    expect(result.current.data.error).toBeNull()
    expect(result.current.data.invalidCategory).toBe(false)
    expect(result.current.data.totalItems).toBe(1)
    expect(result.current.data.loading).toBe(false)
  })

  it('unmounting aborts the in-flight request\'s AbortSignal, and the resulting rejection produces no state update at all', async () => {
    const pending = deferred<Response>()
    fetchMock.mockImplementationOnce(() => pending.promise)

    const { result, unmount } = renderWithSearch('/catalog')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    const [, options] = fetchMock.mock.calls[0] as [string, { signal: AbortSignal }]
    expect(options.signal.aborted).toBe(false)

    const beforeUnmount = { ...result.current.data }
    unmount()
    expect(options.signal.aborted).toBe(true)

    // The now-aborted request rejects, exactly like a real aborted fetch
    // — `controller.signal.aborted` is the guard that must stop this
    // from ever calling setError/setInvalidCategory/setLoading (which
    // would otherwise warn about updating state on an unmounted
    // component, or worse, silently write into a stale closure).
    await act(async () => {
      pending.reject(new DOMException('The operation was aborted.', 'AbortError'))
      await Promise.resolve().catch(() => {})
      await Promise.resolve()
    })

    expect(result.current.data.error).toBe(beforeUnmount.error)
    expect(result.current.data.invalidCategory).toBe(beforeUnmount.invalidCategory)
    expect(result.current.data.loading).toBe(beforeUnmount.loading)
  })
})

describe('useCatalogData — §5a past-the-end canonicalization', () => {
  it('a past-the-end page is canonicalized via a REPLACE navigation, preserving every other param, and the canonicalizing response is never rendered', async () => {
    const canonicalFetch = deferred<Response>()
    // First request: page=5, sort=price_asc (the real §4 contract value)
    // — lands past totalPages=2.
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(mockResponse(200, envelope({ items: [validProduct({ slug: 'never-rendered' })], totalItems: 10, totalPages: 2 }))),
    )
    // Second request: the re-triggered fetch for the canonical page=2.
    fetchMock.mockImplementationOnce(() => canonicalFetch.promise)

    let latest: { data: UseCatalogDataResult; search: string } | undefined
    function Probe() {
      const data = useCatalogData('he')
      const [params] = useSearchParams()
      latest = { data, search: params.toString() }
      return null
    }
    const router = createMemoryRouter([{ path: '/catalog', element: createElement(Probe) }], {
      initialEntries: ['/catalog?page=5&sort=price_asc'],
    })

    render(createElement(RouterProvider, { router }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    // The canonicalizing response must never be set into state.
    expect(latest?.data.loading).toBe(true)
    expect(latest?.data.products).toEqual([])
    expect(latest?.data.totalItems).toBe(0)

    // Every other param preserved byte-for-byte; only page changed.
    expect(latest?.search).toContain('page=2')
    expect(latest?.search).toContain('sort=price_asc')

    // The navigation itself was a REPLACE, not a PUSH — §5a's explicit
    // requirement (a push would pollute the back stack with the
    // past-the-end URL).
    expect(router.state.historyAction).toBe('REPLACE')

    await act(async () => {
      canonicalFetch.resolve(
        mockResponse(200, envelope({ items: [validProduct({ slug: 'canonical-page' })], totalItems: 10, totalPages: 2, page: 2 })),
      )
    })

    await waitFor(() => expect(latest?.data.loading).toBe(false))
    expect(latest?.data.totalItems).toBe(10)
    expect(latest?.data.products[0]?.slug).toBe('canonical-page')
  })
})

describe('useCatalogData — zero-total guard (§5a)', () => {
  it('totalItems===0 never canonicalizes, even for an out-of-range page — no second fetch, loading resolves to false', async () => {
    fetchMock.mockImplementationOnce(() => Promise.resolve(mockResponse(200, envelope({ items: [], totalItems: 0, totalPages: 0 }))))

    const { result } = renderWithSearch('/catalog?page=5')

    await waitFor(() => expect(result.current.data.loading).toBe(false))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current.data.totalItems).toBe(0)
    expect(result.current.data.products).toEqual([])
  })
})

describe('useCatalogData — hasNarrowingQuery presence rule (correction finding 2)', () => {
  it('an empty q= param (?q=) is NOT narrowing — matches isPresent(), not !== undefined', async () => {
    fetchMock.mockImplementationOnce(() => Promise.resolve(mockResponse(200, envelope({ items: [], totalItems: 0, totalPages: 0 }))))

    const { result } = renderWithSearch('/catalog?q=')

    await waitFor(() => expect(result.current.data.loading).toBe(false))
    expect(result.current.data.hasNarrowingQuery).toBe(false)

    // The empty q also must not have reached the request itself — the
    // bare /api/products call, matching what the resolver's totalItems
    // reflects.
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe(`${BASE_URL}/api/products`)
  })

  it('a non-empty q= param IS narrowing', async () => {
    fetchMock.mockImplementationOnce(() => Promise.resolve(mockResponse(200, envelope({ items: [], totalItems: 0, totalPages: 0 }))))

    const { result } = renderWithSearch('/catalog?q=omega')

    await waitFor(() => expect(result.current.data.loading).toBe(false))
    expect(result.current.data.hasNarrowingQuery).toBe(true)
  })
})

describe('useCatalogData — fallback mapping', () => {
  it('maps fallback.items through mapCatalogProduct the same way primary items are mapped', async () => {
    const fallbackDto: CatalogFallbackDto = { kind: 'popular', items: [validProduct({ slug: 'popular-pick' })], limit: 8 }
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(mockResponse(200, envelope({ items: [], totalItems: 0, totalPages: 0, fallback: fallbackDto }))),
    )

    const { result } = renderWithSearch('/catalog?category=vitamins')

    await waitFor(() => expect(result.current.data.loading).toBe(false))
    expect(result.current.data.fallback).not.toBeNull()
    expect(result.current.data.fallback?.kind).toBe('popular')
    expect(result.current.data.fallback?.items[0]?.slug).toBe('popular-pick')
    expect(result.current.data.fallback?.items[0]?.name).toBe('אומגה 3')
  })
})

// MILESTONE-005 Checkpoint I — `page`/`totalPages` were added to the hook's
// result so the pagination control can describe the results actually on
// screen. They come from the RESPONSE, never from the URL.
describe('useCatalogData — page/totalPages exposure (Checkpoint I)', () => {
  it("exposes the server's page and totalPages for the rendered result set", async () => {
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(mockResponse(200, envelope({ items: [validProduct()], page: 3, totalItems: 100, totalPages: 5 }))),
    )

    const { result } = renderWithSearch('/catalog?page=3')

    await waitFor(() => expect(result.current.data.loading).toBe(false))
    expect(result.current.data.page).toBe(3)
    expect(result.current.data.totalPages).toBe(5)
  })

  it('never exposes the page/totalPages of a discarded past-the-end response (§5a)', async () => {
    // Request page 9, server answers with totalPages 2 -> the data layer
    // canonicalizes to page 2 instead of ever setting page 9's numbers.
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(mockResponse(200, envelope({ items: [], page: 9, totalItems: 30, totalPages: 2 }))),
    )
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(mockResponse(200, envelope({ items: [validProduct()], page: 2, totalItems: 30, totalPages: 2 }))),
    )

    const { result } = renderWithSearch('/catalog?page=9')

    await waitFor(() => expect(result.current.data.loading).toBe(false))
    expect(result.current.search).toBe('page=2')
    expect(result.current.data.page).toBe(2)
    expect(result.current.data.totalPages).toBe(2)
  })
})
