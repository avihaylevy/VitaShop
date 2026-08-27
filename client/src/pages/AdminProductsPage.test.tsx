// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { AdminProductsPage } from './AdminProductsPage'
import type { AdminProductRow } from '../types/adminProducts'

/**
 * MILESTONE-010 Checkpoint B — the product-admin screen.
 *
 * 🔴 What jsdom CAN prove here: the wire bodies (only changed fields
 * travel), the row replacement from the server's answer, the always-mounted
 * outcome regions, and that the pressed controls survive their own
 * success. The focus/cascade halves live in the browser matrix
 * (browser-verification.md's second family).
 */

const BASE_URL = 'http://localhost:3000'

function row(overrides: Partial<AdminProductRow> = {}): AdminProductRow {
  return {
    id: 'prod-1',
    slug: 'test-product',
    nameHe: 'מוצר בדיקה',
    nameEn: 'Test product',
    price: '50.00',
    stockQuantity: 20,
    lowStockThreshold: 5,
    packageQuantity: 60,
    dosageForm: 'CAPSULE',
    usageInstructions: 'בדיקה',
    descriptionHe: 'תיאור',
    descriptionEn: 'description',
    shortDescriptionHe: 'תקציר', shortDescriptionEn: 'Short', warningsAllergens: '',
    isKosher: null,
    isGlutenFree: null,
    isVegan: null,
    isActive: true,
    createdAt: '2026-08-16T00:00:00.000Z',
    category: { id: 'cat-1', nameHe: 'ויטמינים', nameEn: 'Vitamins' },
    brand: { id: 'brand-1', name: 'אלטמן', nameEn: 'Altman' },
    ...overrides,
  }
}

function listBody(rows: AdminProductRow[]) {
  return { page: 1, totalItems: rows.length, totalPages: 1, products: rows }
}

function mockResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.stubEnv('VITE_API_BASE_URL', BASE_URL)
  fetchMock = vi.fn()
  // The /options fetch (the round-2 brand filter's list) answers OUTSIDE
  // the once-queue below — otherwise it would silently eat the response a
  // test staged for its PATCH, and every call-count assertion would drift
  // by one for a request no test is about.
  vi.stubGlobal('fetch', (url: RequestInfo | URL, init?: RequestInit) =>
    String(url).includes('/api/admin/products/options')
      ? Promise.resolve(mockResponse(200, { categories: [], brands: [], healthGoals: [] }))
      : (fetchMock as unknown as typeof fetch)(url, init),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminProductsPage />
    </MemoryRouter>,
  )
}

describe('the list', () => {
  it('renders rows; an INACTIVE row is shown, struck, and labelled in words', async () => {
    fetchMock.mockResolvedValue(
      mockResponse(200, listBody([row(), row({ id: 'prod-2', slug: 'off', nameEn: 'Hidden one', nameHe: 'מוסתר', isActive: false })])),
    )
    renderPage()

    await waitFor(() => expect(screen.getByText('Test product')).toBeDefined())
    const hidden = screen.getByText('Hidden one')
    expect(hidden.className).toContain('line-through')
    // Never strike-through alone.
    expect(screen.getByText('Hidden from the store')).toBeDefined()
  })

  it('a 403 renders the not-admin message, not a sign-in loop', async () => {
    fetchMock.mockResolvedValue(mockResponse(403, { error: { code: 'ADMIN_REQUIRED' } }))
    renderPage()
    await waitFor(() =>
      expect(screen.getByText(/for administrators only|admin/i)).toBeDefined(),
    )
  })
})

