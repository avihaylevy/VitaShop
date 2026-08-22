// @vitest-environment jsdom
// MILESTONE-011 Checkpoint B — AgentWidget tests: the pieces the panel
// harness deliberately fakes. StrictMode-rendered like the app.

import { StrictMode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { CartProvider } from '../../state/CartContext'
import { AgentWidget } from './AgentWidget'

const BASE_URL = 'http://localhost:3000'

const EMPTY_CART = {
  id: 'cart-1',
  items: [],
  totalQuantity: 0,
  subtotal: '0.00',
  clubMember: false,
}

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

function agentReply(clarifyingQuestion: string): unknown {
  return {
    products: [],
    explanations: [],
    notice: null,
    clarifyingQuestion,
    clarifyCode: null,
    medicalStop: false,
    handoff: null,
    emptyResult: false,
    topPick: false,
  }
}

/** Routes fetches by URL: the cart bootstrap GET vs the agent POST. */
function stubFetch(agentBody: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = String(input)
    if (url.includes('/api/ai/chat')) {
      return Promise.resolve(jsonResponse(200, agentBody))
    }
    return Promise.resolve(jsonResponse(200, { cart: EMPTY_CART }))
  })
}

function renderWidget() {
  return render(
    <StrictMode>
      <MemoryRouter>
        <CartProvider>
          <AgentWidget />
        </CartProvider>
      </MemoryRouter>
    </StrictMode>,
  )
}

beforeEach(async () => {
  vi.stubEnv('VITE_API_BASE_URL', BASE_URL)
  // jsdom has no matchMedia; usePresence (the drawer's motion handling)
  // needs it when the panel closes. Reduced motion reported OFF, as in
  // production — the same stub useAddToCart.test.tsx documents.
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
  await i18n.changeLanguage('he')
  window.sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function openPanelAndSend(text: string) {
  fireEvent.click(screen.getByRole('button', { name: i18n.t('agent:button.open') }))
  const input = await screen.findByRole('textbox', { name: i18n.t('agent:panel.placeholder') })
  fireEvent.change(input, { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: i18n.t('agent:panel.send') }))
}

describe('AgentWidget', () => {
  it('the floating button opens the panel with the composer focused target present', async () => {
    stubFetch(agentReply('?'))
    renderWidget()
    fireEvent.click(screen.getByRole('button', { name: i18n.t('agent:button.open') }))
    await screen.findByRole('dialog', { name: i18n.t('agent:panel.title') })
    expect(
      screen.getByRole('textbox', { name: i18n.t('agent:panel.placeholder') }),
    ).toBeTruthy()
  })

  it('🔴 the transcript survives close and reopen (DEC-091 O1 — the widget owns it)', async () => {
    stubFetch(agentReply('איזה רכיב מעניין אותך?'))
    renderWidget()
    await openPanelAndSend('שלום')
    await within(await screen.findByRole('log')).findByText('איזה רכיב מעניין אותך?')

    fireEvent.click(screen.getByRole('button', { name: i18n.t('agent:panel.close') }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: i18n.t('agent:panel.title') })).toBeNull(),
    )

    fireEvent.click(screen.getByRole('button', { name: i18n.t('agent:button.open') }))
    const log = await screen.findByRole('log')
    expect(within(log).getByText('שלום')).toBeTruthy()
    expect(within(log).getByText('איזה רכיב מעניין אותך?')).toBeTruthy()
  })

  it('🔴 the live region is OUTSIDE the drawer and repeats identical outcomes in fresh nodes', async () => {
    stubFetch(agentReply('שאלה?'))
    renderWidget()
    await openPanelAndSend('שלום')
    const status = await waitFor(() => {
      const region = screen.getByRole('status')
      expect(region.textContent).toBe('שאלה?')
      return region
    })
    const firstNode = status.firstElementChild

    // Same reply again — the region must carry a NEW child node so the
    // identical sentence is re-announced (review: a same-string state write
    // changes no DOM and screen readers hear nothing).
    fireEvent.change(screen.getByRole('textbox', { name: i18n.t('agent:panel.placeholder') }), {
      target: { value: 'שוב' },
    })
    fireEvent.click(screen.getByRole('button', { name: i18n.t('agent:panel.send') }))
    await waitFor(() => {
      const region = screen.getByRole('status')
      expect(region.textContent).toBe('שאלה?')
      expect(region.firstElementChild).not.toBe(firstNode)
    })

    // And it stays mounted when the panel closes.
    fireEvent.click(screen.getByRole('button', { name: i18n.t('agent:panel.close') }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: i18n.t('agent:panel.title') })).toBeNull(),
    )
    expect(screen.getByRole('status')).toBeTruthy()
  })
})
