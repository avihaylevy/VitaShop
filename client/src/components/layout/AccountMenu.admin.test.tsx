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

describe('ISSUE-112 — the signed-in NAME is visible on the trigger itself', () => {
  it('🔴 greets by first name when the session carries one', async () => {
    respondSession({ authenticated: true, role: 'customer', firstName: 'Avihay', email: 'shopper@vitashop.local' })
    renderMenu()

    const trigger = await screen.findByRole('button', { name: /account menu/i })
    await waitFor(() => expect(trigger.textContent).toContain('Hi Avihay'))
  })

  it('🔴 the greeting label is BOUNDED — firstName has no server-side length cap', async () => {
    // registrationForm.ts caps nothing beyond min(1), so a 120-char name is
    // legal. jsdom asserts the truncate+max-width classes (it computes no
    // layout); the visual ellipsis is the signed-in browser pass's half.
    respondSession({ authenticated: true, role: 'customer', firstName: 'x'.repeat(120), email: 'a@b.c' })
    renderMenu()

    const trigger = await screen.findByRole('button', { name: /account menu/i })
    await waitFor(() => expect(trigger.textContent).toContain('x'.repeat(120)))
    const label = [...trigger.querySelectorAll('span')].find(
      (s) => s.childElementCount === 0 && s.textContent?.includes('xxx'),
    )
    expect(label?.className).toContain('truncate')
    expect(label?.className).toContain('max-w-40')
  })

  it('falls back to "My account" when the server omitted the identity (fail-closed)', async () => {
    respondSession({ authenticated: true, role: 'customer' })
    renderMenu()

    const trigger = await screen.findByRole('button', { name: /account menu/i })
    await waitFor(() => expect(trigger.textContent).toContain('My account'))
    expect(trigger.textContent).not.toMatch(/Hi /)
  })
})

describe('ISSUE-039 — keyboard menu behaviour (review finding: it had no regression net)', () => {
  it('🔴 opening moves focus to the FIRST menuitem, arrows cycle with wrap, End jumps last', async () => {
    respondSession({ authenticated: false })
    renderMenu()
    await waitFor(() => expect(screen.queryByRole('button', { name: /account menu/i })).toBeTruthy())
    await openMenu()

    const items = await screen.findAllByRole('menuitem')
    await waitFor(() => expect(document.activeElement).toBe(items[0]))

    fireEvent.keyDown(items[0], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])
    // Wrap: down from the last returns to the first.
    fireEvent.keyDown(items[1], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[0])
    // Up from the first wraps to the last.
    fireEvent.keyDown(items[0], { key: 'ArrowUp' })
    expect(document.activeElement).toBe(items[items.length - 1])
    fireEvent.keyDown(items[items.length - 1], { key: 'End' })
    expect(document.activeElement).toBe(items[items.length - 1])
    fireEvent.keyDown(items[items.length - 1], { key: 'Home' })
    expect(document.activeElement).toBe(items[0])
  })

  it('🔴 ArrowUp with NO item focused enters at the LAST item — the (-1) off-by-one the review caught', async () => {
    respondSession({ authenticated: false })
    renderMenu()
    await waitFor(() => expect(screen.queryByRole('button', { name: /account menu/i })).toBeTruthy())
    await openMenu()
    const items = await screen.findAllByRole('menuitem')

    // Simulate focus not sitting on any menuitem (the effect not landed /
    // focus on the container): dispatch from the menu element itself.
    const menu = screen.getByRole('menu')
    ;(document.activeElement as HTMLElement | null)?.blur()
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(items[items.length - 1])
  })

  it('Tab CLOSES the menu and moves focus to the TRIGGER first (APG + the unmount-takes-focus family)', async () => {
    respondSession({ authenticated: false })
    renderMenu()
    await waitFor(() => expect(screen.queryByRole('button', { name: /account menu/i })).toBeTruthy())
    await openMenu()
    const items = await screen.findAllByRole('menuitem')

    fireEvent.keyDown(items[0], { key: 'Tab' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    // 🔴 The focused menuitem unmounts on close; without an explicit focus
    // move the browser's default Tab restarts from the document top. jsdom
    // can assert the explicit move only — the default-Tab continuation is
    // browser-verified (jsdom has no sequential focus navigation).
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /account menu/i }))
  })
})