describe('🔴 inline save — only the CHANGED fields travel', () => {
  it('a price edit PATCHes { price } alone, and the row re-renders from the answer', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, listBody([row()])))
    renderPage()
    await waitFor(() => expect(screen.getByText('Test product')).toBeDefined())

    fetchMock.mockResolvedValueOnce(
      mockResponse(200, { product: row({ price: '44.90' }) }),
    )

    fireEvent.change(screen.getByLabelText(/Price for/), { target: { value: '44.90' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const [url, init] = fetchMock.mock.calls[1] as [string, { method: string; body: string }]
    expect(url).toBe(`${BASE_URL}/api/admin/products/prod-1`)
    expect(init.method).toBe('PATCH')
    // 🔴 Stock was untouched, so it must not travel — an omitted field is
    // never overwritten.
    expect(JSON.parse(init.body)).toEqual({ price: '44.90' })

    // The announcement, from the ALWAYS-mounted status region.
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('was updated'))
    // The pressed button survived its own success.
    expect(screen.getByRole('button', { name: 'Save' })).toBeDefined()
  })

  it('🔴 a bad price SUBMITS and the SERVER’s named refusal lands in the alert region', async () => {
    // The repo pattern (RegisterPage): no client pre-check duplicating the
    // server rule — submit, and map the named code.
    fetchMock.mockResolvedValueOnce(mockResponse(200, listBody([row()])))
    renderPage()
    await waitFor(() => expect(screen.getByText('Test product')).toBeDefined())

    fetchMock.mockResolvedValueOnce(
      mockResponse(400, {
        error: { code: 'PRODUCT_PATCH_INVALID', codes: ['PRICE_INVALID'], fields: ['price'] },
      }),
    )
    fireEvent.change(screen.getByLabelText(/Price for/), { target: { value: '44.9' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('00.00'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('🔴 a BLANK stock travels as null — never as a silent zero', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, listBody([row()])))
    renderPage()
    await waitFor(() => expect(screen.getByText('Test product')).toBeDefined())

    fetchMock.mockResolvedValueOnce(
      mockResponse(400, {
        error: { code: 'PRODUCT_PATCH_INVALID', codes: ['STOCK_INVALID'], fields: ['stockQuantity'] },
      }),
    )
    fireEvent.change(screen.getByLabelText(/Stock for/), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const [, init] = fetchMock.mock.calls[1] as [string, { body: string }]
    // JSON.stringify(NaN) === 'null': the server refuses it by name instead
    // of reading blank as 0 and zeroing the stock.
    expect(JSON.parse(init.body)).toEqual({ stockQuantity: null })
    await waitFor(() => expect(screen.getByRole('alert').textContent).not.toBe(''))
  })

  it('🔴 the active toggle KEEPS an unsaved draft — hiding a row must not revert a typed price', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, listBody([row()])))
    renderPage()
    await waitFor(() => expect(screen.getByText('Test product')).toBeDefined())

    fireEvent.change(screen.getByLabelText(/Price for/), { target: { value: '60.00' } })
    fetchMock.mockResolvedValueOnce(mockResponse(200, { product: row({ isActive: false }) }))
    fireEvent.click(screen.getByRole('button', { name: 'Hide from store' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Return to store' })).toBeDefined(),
    )
    expect((screen.getByLabelText(/Price for/) as HTMLInputElement).value).toBe('60.00')
  })
})

describe('🔴 ISSUE-153 — the full editor', () => {
  it('opens from its disclosure, PATCHes ONLY the changed description, and closes state survives the save', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, listBody([row()])))
    renderPage()
    await waitFor(() => expect(screen.getByText('Test product')).toBeDefined())

    const disclosure = screen.getByRole('button', { name: 'Full edit' })
    expect(disclosure.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(disclosure)
    expect(disclosure.getAttribute('aria-expanded')).toBe('true')

    fetchMock.mockResolvedValueOnce(
      mockResponse(200, { product: row({ descriptionHe: 'תיאור חדש' }) }),
    )
    fireEvent.change(screen.getByLabelText('Description in Hebrew'), {
      target: { value: 'תיאור חדש' },
    })
    // Two Save buttons exist now (inline + editor); the editor's is the
    // enabled one — the inline row is not dirty.
    const saves = screen.getAllByRole('button', { name: 'Save' })
    const editorSave = saves.find((b) => b.getAttribute('aria-disabled') !== 'true')!
    fireEvent.click(editorSave)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const [url, init] = fetchMock.mock.calls[1] as [string, { method: string; body: string }]
    expect(url).toBe(`${BASE_URL}/api/admin/products/prod-1`)
    expect(init.method).toBe('PATCH')
    // 🔴 ONLY the changed field travels — names, usage, warnings, package
    // and the dietary claims were untouched.
    expect(JSON.parse(init.body)).toEqual({ descriptionHe: 'תיאור חדש' })

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('was updated'))
    // The editor stayed open and its disclosure survived the save.
    expect(screen.getByRole('button', { name: 'Close editor' })).toBeDefined()
  })

  it('ISSUE-158: a dosage-form change travels alone through the PATCH', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, listBody([row()])))
    renderPage()
    await waitFor(() => expect(screen.getByText('Test product')).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: 'Full edit' }))

    fetchMock.mockResolvedValueOnce(mockResponse(200, { product: row({ dosageForm: 'SYRUP' }) }))
    fireEvent.change(screen.getByLabelText('Dosage form'), { target: { value: 'SYRUP' } })
    const saves = screen.getAllByRole('button', { name: 'Save' })
    fireEvent.click(saves.find((b) => b.getAttribute('aria-disabled') !== 'true')!)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const [, init] = fetchMock.mock.calls[1] as [string, { method: string; body: string }]
    expect(JSON.parse(init.body)).toEqual({ dosageForm: 'SYRUP' })
  })

  it('a dietary claim change travels as the column tri-state (null for "no claim")', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, listBody([row({ isKosher: true })])))
    renderPage()
    await waitFor(() => expect(screen.getByText('Test product')).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: 'Full edit' }))

    fetchMock.mockResolvedValueOnce(mockResponse(200, { product: row({ isKosher: null }) }))
    fireEvent.change(screen.getByLabelText('Kosher'), { target: { value: '' } })
    const saves = screen.getAllByRole('button', { name: 'Save' })
    fireEvent.click(saves.find((b) => b.getAttribute('aria-disabled') !== 'true')!)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const [, init] = fetchMock.mock.calls[1] as [string, { method: string; body: string }]
    expect(JSON.parse(init.body)).toEqual({ isKosher: null })
  })
})

describe('🔴 the INV-03 toggle', () => {
  it('deactivate announces, and the SAME control becomes the reactivation', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, listBody([row()])))
    renderPage()
    await waitFor(() => expect(screen.getByText('Test product')).toBeDefined())

    fetchMock.mockResolvedValueOnce(mockResponse(200, { product: row({ isActive: false }) }))
    fireEvent.click(screen.getByRole('button', { name: 'Hide from store' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Return to store' })).toBeDefined(),
    )
    const [url, init] = fetchMock.mock.calls[1] as [string, { method: string; body: string }]
    expect(url).toBe(`${BASE_URL}/api/admin/products/prod-1/active`)
    expect(JSON.parse(init.body)).toEqual({ isActive: false })
    expect(screen.getByRole('status').textContent).not.toBe('')
  })
})
