// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { AdminDashboardPage } from './AdminDashboardPage'
import type { AdminDashboardData } from '../types/adminDashboard'

/**
 * DEC-101 — the dashboard screen. jsdom proves: the request the range
 * picker sends, the null-rate "no data" rendering (never 0%), the low-stock
 * panel's two shapes, and the failure vocabulary. Layout/RTL live in the
 * browser matrix.
 */

const BASE_URL = 'http://localhost:3000'

function dashboard(overrides: Partial<AdminDashboardData> = {}): AdminDashboardData {
  return {
    rangeDays: 30,
    sales: { orderCount: 4, turnover: '480.00' },
    salesByDay: [{ date: '2026-08-20', orderCount: 4, turnover: '480.00' }],
    topProducts: [
      {
        productId: 'p-1',
        slug: 'magnesium',
        nameHe: 'מגנזיום',
        nameEn: 'Magnesium',
        quantity: 12,
        turnover: '360.00',
      },
    ],
    funnel: { productView: 100, addToCart: 40, checkoutStarted: 20, purchaseCompleted: 4 },
    kpis: {
      conversionRate: 0.08,
      averageOrderValue: '120.00',
      abandonmentRate: 0.8,
      repeatPurchaseRate: null,
    },
    lowStock: [
      {
        id: 'p-2',
        slug: 'iron',
        nameHe: 'ברזל',
        nameEn: 'Iron',
        stockQuantity: 2,
        lowStockThreshold: 5,
      },
    ],
    lowStockTotal: 1,
    ...overrides,
  }
}

function mockResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.stubEnv('VITE_API_BASE_URL', BASE_URL)
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminDashboardPage />
    </MemoryRouter>,
  )
}

describe('the load and the range picker', () => {
  it('requests days=30 by default and renders the sections', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, dashboard()))
    renderPage()

    await screen.findByText('Conversion funnel')
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/api/admin/dashboard?days=30`,
      expect.objectContaining({ credentials: 'include' }),
    )
    expect(screen.getByText('Top products')).toBeTruthy()
    expect(screen.getByText('Magnesium')).toBeTruthy()
    // The product links to its own detail page.
    expect(screen.getByRole('link', { name: 'Magnesium' }).getAttribute('href')).toBe(
      '/product/magnesium',
    )
  })

  it('🔴 a range press re-requests with that range', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, dashboard()))
    renderPage()
    await screen.findByText('Conversion funnel')

    fireEvent.click(screen.getByRole('button', { name: '7 days' }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `${BASE_URL}/api/admin/dashboard?days=7`,
        expect.objectContaining({ credentials: 'include' }),
      ),
    )
  })
})

describe('the KPI cards', () => {
  it('🔴 a null rate renders "No data", never 0%', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, dashboard()))
    renderPage()
    await screen.findByText('Conversion funnel')

    // repeatPurchaseRate is null in the fixture.
    expect(screen.getByText('No data')).toBeTruthy()
    expect(screen.getByText('8.0%')).toBeTruthy()
    expect(screen.getByText('80.0%')).toBeTruthy()
    expect(screen.queryByText('0.0%')).toBeNull()
  })
})

describe('the low-stock panel (DEC-102)', () => {
  it('lists the alerting product with its stock and threshold', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, dashboard()))
    renderPage()
    await screen.findByText('Low-stock alert')
    expect(screen.getByText('Iron')).toBeTruthy()
    expect(screen.getByText('One product at or under its threshold.')).toBeTruthy()
  })

  it('an empty list renders the calm empty text, not an empty table', async () => {
    fetchMock.mockResolvedValue(
      mockResponse(200, dashboard({ lowStock: [], lowStockTotal: 0 })),
    )
    renderPage()
    await screen.findByText('Low-stock alert')
    expect(screen.getByText('No products at or under their stock threshold.')).toBeTruthy()
  })

  it('🔴 a capped list says how many rows are hidden, from the UNCAPPED total', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, dashboard({ lowStockTotal: 120 })))
    renderPage()
    await screen.findByText('Low-stock alert')
    expect(screen.getByText('120 products at or under their threshold.')).toBeTruthy()
    expect(
      screen.getByText('Showing only the first product; the rest are in the products table.'),
    ).toBeTruthy()
  })
})

describe('failures', () => {
  it('a 403 says not-admin', async () => {
    fetchMock.mockResolvedValue(mockResponse(403, {}))
    renderPage()
    expect(await screen.findByRole('alert')).toBeTruthy()
  })

  it('🔴 a malformed body fails as unavailable, never renders NaN', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, { rangeDays: 30, sales: 'broken' }))
    renderPage()
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByText(/NaN/)).toBeNull()
  })
})
