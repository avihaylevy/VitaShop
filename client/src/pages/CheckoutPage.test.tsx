// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { CheckoutPage } from './CheckoutPage'

/**
 * MILESTONE-008 Checkpoint F2b — the review findings that live on the screen
 * rather than in the transport.
 */

function quote(overrides: Record<string, unknown> = {}) {
  return {
    lines: [
      {
        id: 'line-1',
        slug: 'fixture',
        nameHe: 'מוצר',
        nameEn: 'Product',
        brandName: 'Brand',
        quantity: 1,
        unitPrice: '100.00',
        lineTotal: '100.00',
      },
    ],
    basis: '100.00',
    shipping: {
      cost: '30.00',
      isFree: false,
      threshold: '249.00',
      basis: '100.00',
      hasShippableLines: true,
      noDeliveryRequired: false,
    },
    totalAmount: '130.00',
    deliveryMethod: 'courier',
    estimate: { kind: 'delivered_between', minBusinessDays: 3, maxBusinessDays: 5 },
    fingerprint: 'fp-courier',
    ...overrides,
  }
}

const PICKUP = quote({
  deliveryMethod: 'self_pickup',
  shipping: {
    cost: '0.00',
    isFree: false,
    threshold: '249.00',
    basis: '100.00',
    hasShippableLines: true,
    noDeliveryRequired: true,
  },
  totalAmount: '100.00',
  estimate: { kind: 'ready_within', businessDays: 2 },
  fingerprint: 'fp-pickup',
})

/** A shopper with nothing on file — the state every real one is in today. */
const PROFILE_NONE = {
  firstName: 'Alice',
  lastName: 'Account',
  phone: '050-1111111',
  defaultAddress: null,
}

function renderPage() {
  return render(
    <MemoryRouter>
      <CheckoutPage />
    </MemoryRouter>,
  )
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

describe('🔴 out-of-order quotes cannot reach the screen', () => {
  it('a SLOW earlier response is discarded when a later one has already settled', async () => {
    // Request 1 (courier) resolves LAST. Without the request-id guard the
    // screen ends up showing courier's ₪130 beside a checked self-pickup
    // radio — and holding courier's fingerprint, so F2c's /pay would refuse
    // with a mismatch the shopper cannot account for.
    // A holder object, not a `let` — TypeScript does not track an assignment
    // made inside the executor callback and narrows the binding to `null`.
    const release: { fn: () => void } = { fn: () => {} }
    const first = new Promise<void>((resolve) => {
      release.fn = resolve
    })

    /*
     * 🔴 BRANCH ON THE URL, NOT ON A CALL COUNT.
     *
     * This test counted calls, and F2b added a profile fetch that runs FIRST —
     * so the artificially delayed response became the PROFILE request, the
     * courier quote resolved immediately, and nothing was ever stale. The
     * guard it exists to protect could be deleted with this test still green;
     * that was measured, not assumed. A call index is a property of the
     * component's internals, and this one changed.
     */
    let quoteCall = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/api/account/profile')) {
          return { status: 200, json: async () => PROFILE_NONE } as unknown as Response
        }
        quoteCall += 1
        if (quoteCall === 1) {
          await first
          return { status: 200, json: async () => quote() } as unknown as Response
        }
        return { status: 200, json: async () => PICKUP } as unknown as Response
      }),
    )

    renderPage()
    const pickup = await screen.findByRole('radio', { name: /self pickup/i })
    pickup.click()

    // The second (self pickup) answer lands first.
    await waitFor(() => expect(screen.getByText(/no shipping with self pickup/i)).toBeTruthy())

    // Now the stale courier answer arrives.
    release.fn()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(screen.getByText(/no shipping with self pickup/i)).toBeTruthy()
    expect(screen.queryByText(/130\.00/)).toBeNull()
    expect((await screen.findByRole('radio', { name: /self pickup/i })).getAttribute('checked')).not.toBe(
      'false',
    )
  })
})

