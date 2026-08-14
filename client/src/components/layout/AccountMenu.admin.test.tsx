// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { SessionProvider } from '../../state/SessionContext'
import { AccountMenu } from './AccountMenu'

/**
 * ISSUE-097 — the admin screen, reachable at last. DEC-071.
 *
 * 🔴 THE SCREEN HAS EXISTED SINCE CHECKPOINT F3b WITH NOTHING LINKING TO IT, so
 * an admin signing in found a site that behaved exactly like a shopper's. The
 * user reported it plainly: "I cannot do anything as an admin."
 *
 * 🔴 THE LINK IS UX, NOT SECURITY, and the tests say so in both directions: a
 * customer does not see it, and — the one that matters — seeing it is not what
 * grants access. `requireAdmin` re-reads `User.role` from the database on every
 * request (DEC-065), which `authSession.integration.test.ts` proves by demoting
 * an admin mid-session and watching the same cookie get a 403.
 */

function respondSession(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => body }) as unknown as Response),
  )
}

function renderMenu() {
  return render(
    <MemoryRouter>
      <SessionProvider>
        <AccountMenu />
      </SessionProvider>
    </MemoryRouter>,
  )
}

async function openMenu() {
  fireEvent.click(await screen.findByRole('button', { name: /account menu/i }))
}

beforeEach(async () => {
  vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000')
  await i18n.changeLanguage('en')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('the account menu', () => {
  it('🔴 shows the admin entry to an ADMIN', async () => {
    respondSession({ authenticated: true, role: 'admin' })
    renderMenu()

    await waitFor(() => expect(screen.queryByRole('button', { name: /account menu/i })).toBeTruthy())
    await openMenu()

    const entry = await screen.findByRole('menuitem', { name: /manage orders/i })
    expect(entry.getAttribute('href')).toBe('/admin/orders')
  })

  it('🔴 hides it from an ordinary shopper', async () => {
    respondSession({ authenticated: true, role: 'customer' })
    renderMenu()

    await waitFor(() => expect(screen.queryByRole('button', { name: /account menu/i })).toBeTruthy())
    await openMenu()

    // The control that keeps this honest: the shopper's OWN orders entry is
    // there, so the menu rendered and only the admin entry is absent.
    expect(await screen.findByRole('menuitem', { name: /my orders/i })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: /manage orders/i })).toBeNull()
  })

  it('🔴 hides it when the role is UNKNOWN — the safe direction', async () => {
    // A future role, a malformed body, a missing key: anything the client does
    // not recognise reads as "not an admin" rather than as an admin.
    respondSession({ authenticated: true, role: 'superuser' })
    renderMenu()

    await waitFor(() => expect(screen.queryByRole('button', { name: /account menu/i })).toBeTruthy())
    await openMenu()

    expect(await screen.findByRole('menuitem', { name: /my orders/i })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: /manage orders/i })).toBeNull()
  })

  it('🔴 hides it when the role is MISSING entirely — the fail-closed server path', async () => {
    // The route omits `role` when it cannot read the row, deliberately: the
    // caller is still signed in, and hiding the link is the safe half.
    respondSession({ authenticated: true })
    renderMenu()

    await waitFor(() => expect(screen.queryByRole('button', { name: /account menu/i })).toBeTruthy())
    await openMenu()

    expect(screen.queryByRole('menuitem', { name: /manage orders/i })).toBeNull()
  })

  it('shows nothing of the sort to a GUEST', async () => {
    respondSession({ authenticated: false })
    renderMenu()

    await waitFor(() => expect(screen.queryByRole('button', { name: /account menu/i })).toBeTruthy())
    await openMenu()

    expect(await screen.findByRole('menuitem', { name: /sign in/i })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: /manage orders/i })).toBeNull()
  })
})

describe('ISSUE-089 — the menu says WHO is signed in', () => {
  it('🔴 renders the name and email the session reported', async () => {
    respondSession({ authenticated: true, role: 'customer', firstName: 'Avihay', email: 'shopper@vitashop.local' })
    renderMenu()

    await waitFor(() => expect(screen.queryByRole('button', { name: /account menu/i })).toBeTruthy())
    await openMenu()

    expect(await screen.findByText(/signed in as/i)).toBeTruthy()
    expect(screen.getByText('Avihay')).toBeTruthy()
    expect(screen.getByText('shopper@vitashop.local')).toBeTruthy()
  })

  it('renders NO identity block when the server omitted it (its fail-closed branch)', async () => {
    respondSession({ authenticated: true, role: 'customer' })
    renderMenu()

    await waitFor(() => expect(screen.queryByRole('button', { name: /account menu/i })).toBeTruthy())
    await openMenu()

    // The menu itself rendered — the control keeping the absence meaningful.
    expect(await screen.findByRole('menuitem', { name: /my orders/i })).toBeTruthy()
    expect(screen.queryByText(/signed in as/i)).toBeNull()
  })

  it('a guest sees no identity and no "signed in as"', async () => {
    respondSession({ authenticated: false })
    renderMenu()

    await waitFor(() => expect(screen.queryByRole('button', { name: /account menu/i })).toBeTruthy())
    await openMenu()

    expect(await screen.findByRole('menuitem', { name: /sign in/i })).toBeTruthy()
    expect(screen.queryByText(/signed in as/i)).toBeNull()
  })
})
