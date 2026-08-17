// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { ProfilePage } from './ProfilePage'

/**
 * MILESTONE-009 Checkpoint B — the profile screen's jsdom half: wire
 * bodies, named-code mapping, the cap gate, always-mounted regions.
 * Focus/visual behavior joins the browser matrix.
 */

const BASE_URL = 'http://localhost:3000'

const PROFILE = {
  firstName: 'משה',
  lastName: 'לוי',
  phone: '0521234567',
  defaultAddress: null,
}

function bookBody(addresses: unknown[] = [], cap = 5) {
  return { addresses, cap }
}

const SAVED = {
  id: 'addr-1',
  line1: 'הרצל 12',
  city: 'תל אביב',
  zipCode: null,
  isDefault: true,
}

let fetchMock: ReturnType<typeof vi.fn>

function routeFetch(bodies: { book?: unknown }) {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.endsWith('/api/account/profile') && method === 'GET') {
      return { ok: true, status: 200, json: async () => PROFILE } as unknown as Response
    }
    if (url.endsWith('/api/account/addresses') && method === 'GET') {
      return {
        ok: true,
        status: 200,
        json: async () => bodies.book ?? bookBody(),
      } as unknown as Response
    }
    return { ok: false, status: 500, json: async () => ({}) } as unknown as Response
  })
  vi.stubGlobal('fetch', fetchMock)
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.stubEnv('VITE_API_BASE_URL', BASE_URL)
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function renderPage() {
  return render(
    <MemoryRouter>
      <ProfilePage />
    </MemoryRouter>,
  )
}

describe('the details form', () => {
  it('prefills from the server and PATCHes exactly the three editable fields', async () => {
    routeFetch({})
    renderPage()
    await waitFor(() =>
      expect((screen.getByLabelText('First name') as HTMLInputElement).value).toBe('משה'),
    )

    fetchMock.mockImplementationOnce(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ profile: { firstName: 'דוד', lastName: 'לוי', phone: '0521234567' } }),
    }) as unknown as Response)

    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'דוד' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))

    await waitFor(() =>
      expect(
        screen.getAllByRole('status').some((el) => /details were saved/.test(el.textContent ?? '')),
      ).toBe(true),
    )
    const patchCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
    ) as [string, { body: string }]
    expect(patchCall[0]).toBe(`${BASE_URL}/api/account/profile`)
    // 🔴 No email, no extras — DEC-090 O2's absence is a wire fact.
    expect(JSON.parse(patchCall[1].body)).toEqual({
      firstName: 'דוד',
      lastName: 'לוי',
      phone: '0521234567',
    })
  })

  it('🔴 a named refusal renders its mapped message from the always-mounted alert', async () => {
    routeFetch({})
    renderPage()
    await waitFor(() =>
      expect((screen.getByLabelText('First name') as HTMLInputElement).value).toBe('משה'),
    )

    fetchMock.mockImplementationOnce(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: 'PROFILE_INVALID', codes: ['PHONE_INVALID'] } }),
    }) as unknown as Response)
    fireEvent.change(screen.getByLabelText('Mobile phone'), { target: { value: '123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))

    await waitFor(() =>
      expect(screen.getAllByRole('alert').some((el) => /Israeli mobile/.test(el.textContent ?? ''))).toBe(true),
    )
    // The form survived its own failure — same button, still there.
    expect(screen.getByRole('button', { name: 'Save details' })).toBeDefined()
  })
})

describe('the address book', () => {
  it('lists rows with the default badge; adding POSTs the normalised body', async () => {
    routeFetch({ book: bookBody([SAVED]) })
    renderPage()
    await waitFor(() => expect(screen.getByText(/הרצל 12/)).toBeDefined())
    expect(screen.getByText('Default')).toBeDefined()

    fetchMock.mockImplementationOnce(async () => ({
      ok: true,
      status: 201,
      json: async () => ({
        address: { id: 'addr-2', line1: 'ב', city: 'חיפה', zipCode: null, isDefault: false },
      }),
    }) as unknown as Response)

    fireEvent.change(screen.getByLabelText(/Street, house number/), { target: { value: 'ב' } })
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'חיפה' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
      )
      expect(post).toBeDefined()
    })
    const post = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
    ) as [string, { body: string }]
    // 🔴 An empty zip travels as null, never as ''.
    expect(JSON.parse(post[1].body)).toEqual({ line1: 'ב', city: 'חיפה', zipCode: null })
  })

  it('🔴 at the cap the ADD form is replaced by the cap message — no dead submit', async () => {
    const five = Array.from({ length: 5 }, (_, i) => ({
      id: `addr-${i}`,
      line1: `רחוב ${i}`,
      city: 'תל אביב',
      zipCode: null,
      isDefault: i === 0,
    }))
    routeFetch({ book: bookBody(five) })
    renderPage()
    await waitFor(() => expect(screen.getByText(/רחוב 4/)).toBeDefined())

    expect(screen.getByText(/cap of 5 addresses/)).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull()
    // Editing an EXISTING row is still offered — the cap bounds ADDING.
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(5)
  })
})