describe('F2b — the address form and the REQ-F-041 pre-fill', () => {
  function withProfile(profile: unknown) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/api/account/profile')) {
          return { status: 200, json: async () => profile } as unknown as Response
        }
        return { status: 200, json: async () => quote() } as unknown as Response
      }),
    )
  }

  const SAVED = {
    firstName: 'Alice',
    lastName: 'Account',
    phone: '050-1111111',
    defaultAddress: { line1: 'רחוב אליס 1', city: 'תל אביב', zipCode: '6100000' },
  }

  it('pre-fills the address when the account has one', async () => {
    withProfile(SAVED)
    renderPage()
    const line1 = await screen.findByLabelText(/street and number/i)
    await waitFor(() => expect((line1 as HTMLInputElement).value).toBe('רחוב אליס 1'))
    expect((screen.getByLabelText(/^city$/i) as HTMLInputElement).value).toBe('תל אביב')
    expect(screen.getByText(/filled in from your account/i)).toBeTruthy()
  })

  it('🔴 SAYS SO when nothing is saved, rather than showing a mysteriously empty form', async () => {
    // The state every real shopper is in today: nothing writes an Address row
    // (ISSUE-093), so the form is empty and must explain why.
    withProfile({ ...SAVED, defaultAddress: null })
    renderPage()
    expect(await screen.findByText(/no address is saved/i)).toBeTruthy()
    expect((screen.getByLabelText(/street and number/i) as HTMLInputElement).value).toBe('')
  })

  it('🔴 a failed profile does NOT block checkout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/api/account/profile')) {
          return { status: 503, json: async () => ({ error: { code: 'X' } }) } as unknown as Response
        }
        return { status: 200, json: async () => quote() } as unknown as Response
      }),
    )
    renderPage()
    // The summary still arrives; the form is simply empty and typeable.
    expect(await screen.findByText(/order summary/i)).toBeTruthy()
    expect(screen.getByLabelText(/street and number/i)).toBeTruthy()
  })

  it('SELF PICKUP hides the address form entirely — the server refuses one', async () => {
    withProfile(SAVED)
    renderPage()
    const pickup = await screen.findByRole('radio', { name: /self pickup/i })
    pickup.click()
    await waitFor(() => expect(screen.getByText(/self pickup needs no address/i)).toBeTruthy())
    expect(screen.queryByLabelText(/street and number/i)).toBeNull()
  })

  it('flags a blank required field on BLUR, and only after it is left', async () => {
    withProfile({ ...SAVED, defaultAddress: null })
    renderPage()
    const line1 = await screen.findByLabelText(/street and number/i)

    // Nothing is shouted at a shopper who has not touched the field yet.
    expect(screen.queryByText(/enter a street and number/i)).toBeNull()

    line1.focus()
    line1.blur()
    await waitFor(() => expect(screen.getByText(/enter a street and number/i)).toBeTruthy())
    expect(line1.getAttribute('aria-invalid')).toBe('true')
  })

  it('🔴 THE CONTROL — a FILLED field that is blurred raises nothing', async () => {
    // Without this, "shows an error on blur" would pass against a form that
    // errored on every blur regardless of content.
    withProfile(SAVED)
    renderPage()
    const line1 = await screen.findByLabelText(/street and number/i)
    await waitFor(() => expect((line1 as HTMLInputElement).value).not.toBe(''))
    line1.focus()
    line1.blur()
    expect(screen.queryByText(/enter a street and number/i)).toBeNull()
    expect(line1.getAttribute('aria-invalid')).toBe('false')
  })
})

describe('F2b — the review findings, each with a control', () => {
  function routed(profileStatus: number, profile: unknown) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/api/account/profile')) {
          return { status: profileStatus, json: async () => profile } as unknown as Response
        }
        return { status: 200, json: async () => quote() } as unknown as Response
      }),
    )
  }

  const SAVED_PROFILE = {
    firstName: 'Alice',
    lastName: 'Account',
    phone: '050-1111111',
    defaultAddress: { line1: 'רחוב אליס 1', city: 'תל אביב', zipCode: '6100000' },
  }

  it('🔴 a FAILED profile does not claim the account has no address', async () => {
    routed(503, { error: { code: 'PROFILE_UNAVAILABLE' } })
    renderPage()
    expect(await screen.findByText(/could not load your saved details/i)).toBeTruthy()
    // The old copy told a shopper who HAS a saved address that they have none.
    expect(screen.queryByText(/no address is saved/i)).toBeNull()
  })

  it('🔴 THE CONTROL — a shopper who genuinely has none still gets that sentence', async () => {
    routed(200, PROFILE_NONE)
    renderPage()
    expect(await screen.findByText(/no address is saved/i)).toBeTruthy()
    expect(screen.queryByText(/could not load your saved details/i)).toBeNull()
  })

  it('renders the NAME and the phone, which were fetched and never shown', async () => {
    routed(200, SAVED_PROFILE)
    renderPage()
    expect(await screen.findByText(/ordering as alice account/i)).toBeTruthy()
    expect(screen.getByText(/050-1111111/)).toBeTruthy()
  })

  it('🔴 does NOT overwrite what the shopper already typed', async () => {
    // The profile answers late; by then the shopper has started typing.
    const release: { fn: () => void } = { fn: () => {} }
    const slow = new Promise<void>((resolve) => {
      release.fn = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/api/account/profile')) {
          await slow
          return { status: 200, json: async () => SAVED_PROFILE } as unknown as Response
        }
        return { status: 200, json: async () => quote() } as unknown as Response
      }),
    )

    renderPage()
    const line1 = (await screen.findByLabelText(/street and number/i)) as HTMLInputElement
    // 🔴 `fireEvent.change`, NOT `.value = …` plus a dispatched event. React
    // tracks the value through its own setter, so assigning directly leaves
    // component state at '' — which made the pre-fill look correct and would
    // have let this test pass against the very bug it exists for.
    fireEvent.change(line1, { target: { value: 'רחוב שכתבתי בעצמי 7' } })
    await waitFor(() => expect(line1.value).toBe('רחוב שכתבתי בעצמי 7'))

    release.fn()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(line1.value).toBe('רחוב שכתבתי בעצמי 7')
  })

  it('🔴 THE CONTROL — an UNTOUCHED form still receives the saved address', async () => {
    // Without this, "does not overwrite" would pass against a pre-fill that
    // never ran at all.
    routed(200, SAVED_PROFILE)
    renderPage()
    const line1 = (await screen.findByLabelText(/street and number/i)) as HTMLInputElement
    await waitFor(() => expect(line1.value).toBe('רחוב אליס 1'))
  })

  it('🔴 the error does not become part of the input ACCESSIBLE NAME', async () => {
    routed(200, PROFILE_NONE)
    renderPage()
    const city = await screen.findByLabelText(/^city$/i)
    city.focus()
    city.blur()
    await waitFor(() => expect(screen.getByText(/enter a city/i)).toBeTruthy())

    // Still findable by its own label — the error text used to be inside the
    // <label>, so the field announced as "City Enter a city." and the message
    // was never announced AS an error.
    expect(screen.getByLabelText(/^city$/i)).toBe(city)
    const describedBy = city.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    const message = document.getElementById(describedBy!)
    expect(message?.getAttribute('role')).toBe('alert')
    expect(message?.textContent).toMatch(/enter a city/i)
  })

  it('clears the typed address when switching to self pickup', async () => {
    routed(200, PROFILE_NONE)
    renderPage()
    const line1 = (await screen.findByLabelText(/street and number/i)) as HTMLInputElement
    // Same reason as above — and this test PASSED VACUOUSLY before the fix:
    // it asserted the field was empty at the end, which is trivially true if
    // the typing never reached React state in the first place.
    fireEvent.change(line1, { target: { value: 'רחוב כלשהו 3' } })
    await waitFor(() => expect(line1.value).toBe('רחוב כלשהו 3'))

    ;(await screen.findByRole('radio', { name: /self pickup/i })).click()
    await waitFor(() => expect(screen.getByText(/self pickup needs no address/i)).toBeTruthy())
    ;(await screen.findByRole('radio', { name: /courier/i })).click()

    const again = (await screen.findByLabelText(/street and number/i)) as HTMLInputElement
    // F2c would otherwise inherit an address for a method the server refuses.
    expect(again.value).toBe('')
  })
})

