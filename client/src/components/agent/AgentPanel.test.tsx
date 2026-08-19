// @vitest-environment jsdom
// MILESTONE-011 Checkpoint B — the chat surface's component tests.
//
// Rendered under StrictMode like the real app (the DEC-073 impure-updater
// scar). What jsdom cannot represent (focus-visible, cascade, real focus
// loss) is Checkpoint D's browser matrix — the FOCUS behaviour of the lock
// transition is asserted here only as attributes; the matrix verifies it.

import { StrictMode, useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { AgentPanel } from './AgentPanel'
import type { AgentEntry } from '../../lib/agentConversation'
import type { AgentChatResponseDto } from '../../lib/agentApi'
import type { CatalogProductDto } from '../../types/catalog'

const BASE_URL = 'http://localhost:3000'

// 🔴 C4 — the fixed Hebrew referral notice, typed here LITERALLY (not
// imported): this pin proves the PANEL renders the wire string unmutated.
// The cross-wire byte-pin against the server's constant lives in the server
// suite (aiChat.integration.test.ts), which asserts the wire carries
// exactly this text — the two pins together close the loop.
const FIXED_NOTICE_HE =
  'המידע כאן נועד לסייע באיתור מוצרים בקטלוג בלבד ואינו מהווה ייעוץ רפואי. הסוכן אינו מחליף רופא או רוקח. במצבים רפואיים, בהיריון, בשימוש בתרופות או בחשש לתגובה בין מוצרים — יש להתייעץ עם רופא או רוקח לפני נטילת תוסף.'

function productDto(overrides: Partial<CatalogProductDto> = {}): CatalogProductDto {
  return {
    slug: 'magnesium-citrate-200',
    nameHe: 'מגנזיום ציטראט 200',
    nameEn: 'Magnesium Citrate 200',
    categoryNameHe: 'מינרלים',
    categoryNameEn: 'Minerals',
    categorySlug: 'minerals',
    brandName: 'אלטמן',
    brandNameEn: 'Altman',
    dosageForm: 'CAPSULE',
    packageQuantity: 100,
    price: '89.90',
    stockQuantity: 12,
    lowStockThreshold: 5,
    imageFile: null,
    ...overrides,
  }
}

function agentResponse(overrides: Partial<AgentChatResponseDto> = {}): AgentChatResponseDto {
  return {
    products: [],
    explanations: [],
    notice: null,
    clarifyingQuestion: null,
    clarifyCode: null,
    medicalStop: false,
    handoff: null,
    emptyResult: false,
    ...overrides,
  }
}

function agentTurn(overrides: Partial<AgentChatResponseDto> = {}): AgentEntry {
  return { kind: 'agent', lang: 'he', response: agentResponse(overrides) }
}

function mockResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

const announceSpy = vi.fn<(text: string) => void>()
const closeSpy = vi.fn<() => void>()

/** Controlled-state harness — the widget's role, minus the cart machinery. */
function Harness({
  onAddToCart = () => {},
  initialEntries = [],
}: {
  onAddToCart?: (slug: string, quantity: number) => void
  initialEntries?: AgentEntry[]
}) {
  const [entries, setEntries] = useState<AgentEntry[]>(initialEntries)
  return (
    <MemoryRouter>
      <AgentPanel
        open
        onClose={closeSpy}
        onNavigate={closeSpy}
        entries={entries}
        setEntries={setEntries}
        announce={announceSpy}
        addConfirmation={null}
        returnFocusRef={{ current: null }}
        onAddToCart={onAddToCart}
      />
      <LocationProbe />
    </MemoryRouter>
  )
}

/** Where did the router actually go? A click that only closes is not a navigation. */
function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname + location.search}</div>
}

function renderPanel(props: Parameters<typeof Harness>[0] = {}) {
  return render(
    <StrictMode>
      <Harness {...props} />
    </StrictMode>,
  )
}

function transcript(): HTMLElement {
  return screen.getByRole('log')
}

function composerInput(): HTMLInputElement {
  return screen.getByRole('textbox', {
    name: i18n.t('agent:panel.placeholder'),
  }) as HTMLInputElement
}

