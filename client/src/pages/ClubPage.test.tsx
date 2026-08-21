// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import i18n from '../i18n'
import { ClubPage } from './ClubPage'
import * as accountApi from '../lib/accountApi'
import type { ClubStatusResult } from '../types/account'

/**
 * MILESTONE-012 Checkpoint B, amended by DEC-097 (ISSUE-170/171): joining
 * is a FORMAL dialog — benefits, terms link, an explicit consent checkbox
 * gating the confirm — and leaving is its own confirm dialog. The opener
 * button never unmounts on success (relabelled in place); the dialog closes
 * after the action settles; failures land in the page's always-mounted
 * alert region while the dialog stays open. StrictMode, like the app.
 */

vi.mock('../lib/accountApi', () => ({
  requestClubStatus: vi.fn(),
  requestClubAction: vi.fn(),
}))

const mockStatus = vi.mocked(accountApi.requestClubStatus)
const mockAction = vi.mocked(accountApi.requestClubAction)

const ok = (isClubMember: boolean): ClubStatusResult => ({
  ok: true,
  status: { isClubMember, clubJoinedAt: isClubMember ? '2026-08-15T00:00:00Z' : null },
})

function renderPage() {
  return render(
    <StrictMode>
      <MemoryRouter>
        <ClubPage />
      </MemoryRouter>
    </StrictMode>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  /* jsdom has no matchMedia; usePresence (CenterDialog's exit motion)
     calls it on close. Reduced motion reported OFF, as in production. */
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

afterEach(cleanup)

describe('ClubPage — join/leave without losing the shopper', () => {
  it('🔴 DEC-097: joining is dialog + CONSENT — the confirm is inert until the checkbox is ticked', async () => {
    mockStatus.mockResolvedValue(ok(false))
    mockAction.mockResolvedValue(ok(true))
    renderPage()

    const joinButton = await screen.findByRole('button', { name: i18n.t('club:page.join') })
    fireEvent.click(joinButton)

    // The dialog opened; the confirm refuses without consent.
    const confirm = await screen.findByRole('button', { name: i18n.t('club:joinDialog.confirm') })
    expect(confirm.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(confirm)
    expect(mockAction).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('checkbox', { name: i18n.t('club:joinDialog.consent') }))
    expect(confirm.getAttribute('aria-disabled')).toBeNull()
    fireEvent.click(confirm)

    expect(mockAction).toHaveBeenCalledWith('join')
    // The dialog closes after the settle (its exit transition ends via the
    // presence fallback in jsdom), background inertness lifts, and the SAME
    // opener is relabelled.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: i18n.t('club:joinDialog.confirm') })).toBeNull(),
    )
    await screen.findByText(i18n.t('club:page.joined'))
    expect(screen.getByRole('button', { name: i18n.t('club:page.leave') })).toBe(joinButton)
    expect(screen.getByText(i18n.t('club:page.statusMember'))).toBeTruthy()
  })

  it('DEC-097: leaving asks for confirmation; cancel changes nothing', async () => {
    mockStatus.mockResolvedValue(ok(true))
    mockAction.mockResolvedValue(ok(false))
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: i18n.t('club:page.leave') }))
    // Cancel first — the membership must survive it.
    fireEvent.click(await screen.findByRole('button', { name: i18n.t('club:leaveDialog.cancel') }))
    expect(mockAction).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: i18n.t('club:leaveDialog.cancel') })).toBeNull(),
    )
    expect(screen.getByText(i18n.t('club:page.statusMember'))).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: i18n.t('club:page.leave') }))
    fireEvent.click(await screen.findByRole('button', { name: i18n.t('club:leaveDialog.confirm') }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: i18n.t('club:leaveDialog.confirm') })).toBeNull(),
    )
    await screen.findByText(i18n.t('club:page.left'))
    expect(mockAction).toHaveBeenCalledWith('leave')
    expect(screen.getByText(i18n.t('club:page.statusNotMember'))).toBeTruthy()
  })

  it('🔴 an in-flight press is ignored — one request per decision', async () => {
    mockStatus.mockResolvedValue(ok(false))
    let release: (value: ClubStatusResult) => void = () => {}
    mockAction.mockImplementation(
      () => new Promise<ClubStatusResult>((resolve) => { release = resolve }),
    )
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: i18n.t('club:page.join') }))
    fireEvent.click(screen.getByRole('checkbox', { name: i18n.t('club:joinDialog.consent') }))
    const confirm = screen.getByRole('button', { name: i18n.t('club:joinDialog.confirm') })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(mockAction).toHaveBeenCalledTimes(1)

    release(ok(true))
    await screen.findByText(i18n.t('club:page.joined'))
  })

  it('a failed action lands in the alert region and the button STAYS', async () => {
    mockStatus.mockResolvedValue(ok(false))
    mockAction.mockResolvedValue({ ok: false, failure: 'unavailable' })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: i18n.t('club:page.join') }))
    fireEvent.click(screen.getByRole('checkbox', { name: i18n.t('club:joinDialog.consent') }))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('club:joinDialog.confirm') }))
    await screen.findByText(i18n.t('club:page.error'))
    // 🔴 The audible copy lives INSIDE the dialog — the page's alert region
    // sits in #root, which Modal makes inert while the dialog is open
    // (hundred-second pass review).
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('alert').textContent).toBe(i18n.t('club:page.error'))
    // The dialog STAYS open on failure — the confirm remains under the
    // shopper's hand for a retry.
    expect(screen.getByRole('button', { name: i18n.t('club:joinDialog.confirm') })).toBeTruthy()
  })

  it('a failed LOAD offers a retry that reloads', async () => {
    // StrictMode mounts the effect twice; the second mount's load ABORTS the
    // first, so the state the shopper sees is call #2's. Two failures cover
    // both mounts; the third call is the retry's.
    mockStatus.mockResolvedValueOnce({ ok: false, failure: 'unavailable' })
    mockStatus.mockResolvedValueOnce({ ok: false, failure: 'unavailable' })
    mockStatus.mockResolvedValueOnce(ok(false))
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: i18n.t('club:page.retry') }))
    await screen.findByRole('button', { name: i18n.t('club:page.join') })
    await waitFor(() => expect(mockStatus.mock.calls.length).toBeGreaterThanOrEqual(2))
  })

  it('both live regions are mounted from the first render — an announcement is a text CHANGE', async () => {
    mockStatus.mockResolvedValue(ok(false))
    renderPage()
    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.getByRole('alert')).toBeTruthy()
  })
})
