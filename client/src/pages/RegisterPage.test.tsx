// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { RegisterPage } from './RegisterPage'

/**
 * The user's seventh list, items 1 and 3, on the registration form:
 * the club opt-in travels in the payload, and the terms label finally LINKS
 * to terms that exist.
 *
 * 🔴 What is deliberately NOT tested here: the server's handling of
 * `joinClub` (registrationService.test.ts owns it) and the 4b enumeration
 * shape (the server suite owns it end to end).
 */

const BASE_URL = 'http://localhost:3000'

function fill(label: RegExp | string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

function fillValidForm() {
  fill(/First name/i, 'Test')
  fill(/Last name/i, 'Shopper')
  fill(/Email/i, 'shopper@example.com')
  // String labels are EXACT matches in Testing Library, so 'Password'
  // cannot hit 'Confirm password' — same helper as every other field.
  fill('Password', 'Abcdef12')
  fill('Confirm password', 'Abcdef12')
  fill(/Mobile phone/i, '0509871234')
  fireEvent.click(screen.getByRole('checkbox', { name: /terms of use/i }))
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.stubEnv('VITE_API_BASE_URL', BASE_URL)
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 201,
    json: async () => ({ status: 'registration_received' }),
  }))
  vi.stubGlobal('fetch', fetchMock)
  render(
    <MemoryRouter>
      <RegisterPage />
    </MemoryRouter>,
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function sentBody(): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[0] as [string, { body: string }]
  return JSON.parse(init.body) as Record<string, unknown>
}

describe('item 1 — the club opt-in at registration', () => {
  it('🔴 UNCHECKED by default, and the payload says joinClub: false', async () => {
    const club = screen.getByRole('checkbox', { name: /membership club/i }) as HTMLInputElement
    expect(club.checked).toBe(false)

    fillValidForm()
    fireEvent.click(screen.getByRole('button', { name: /Create account/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(sentBody().joinClub).toBe(false)
  })

  it('checking the box sends joinClub: true', async () => {
    fillValidForm()
    fireEvent.click(screen.getByRole('checkbox', { name: /membership club/i }))
    fireEvent.click(screen.getByRole('button', { name: /Create account/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(sentBody().joinClub).toBe(true)
  })
})

describe('item 3 — the terms are readable from the form', () => {
  it('a link to /terms sits BESIDE the consent row (never inside the label), opening a new tab', () => {
    const link = screen.getByRole('link', { name: /terms of use/i })
    expect(link.getAttribute('href')).toBe('/terms')
    expect(link.getAttribute('target')).toBe('_blank')
    // The nested-interactive guard: the link must NOT live inside the
    // checkbox's <label>, where it swallows the click-to-toggle area and
    // embeds itself in the accessible name (review finding).
    expect(link.closest('label')).toBeNull()
    // And the checkbox keeps a plain-text accessible name.
    expect(
      screen.getByRole('checkbox', { name: /terms of use/i }).getAttribute('aria-invalid'),
    ).toBeNull()
  })
})