async function sendMessage(text: string) {
  fireEvent.change(composerInput(), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: i18n.t('agent:panel.send') }))
  await Promise.resolve()
}

beforeEach(async () => {
  vi.stubEnv('VITE_API_BASE_URL', BASE_URL)
  await i18n.changeLanguage('he')
  announceSpy.mockClear()
  closeSpy.mockClear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('AgentPanel', () => {
  it('🔴 renders the FIXED notice byte-for-byte, FIRST in the turn, and leads the announcement with it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(
        200,
        agentResponse({
          notice: FIXED_NOTICE_HE,
          medicalStop: true,
          products: [productDto()],
          explanations: ['הסבר קצר.'],
        }),
      ),
    )
    renderPanel()
    await sendMessage('אני בהריון, מגנזיום')

    const notice = await screen.findByText(FIXED_NOTICE_HE)
    // The notice precedes BOTH the sibling line and the product card —
    // review: the old test compared only against the card, so a notice
    // sliding below the medical-stop line stayed green.
    const stopLine = screen.getByText(i18n.t('agent:reply.medicalStop'))
    const productLink = screen.getByRole('link', { name: 'מגנזיום ציטראט 200' })
    for (const later of [stopLine, productLink]) {
      expect(notice.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    expect(announceSpy).toHaveBeenCalledTimes(1)
    expect(announceSpy.mock.calls[0]![0].startsWith(FIXED_NOTICE_HE)).toBe(true)
  })

  it('control: a reply WITHOUT a notice or clarify code renders neither string', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(200, agentResponse({ products: [productDto()], explanations: [''] })),
    )
    renderPanel()
    await sendMessage('מגנזיום')
    await screen.findByRole('link', { name: 'מגנזיום ציטראט 200' })
    expect(screen.queryByText(FIXED_NOTICE_HE)).toBeNull()
    expect(screen.queryByText(i18n.t('agent:reply.noCriteria'))).toBeNull()
    expect(screen.queryByText(i18n.t('agent:reply.empty'))).toBeNull()
  })

  it('🔴 the send button never unmounts while in flight — aria-disabled, same node after settle', async () => {
    let release: (value: Response) => void = () => {}
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise<Response>((resolve) => (release = resolve)),
    )
    renderPanel()
    await sendMessage('מגנזיום')

    const sending = screen.getByRole('button', { name: i18n.t('agent:panel.sending') })
    expect(sending.getAttribute('aria-disabled')).toBe('true')

    release(mockResponse(200, agentResponse({ clarifyingQuestion: 'איזה רכיב?' })))
    await within(transcript()).findByText('איזה רכיב?')
    expect(screen.getByRole('button', { name: i18n.t('agent:panel.send') })).toBe(sending)
  })

  it('Enter in the input submits the form; Enter during flight sends NOTHING extra', async () => {
    let release: (value: Response) => void = () => {}
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => new Promise<Response>((resolve) => (release = resolve)))
    renderPanel()

    fireEvent.change(composerInput(), { target: { value: 'מגנזיום' } })
    fireEvent.submit(composerInput().closest('form')!)
    await Promise.resolve()
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    // The double-send race (review): a second Enter while in flight must
    // not fire a second request or lose a transcript turn.
    fireEvent.change(composerInput(), { target: { value: 'עוד אחד' } })
    fireEvent.submit(composerInput().closest('form')!)
    await Promise.resolve()
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    release(mockResponse(200, agentResponse({ clarifyingQuestion: 'איזה רכיב?' })))
    await within(transcript()).findByText('איזה רכיב?')
    // Exactly one user turn made it into the transcript.
    expect(within(transcript()).getAllByText('מגנזיום')).toHaveLength(1)
  })

  it('renders the i18n string for a NO_CRITERIA_MATCHED clarify code', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(200, agentResponse({ clarifyCode: 'NO_CRITERIA_MATCHED' })),
    )
    renderPanel()
    await sendMessage('משהו')
    await within(transcript()).findByText(i18n.t('agent:reply.noCriteria'))
  })

  it('renders the empty-result message on emptyResult', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(200, agentResponse({ emptyResult: true, handoff: { maxPrice: '1' } })),
    )
    renderPanel()
    await sendMessage('משהו עד 1 שקל')
    await within(transcript()).findByText(i18n.t('agent:reply.empty'))
  })

  it('maps a 429 to the rate-limit record and announces it once; the composer stays live', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(429, { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many attempts.' } }),
    )
    renderPanel()
    await sendMessage('מגנזיום')
    await within(transcript()).findByText(i18n.t('agent:errors.rateLimited'))
    expect(announceSpy).toHaveBeenCalledWith(i18n.t('agent:errors.rateLimited'))
    expect(screen.getByRole('button', { name: i18n.t('agent:panel.send') })).toBeTruthy()
  })

  it('recovers after an error: the next send works and its history excludes the failed turn', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockResponse(502, { error: { code: 'AI_PROVIDER_FAILED', message: 'down' } }))
      .mockResolvedValue(mockResponse(200, agentResponse({ clarifyingQuestion: 'איזה רכיב?' })))
    renderPanel()

    await sendMessage('הודעה שנכשלה')
    await within(transcript()).findByText(i18n.t('agent:errors.unavailable'))

    await sendMessage('מגנזיום')
    await within(transcript()).findByText('איזה רכיב?')
    // 🔴 The failed turn is excluded from the wire history — review: failed
    // sends used to be re-shipped forever and to consume the turn budget.
    const secondBody = JSON.parse((fetchSpy.mock.calls[1]![1] as RequestInit).body as string) as {
      history: unknown[]
    }
    expect(secondBody.history).toEqual([])
  })

  it('🔴 AI_TURN_LIMIT locks the composer WITHOUT unmounting it, and the limit text renders exactly once', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(400, { error: { code: 'AI_TURN_LIMIT', message: 'Limit.' } }),
    )
    renderPanel()
    await sendMessage('מגנזיום')
    await waitFor(() =>
      expect(screen.getAllByText(i18n.t('agent:reply.turnLimit'))).toHaveLength(1),
    )
    // The composer is STILL THERE — locked, never swapped out (the
    // unmount-takes-focus family; review).
    const input = composerInput()
    expect(input.readOnly).toBe(true)
    expect(input.getAttribute('aria-disabled')).toBe('true')
    expect(
      screen.getByRole('button', { name: i18n.t('agent:panel.send') }).getAttribute('aria-disabled'),
    ).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: i18n.t('agent:reply.newConversation') }))
    expect(screen.queryByText('מגנזיום')).toBeNull()
    expect(composerInput().readOnly).toBe(false)
  })

  it('locks after MAX answered exchanges — and a control at nine stays open', () => {
    const nine = Array.from({ length: 9 }, (_, index) => [
      { kind: 'user', text: `שאלה ${index}` } as AgentEntry,
      agentTurn({ clarifyingQuestion: 'עוד?' }),
    ]).flat()
    const { unmount } = renderPanel({ initialEntries: nine })
    expect(composerInput().readOnly).toBe(false)
    unmount()

    const ten = [...nine, { kind: 'user', text: 'עשירית' } as AgentEntry, agentTurn()]
    renderPanel({ initialEntries: ten })
    expect(composerInput().readOnly).toBe(true)
  })

  it('🔴 failed turns do NOT consume the budget: ten failures leave the conversation open', () => {
    const failures = Array.from({ length: 10 }, (_, index) => [
      { kind: 'user', text: `ניסיון ${index}`, failed: true } as AgentEntry,
      { kind: 'error', code: 'AI_PROVIDER_FAILED' } as AgentEntry,
    ]).flat()
    renderPanel({ initialEntries: failures })
    expect(composerInput().readOnly).toBe(false)
  })

  it('🔴 REQ-F-076: rendering products adds NOTHING to the cart; the card button is the explicit action', async () => {
    const onAddToCart = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(200, agentResponse({ products: [productDto()], explanations: [''] })),
    )
    renderPanel({ onAddToCart })
    await sendMessage('מגנזיום')
    const card = (await screen.findByRole('link', { name: 'מגנזיום ציטראט 200' })).closest('article')!
    expect(onAddToCart).not.toHaveBeenCalled()

    fireEvent.click(within(card as HTMLElement).getByRole('button', { name: i18n.t('agent:addToCart') }))
    expect(onAddToCart).toHaveBeenCalledTimes(1)
    expect(onAddToCart).toHaveBeenCalledWith('magnesium-citrate-200', 1)
    // Control (review): the ADD button must NOT close the panel — only a
    // NAVIGATION does. The conversation continues after an add.
    expect(closeSpy).not.toHaveBeenCalled()
  })

  it('the agent card carries exactly ONE link and ONE button (the catalogue link contract, panel scale)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(200, agentResponse({ products: [productDto()], explanations: ['הסבר.'] })),
    )
    renderPanel()
    await sendMessage('מגנזיום')
    const card = (await screen.findByRole('link', { name: 'מגנזיום ציטראט 200' })).closest('article')!
    expect(within(card as HTMLElement).getAllByRole('link')).toHaveLength(1)
    expect(within(card as HTMLElement).getAllByRole('button')).toHaveLength(1)
  })

  it('🔴 REQ-F-077: an empty result renders the handoff link, clicking it NAVIGATES to /catalog with the criteria and closes the panel', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(
        200,
        agentResponse({ emptyResult: true, handoff: { maxPrice: '1', kosher: 'true' } }),
      ),
    )
    renderPanel()
    await sendMessage('משהו כשר עד שקל')
    const handoffLink = await screen.findByRole('link', { name: i18n.t('agent:reply.handoff') })

    fireEvent.click(handoffLink)
    // 🔴 The ROUTER moved (review: asserting only the close let a future
    // preventDefault kill the navigation while the test stayed green).
    expect(screen.getByTestId('location').textContent).toBe('/catalog?maxPrice=1&kosher=true')
    expect(closeSpy).toHaveBeenCalled()
    // And the empty-result announcement voiced the handoff's existence —
    // the transcript log is deliberately non-live.
    expect(announceSpy.mock.calls[0]![0]).toContain(i18n.t('agent:reply.handoff'))
  })

  it('🔴 a MODIFIED click (ctrl — new tab) neither navigates this tab nor closes the panel', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(200, agentResponse({ emptyResult: true, handoff: { maxPrice: '1' } })),
    )
    renderPanel()
    await sendMessage('משהו')
    const handoffLink = await screen.findByRole('link', { name: i18n.t('agent:reply.handoff') })

    fireEvent.click(handoffLink, { ctrlKey: true })
    expect(screen.getByTestId('location').textContent).toBe('/')
    expect(closeSpy).not.toHaveBeenCalled()
  })

  it('control: an EMPTY handoff object renders no link at all (no unfiltered-catalogue promise)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(200, agentResponse({ emptyResult: true, handoff: {} })),
    )
    renderPanel()
    await sendMessage('משהו')
    await within(transcript()).findByText(i18n.t('agent:reply.empty'))
    expect(screen.queryByRole('link', { name: i18n.t('agent:reply.handoff') })).toBeNull()
  })

  it('control: a NON-empty result renders no handoff link; a product-name click navigates AND closes', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(
        200,
        agentResponse({ products: [productDto()], explanations: [''], handoff: { ingredient: ['x'] } }),
      ),
    )
    renderPanel()
    await sendMessage('מגנזיום')
    const nameLink = await screen.findByRole('link', { name: 'מגנזיום ציטראט 200' })
    expect(screen.queryByRole('link', { name: i18n.t('agent:reply.handoff') })).toBeNull()

    fireEvent.click(nameLink)
    expect(screen.getByTestId('location').textContent).toBe('/product/magnesium-citrate-200')
    expect(closeSpy).toHaveBeenCalled()
  })

  it('history sent to the server carries the whole ANSWERED conversation, agent content = provider prose', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockResponse(200, agentResponse({ clarifyingQuestion: 'איזה רכיב?' })))
    renderPanel()
    await sendMessage('שלום')
    await within(transcript()).findByText('איזה רכיב?')
    await sendMessage('מגנזיום')
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2))

    const secondBody = JSON.parse((fetchSpy.mock.calls[1]![1] as RequestInit).body as string) as {
      history: { role: string; content: string }[]
    }
    expect(secondBody.history).toEqual([
      { role: 'user', content: 'שלום' },
      { role: 'agent', content: 'איזה רכיב?' },
    ])
  })
})