describe('the failure branches that had no way out', () => {
  it('an expired session offers a LINK, not just a sentence', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ status: 401, json: async () => ({ error: { code: 'X' } }) }) as unknown as Response),
    )
    renderPage()
    // RequireAuth cannot help here: SessionContext still believes the session
    // is live, because only the server knows it expired.
    expect(await screen.findByRole('link', { name: /go to sign in/i })).toBeTruthy()
  })

  it('🔴 a 429 does NOT offer a retry button that re-hits the limiter', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ status: 429, json: async () => ({ error: { code: 'TOO_MANY_REQUESTS' } }) }) as unknown as Response),
    )
    renderPage()
    expect(await screen.findByText(/too many attempts/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull()
  })

  it('🔴 THE CONTROL — an ordinary server error DOES offer the retry', async () => {
    // Without this, "no retry button" would pass against a screen that had
    // lost the button everywhere.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ status: 500, json: async () => ({ error: { code: 'BOOM' } }) }) as unknown as Response),
    )
    renderPage()
    expect(await screen.findByRole('button', { name: /try again/i })).toBeTruthy()
  })

  it('🔴 EMAIL_NOT_VERIFIED says what actually helps — not sign in, not retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        status: 403,
        json: async () => ({ error: { code: 'EMAIL_NOT_VERIFIED' } }),
      }) as unknown as Response),
    )
    renderPage()
    expect(await screen.findByText(/verify your email address/i)).toBeTruthy()
    // The shopper IS signed in, and no retry clears an unverified address.
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /go to sign in/i })).toBeNull()
  })

  it('a blocked order NAMES every line, whatever the reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        status: 409,
        json: async () => ({
          error: {
            code: 'UNPURCHASABLE_LINE',
            lines: [
              { lineId: 'l1', slug: 'withdrawn-one', why: 'WITHDRAWN', available: 0 },
              { lineId: 'l2', slug: 'gone-one', why: 'SOLD_OUT', available: 0 },
              { lineId: 'l3', slug: 'short-one', why: 'SHORT_STOCK', available: 2 },
            ],
          },
        }),
      }) as unknown as Response),
    )
    renderPage()

    // 🔴 The regression that shipped in `7e0b1a8`: the heading rendered over an
    // EMPTY list because two of these three reasons were filtered away.
    expect(await screen.findByText(/no longer sold/i)).toBeTruthy()
    expect(screen.getByText(/sold out/i)).toBeTruthy()
    expect(screen.getByText(/lower the quantity to 2/i)).toBeTruthy()
    expect(screen.getByText('withdrawn-one')).toBeTruthy()
  })
})
