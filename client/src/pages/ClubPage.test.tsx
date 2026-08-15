// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import i18n from '../i18n'
import { ClubPage } from './ClubPage'
import * as accountApi from '../lib/accountApi'
import type { ClubStatusResult } from '../types/account'

/**
 * MILESTONE-012 Checkpoint B — the club surface's contract: the toggle
 * button NEVER unmounts on success (the unmount-takes-focus family), repeat
 * outcomes re-announce (identity-keyed, not string-keyed), in-flight presses
 * are ignored, and failures land in an always-mounted alert region.
 * StrictMode, like the app (the impure-updater lesson).
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
      <ClubPage />
    </StrictMode>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
})

afterEach(cleanup)

describe('ClubPage — join/leave without losing the shopper', () => {
  it('a non-member sees the join button; joining announces and the SAME button becomes leave', async () => {
    mockStatus.mockResolvedValue(ok(false))
    mockAction.mockResolvedValue(ok(true))
    renderPage()

    const joinButton = await screen.findByRole('button', { name: i18n.t('club:page.join') })
    fireEvent.click(joinButton)

    await screen.findByText(i18n.t('club:page.joined'))
    // 🔴 The SAME element — relabelled, never remounted, so focus has
    // nowhere to fall.
    expect(screen.getByRole('button', { name: i18n.t('club:page.leave') })).toBe(joinButton)
    expect(mockAction).toHaveBeenCalledWith('join')
    expect(screen.getByText(i18n.t('club:page.statusMember'))).toBeTruthy()
  })

  it('leaving after joining announces the leave outcome', async () => {
    mockStatus.mockResolvedValue(ok(true))
    mockAction.mockResolvedValue(ok(false))
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: i18n.t('club:page.leave') }))
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

    const button = await screen.findByRole('button', { name: i18n.t('club:page.join') })
    fireEvent.click(button)
    fireEvent.click(button)
    fireEvent.click(button)
    expect(mockAction).toHaveBeenCalledTimes(1)

    release(ok(true))
    await screen.findByText(i18n.t('club:page.joined'))
  })

  it('a failed action lands in the alert region and the button STAYS', async () => {
    mockStatus.mockResolvedValue(ok(false))
    mockAction.mockResolvedValue({ ok: false, failure: 'unavailable' })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: i18n.t('club:page.join') }))
    await screen.findByText(i18n.t('club:page.error'))
    expect(screen.getByRole('alert').textContent).toBe(i18n.t('club:page.error'))
    // The control survives its own failure — retrying is one press away.
    expect(screen.getByRole('button', { name: i18n.t('club:page.join') })).toBeTruthy()
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
