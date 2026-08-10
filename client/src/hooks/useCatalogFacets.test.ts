// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_CATALOG_FACETS, useCatalogFacets } from './useCatalogFacets'
import type { CatalogFacetsDto } from '../types/catalog'

/**
 * MILESTONE-005 Checkpoint I — behavioral coverage for `useCatalogFacets`.
 * Same rationale (and same file-scoped jsdom pragma, DEC-051) as
 * `useCatalogData.test.ts`: the hook's whole job lives inside a `useEffect`,
 * which `renderToStaticMarkup` never runs, so no other technique in this
 * repo can prove it.
 *
 * What must hold:
 * - it fetches ONCE per mount and never per query (§9b's reasoning);
 * - a failure leaves the empty payload rather than an undefined one, so no
 *   consumer has to branch on absence;
 * - an unmount cancellation writes no state and produces no error.
 */

const BASE_URL = 'http://localhost:3000'

const FACETS: CatalogFacetsDto = {
  brands: [{ id: 'b1', label: 'Solgar' }],
  ingredients: [],
  healthGoals: [],
  dosageForms: [{ value: 'CAPSULE', labelHe: 'כמוסות', labelEn: 'Capsules' }],
}

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

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

describe('useCatalogFacets', () => {
  it('starts loading with the empty payload, then resolves with the fetched facets', async () => {
    fetchMock.mockResolvedValue(okResponse(FACETS))
    const { result } = renderHook(() => useCatalogFacets())

    expect(result.current.loading).toBe(true)
    expect(result.current.facets).toEqual(EMPTY_CATALOG_FACETS)

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.facets).toEqual(FACETS)
    expect(result.current.error).toBeNull()
  })

  it('requests the facets endpoint exactly once per mount', async () => {
    fetchMock.mockResolvedValue(okResponse(FACETS))
    const { result, rerender } = renderHook(() => useCatalogFacets())

    await waitFor(() => expect(result.current.loading).toBe(false))
    rerender()
    rerender()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE_URL}/api/catalog/facets`)
  })

  it('keeps the empty payload — never undefined — when the request fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const { result } = renderHook(() => useCatalogFacets())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.facets).toEqual(EMPTY_CATALOG_FACETS)
    expect(result.current.error).toMatchObject({ code: 'NETWORK_ERROR' })
  })

  it('refetches on retry()', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(okResponse(FACETS))
    const { result } = renderHook(() => useCatalogFacets())

    await waitFor(() => expect(result.current.error).not.toBeNull())
    result.current.retry()

    await waitFor(() => expect(result.current.error).toBeNull())
    expect(result.current.facets).toEqual(FACETS)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('aborts the in-flight request on unmount and writes no state afterwards', async () => {
    let capturedSignal: AbortSignal | undefined
    fetchMock.mockImplementation((_url: string, init: { signal?: AbortSignal }) => {
      capturedSignal = init.signal
      return new Promise(() => {
        // Never settles — the unmount is what must end this request.
      })
    })

    const { unmount } = renderHook(() => useCatalogFacets())
    expect(capturedSignal?.aborted).toBe(false)

    unmount()
    expect(capturedSignal?.aborted).toBe(true)
  })

  it('classifies an abort as cancellation, not as an error', async () => {
    // A rejection whose signal IS aborted must produce no error state — the
    // realm-independent `signal.aborted` check, matching the Checkpoint H
    // correction #3 contract.
    const abortError = new DOMException('The operation was aborted.', 'AbortError')
    let rejectFetch!: (reason: unknown) => void
    let capturedSignal: AbortSignal | undefined
    fetchMock.mockImplementation((_url: string, init: { signal?: AbortSignal }) => {
      capturedSignal = init.signal
      return new Promise((_resolve, reject) => {
        rejectFetch = reject
      })
    })

    const { result, unmount } = renderHook(() => useCatalogFacets())
    unmount()
    rejectFetch(abortError)
    await Promise.resolve()

    expect(capturedSignal?.aborted).toBe(true)
    expect(result.current.error).toBeNull()
  })
})
