// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useProductDetail } from './useProductDetail'

/**
 * MILESTONE-005 Checkpoint J — `useProductDetail`'s effect. Same rationale
 * and the same file-scoped jsdom pragma as `useCatalogData.test.ts`
 * (DEC-051): the hook's whole job lives inside a `useEffect`, which
 * `renderToStaticMarkup` never runs.
 *
 * The properties that matter: one request per slug, §9b cancellation that
 * produces no terminal state, the §7 404 becoming `notFound` rather than an
 * error, no stale product surviving a failure, and a language toggle
 * re-resolving copy WITHOUT refetching.
 */

const BASE_URL = 'http://localhost:3000'

const DETAIL = {
  slug: 'solgar-omega-3',
  nameHe: 'אומגה 3',
  nameEn: 'Omega 3',
  categoryNameHe: 'אומגה ושומנים',
  categoryNameEn: 'Omega & Fats',
  categorySlug: 'omega-fats',
  brandName: 'סולגאר',
  dosageForm: 'CAPSULE',
  packageQuantity: 100,
  price: '94.90',
  stockQuantity: 60,
  lowStockThreshold: 5,
  imageFile: 'omega.jpg',
  serialNumber: 'uuid-1',
  usageInstructions: 'כמוסה אחת ביום',
  images: ['omega.jpg'],
  descriptionHe: 'תיאור בעברית',
  descriptionEn: 'English description',
  warningsAllergens: 'מכיל דגים',
  ingredients: [{ name: 'EPA', amount: '180.00', unit: 'mg' }],
  healthGoals: [{ nameHe: 'לב וכלי דם', nameEn: 'Heart' }],
  targetAudience: null,
  createdAt: '2026-01-01T00:00:00.000Z',
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

function response(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

describe('useProductDetail', () => {
  it('loads a product for the slug and resolves it in the requested language', async () => {
    fetchMock.mockResolvedValue(response(200, DETAIL))
    const { result } = renderHook(() => useProductDetail('solgar-omega-3', 'he'))

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.product?.serialNumber).toBe('uuid-1')
    expect(result.current.product?.description).toBe('תיאור בעברית')
    expect(result.current.error).toBeNull()
    expect(result.current.notFound).toBe(false)
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE_URL}/api/products/solgar-omega-3`)
  })

  it('re-resolves copy on a language change WITHOUT refetching (§9b)', async () => {
    fetchMock.mockResolvedValue(response(200, DETAIL))
    const { result, rerender } = renderHook(({ language }) => useProductDetail('solgar-omega-3', language), {
      initialProps: { language: 'he' as const },
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.product?.description).toBe('תיאור בעברית')

    rerender({ language: 'en' as unknown as 'he' })

    expect(result.current.product?.description).toBe('English description')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refetches when the slug changes, and only then', async () => {
    fetchMock.mockResolvedValue(response(200, DETAIL))
    const { result, rerender } = renderHook(({ slug }) => useProductDetail(slug, 'he'), {
      initialProps: { slug: 'solgar-omega-3' },
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    rerender({ slug: 'solgar-omega-3' })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    rerender({ slug: 'other-product' })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[1][0]).toBe(`${BASE_URL}/api/products/other-product`)
  })

  it('maps the §7 404 to notFound, with no error state', async () => {
    fetchMock.mockResolvedValue(
      response(404, { error: { code: 'PRODUCT_NOT_FOUND', message: 'The requested product was not found.' } }),
    )
    const { result } = renderHook(() => useProductDetail('nope', 'he'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.notFound).toBe(true)
    expect(result.current.error).toBeNull()
    expect(result.current.product).toBeNull()
  })

  it('maps a genuine failure to error, never to notFound', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const { result } = renderHook(() => useProductDetail('x', 'he'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toMatchObject({ code: 'NETWORK_ERROR' })
    expect(result.current.notFound).toBe(false)
  })

  it('clears a previously loaded product when a later request fails', async () => {
    fetchMock.mockResolvedValueOnce(response(200, DETAIL)).mockRejectedValue(new TypeError('Failed to fetch'))
    const { result, rerender } = renderHook(({ slug }) => useProductDetail(slug, 'he'), {
      initialProps: { slug: 'solgar-omega-3' },
    })

    await waitFor(() => expect(result.current.product).not.toBeNull())
    rerender({ slug: 'broken' })

    await waitFor(() => expect(result.current.error).not.toBeNull())
    // No stale product underneath the error state.
    expect(result.current.product).toBeNull()
  })

  it('retry() re-issues the same request', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(response(200, DETAIL))
    const { result } = renderHook(() => useProductDetail('solgar-omega-3', 'he'))

    await waitFor(() => expect(result.current.error).not.toBeNull())
    result.current.retry()

    await waitFor(() => expect(result.current.error).toBeNull())
    expect(result.current.product?.serialNumber).toBe('uuid-1')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('aborts the in-flight request on unmount and writes no state after it', async () => {
    let capturedSignal: AbortSignal | undefined
    fetchMock.mockImplementation((_url: string, init: { signal?: AbortSignal }) => {
      capturedSignal = init.signal
      return new Promise(() => {
        // Never settles — the unmount must be what ends this request.
      })
    })

    const { result, unmount } = renderHook(() => useProductDetail('solgar-omega-3', 'he'))
    expect(capturedSignal?.aborted).toBe(false)

    unmount()
    expect(capturedSignal?.aborted).toBe(true)
    expect(result.current.error).toBeNull()
    expect(result.current.notFound).toBe(false)
  })

  it('a superseded request cannot overwrite the newer one it lost to', async () => {
    let resolveFirst!: (value: Response) => void
    fetchMock
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveFirst = resolve
          }),
      )
      .mockResolvedValue(response(200, { ...DETAIL, slug: 'second', serialNumber: 'uuid-2' }))

    const { result, rerender } = renderHook(({ slug }) => useProductDetail(slug, 'he'), {
      initialProps: { slug: 'first' },
    })
    rerender({ slug: 'second' })

    await waitFor(() => expect(result.current.product?.serialNumber).toBe('uuid-2'))

    // The first request now resolves, far too late.
    resolveFirst(response(200, { ...DETAIL, slug: 'first', serialNumber: 'uuid-STALE' }))
    await Promise.resolve()
    await Promise.resolve()

    expect(result.current.product?.serialNumber).toBe('uuid-2')
  })
})
