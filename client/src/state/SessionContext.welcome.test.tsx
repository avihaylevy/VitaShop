// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider, useSession } from './SessionContext'

/**
 * ISSUE-112 — the welcome toast's TRIGGER contract (the user chose a toast):
 *
 *   · a refresh() that TURNS the session authenticated sets welcomeName
 *   · page-load hydration of an already-authenticated session does NOT
 *   · the server's fail-closed branch (no firstName) does NOT
 *
 * 🔴 Rendered under <StrictMode>, per .claude/rules/browser-verification.md:
 * the decision is made from a status ref BEFORE setState, and StrictMode's
 * double-invocation is exactly what catches an impure-updater regression
 * (the DEC-073 drawer family).
 */

/**
 * A STATEFUL session mock, not a call-counting sequence: StrictMode runs the
 * hydration effect twice (mount/unmount/remount), so counting calls would
 * let the SECOND hydration consume the "signed in" body and the test would
 * assert against an accident of effect scheduling. The server's answer here
 * changes only when the test says the user signed in — like the real one.
 */
function respondSessionState(initial: unknown) {
  const state = { body: initial }
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => state.body }) as unknown as Response),
  )
  return { setBody: (body: unknown) => (state.body = body) }
}

function Harness() {
  const { welcomeName, refresh, dismissWelcome } = useSession()
  return (
    <div>
      <p data-testid="welcome">{welcomeName ?? '(none)'}</p>
      <button type="button" onClick={() => void refresh()}>
        refresh
      </button>
      <button type="button" onClick={dismissWelcome}>
        dismiss
      </button>
    </div>
  )
}

function renderHarness() {
  return render(
    <StrictMode>
      <SessionProvider>
        <Harness />
      </SessionProvider>
    </StrictMode>,
  )
}

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('ISSUE-112 — when the welcome fires', () => {
  it('🔴 a refresh that turns the session authenticated sets the welcome name', async () => {
    const server = respondSessionState({ authenticated: false })
    renderHarness()
    await waitFor(() => expect(screen.getByTestId('welcome').textContent).toBe('(none)'))

    server.setBody({ authenticated: true, role: 'customer', firstName: 'Avihay', email: 'a@b.c' })
    await act(async () => {
      screen.getByRole('button', { name: 'refresh' }).click()
    })
    await waitFor(() => expect(screen.getByTestId('welcome').textContent).toBe('Avihay'))
  })

  it('🔴 page-load hydration of an existing session shows NO welcome', async () => {
    respondSessionState({ authenticated: true, role: 'customer', firstName: 'Avihay', email: 'a@b.c' })
    renderHarness()

    // Hydration settles authenticated — and the welcome must stay silent.
    await waitFor(() => expect(screen.getByTestId('welcome').textContent).toBe('(none)'))
  })

  it('the fail-closed branch (no firstName) welcomes nobody rather than inventing a name', async () => {
    const server = respondSessionState({ authenticated: false })
    renderHarness()
    await waitFor(() => expect(screen.getByTestId('welcome').textContent).toBe('(none)'))

    server.setBody({ authenticated: true, role: 'customer' })
    await act(async () => {
      screen.getByRole('button', { name: 'refresh' }).click()
    })
    await waitFor(() => expect(screen.getByTestId('welcome').textContent).toBe('(none)'))
  })

  it('a refresh while ALREADY authenticated does not re-welcome', async () => {
    const server = respondSessionState({ authenticated: false })
    renderHarness()
    await waitFor(() => expect(screen.getByTestId('welcome').textContent).toBe('(none)'))

    server.setBody({ authenticated: true, role: 'customer', firstName: 'Avihay', email: 'a@b.c' })
    await act(async () => {
      screen.getByRole('button', { name: 'refresh' }).click()
    })
    await waitFor(() => expect(screen.getByTestId('welcome').textContent).toBe('Avihay'))

    // The toast times out (dismiss), then a routine session re-read runs.
    // A second refresh on an ALREADY-authenticated session must not
    // resurrect the welcome — '(none)' stays '(none)'.
    await act(async () => {
      screen.getByRole('button', { name: 'dismiss' }).click()
    })
    expect(screen.getByTestId('welcome').textContent).toBe('(none)')
    await act(async () => {
      screen.getByRole('button', { name: 'refresh' }).click()
    })
    await waitFor(() => expect(screen.getByTestId('welcome').textContent).toBe('(none)'))
  })
})
