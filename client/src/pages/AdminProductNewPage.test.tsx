// @vitest-environment jsdom
// ISSUE-145 — the create form's OUTCOME VISIBILITY regression tests.
//
// The user's report: "adding a product does not work at all, and you cannot
// tell what blocks it". The server refused correctly with named codes; the
// refusal rendered at the TOP of the page while the submit button sits at
// the bottom of a long form — off-screen, so the click read as a no-op.
// These tests pin the fix: the outcome regions live AFTER the form (beside
// the submit button in document order), and a refusal's codes surface as
// visible mapped text. Rendered under StrictMode like the real app.

import { StrictMode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { AdminProductNewPage } from './AdminProductNewPage'

const BASE_URL = 'http://localhost:3000'

const OPTIONS_BODY = {
  categories: [{ id: 'cat-1', nameHe: 'ויטמינים', nameEn: 'Vitamins' }],
  brands: [{ id: 'brand-1', name: 'ECOSUPP', nameEn: 'ECOSUPP' }],
  healthGoals: [],
}

function mockResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

function renderPage() {
  return render(
    <StrictMode>
      <MemoryRouter>
        <AdminProductNewPage />
      </MemoryRouter>
    </StrictMode>,
  )
}

beforeEach(async () => {
  vi.stubEnv('VITE_API_BASE_URL', BASE_URL)
  await i18n.changeLanguage('he')
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('AdminProductNewPage — ISSUE-145 outcome visibility', () => {
  it('🔴 a refused create surfaces its named codes as visible text in the role=alert region', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url.endsWith('/options')) return Promise.resolve(mockResponse(200, OPTIONS_BODY))
      return Promise.resolve(
        mockResponse(400, {
          error: {
            code: 'PRODUCT_CREATE_INVALID',
            message: 'invalid',
            fields: ['price', 'nameEn'],
            codes: ['PRICE_INVALID', 'NAME_EN_REQUIRED'],
          },
        }),
      )
    })
    renderPage()
    const submit = await screen.findByRole('button', {
      name: i18n.t('admin:products.form.submit'),
    })
    fireEvent.click(submit)

    const alert = screen.getByRole('alert')
    await waitFor(() => {
      expect(alert.textContent).toContain(i18n.t('admin:products.errors.PRICE_INVALID'))
      expect(alert.textContent).toContain(i18n.t('admin:products.errors.NAME_EN_REQUIRED'))
    })
  })

  it('🔴 the outcome regions sit AFTER the submit button in document order (the off-screen-refusal regression)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, OPTIONS_BODY))
    renderPage()
    const submit = await screen.findByRole('button', {
      name: i18n.t('admin:products.form.submit'),
    })
    const alert = screen.getByRole('alert')
    // FOLLOWING = the alert comes after the submit button — beside where
    // the admin's eyes are when the refusal lands, never a page-top region
    // a long form scrolled out of view.
    expect(
      submit.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })
})
