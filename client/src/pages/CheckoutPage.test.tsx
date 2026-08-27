// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
        brandNameEn: null,
        quantity: 1,
        unitPrice: '100.00',
        lineTotal: '100.00',
      },
    ],
    clubMember: false,
    clubSavings: '0.00',
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
        // M-009 added a mount-time /addresses fetch; without this branch it
        // consumed quoteCall 1 and the delayed-quote scenario went VACUOUS —
        // the exact hole this test's own comment records for the profile
        // fetch, reopened by the next fetch (review finding).
        if (String(url).includes('/api/account/addresses')) {
          return { status: 200, json: async () => ({ addresses: [], cap: 5 }) } as unknown as Response
        }
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
  /**
   * M-009: the pre-fill's source moved from profile.defaultAddress to the
   * ADDRESS BOOK (GET /api/account/addresses) — the saved rows render as a
   * labelled picker and the default arrives selected. `book` mirrors that
   * endpoint; the profile still supplies the name/phone line.
   */
  function withProfile(profile: unknown, book: unknown[] = []) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/api/account/addresses')) {
          return {
            status: 200,
            json: async () => ({ addresses: book, cap: 5 }),
          } as unknown as Response
        }
        if (String(url).includes('/api/account/profile')) {
          return { status: 200, json: async () => profile } as unknown as Response
        }
        return { status: 200, json: async () => quote() } as unknown as Response
      }),
    )
  }

  const SAVED_ROW = {
    id: 'addr-1',
    line1: 'רחוב אליס 1',
    city: 'תל אביב',
    zipCode: '6100000',
    isDefault: true,
  }

  const SAVED = {
    firstName: 'Alice',
    lastName: 'Account',
    phone: '050-1111111',
    defaultAddress: { line1: 'רחוב אליס 1', city: 'תל אביב', zipCode: '6100000' },
  }

  it('M-009 — the saved DEFAULT arrives as a SELECTED picker row, copied into the fields', async () => {
    withProfile(SAVED, [SAVED_ROW])
    renderPage()
    const line1 = await screen.findByLabelText(/street and number/i)
    await waitFor(() => expect((line1 as HTMLInputElement).value).toBe('רחוב אליס 1'))
    expect((screen.getByLabelText(/^city$/i) as HTMLInputElement).value).toBe('תל אביב')
    // The prefill is LABELLED now, not mysterious: the picker row is checked.
    const saved = screen.getByRole('radio', { name: /רחוב אליס 1/ }) as HTMLInputElement
    expect(saved.checked).toBe(true)
    // And "a new address" clears the fields — the pick is a real choice.
    fireEvent.click(screen.getByRole('radio', { name: /a new address/i }))
    expect((line1 as HTMLInputElement).value).toBe('')
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
    // DEC-110.3: queried as the receipt's HEADING — the phrase also
    // appears in the mobile jump strip, so a bare text query is ambiguous.
    expect(await screen.findByRole('heading', { name: /order summary/i })).toBeTruthy()
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

  it('PICKUP POINT replaces the address form with a labelled point picker (the lecturer-fixes list)', async () => {
    withProfile(SAVED)
    renderPage()
    const pickupPoint = await screen.findByRole('radio', { name: /pickup point/i })
    pickupPoint.click()
    // The picker appears; the home-address fields are GONE — a shopper
    // collecting from a point has no delivery address to type.
    const picker = await screen.findByLabelText(/^pickup point$/i)
    expect(picker.tagName).toBe('SELECT')
    expect((picker as HTMLSelectElement).options.length).toBeGreaterThanOrEqual(6)
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
    withProfile(SAVED, [SAVED_ROW])
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
  function routed(profileStatus: number, profile: unknown, book: unknown[] = []) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/api/account/addresses')) {
          return { status: 200, json: async () => ({ addresses: book, cap: 5 }) } as unknown as Response
        }
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
    // never ran at all. M-009: the source is the BOOK's default row.
    routed(200, SAVED_PROFILE, [
      { id: 'addr-1', line1: 'רחוב אליס 1', city: 'תל אביב', zipCode: '6100000', isDefault: true },
    ])
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

describe('F2c — confirming and paying', () => {
  function payRoute(payStatus: number, payBody: unknown) {
    const calls: RequestInit[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes('/api/account/profile')) {
          return { status: 200, json: async () => PROFILE_NONE } as unknown as Response
        }
        if (String(url).includes('/api/checkout/pay')) {
          calls.push(init as RequestInit)
          return { status: payStatus, json: async () => payBody } as unknown as Response
        }
        return { status: 200, json: async () => quote() } as unknown as Response
      }),
    )
    return calls
  }

  const ORDER = {
    orderId: 'o1',
    orderNumber: 'VS-20260813-ABC123',
    totalAmount: '130.00',
    shippingCost: '30.00',
    replayed: false,
    estimate: { kind: 'delivered_between', minBusinessDays: 3, maxBusinessDays: 5 },
  }

  /** Valid card details — the 2026-08-23 gate; Luhn-valid test number. */
  function fillCard() {
    fireEvent.change(screen.getByLabelText(/card number/i), { target: { value: '4111 1111 1111 1111' } })
    fireEvent.change(screen.getByLabelText(/expiry/i), { target: { value: '12/29' } })
    fireEvent.change(screen.getByLabelText(/cvv/i), { target: { value: '123' } })
    fireEvent.change(screen.getByLabelText(/cardholder name/i), { target: { value: 'Israel Israeli' } })
  }

  async function fillAndPay() {
    const line1 = (await screen.findByLabelText(/street and number/i)) as HTMLInputElement
    fireEvent.change(line1, { target: { value: 'רחוב 1' } })
    fireEvent.change(screen.getByLabelText(/^city$/i), { target: { value: 'תל אביב' } })
    fillCard()
    const button = await screen.findByRole('button', { name: /confirm and pay/i })
    fireEvent.click(button)
  }

  it('🔴 INVALID CARD DETAILS never leave the page — the gate blocks and says why (both controls: the valid path above pays)', async () => {
    const calls = payRoute(201, ORDER)
    renderPage()
    const line1 = (await screen.findByLabelText(/street and number/i)) as HTMLInputElement
    fireEvent.change(line1, { target: { value: 'רחוב 1' } })
    fireEvent.change(screen.getByLabelText(/^city$/i), { target: { value: 'תל אביב' } })
    // Luhn-INVALID number; everything else valid.
    fireEvent.change(screen.getByLabelText(/card number/i), { target: { value: '4111 1111 1111 1112' } })
    fireEvent.change(screen.getByLabelText(/expiry/i), { target: { value: '12/29' } })
    fireEvent.change(screen.getByLabelText(/cvv/i), { target: { value: '123' } })
    fireEvent.change(screen.getByLabelText(/cardholder name/i), { target: { value: 'Israel Israeli' } })
    fireEvent.click(await screen.findByRole('button', { name: /confirm and pay/i }))
    expect(await screen.findByText(/card number is not valid/i)).toBeTruthy()
    expect(calls).toHaveLength(0)
  })

  it('🔴 THE CARD NEVER TRAVELS — a successful pay request carries no card field', async () => {
    const calls = payRoute(201, ORDER)
    renderPage()
    await fillAndPay()
    await waitFor(() => expect(calls).toHaveLength(1))
    const body = JSON.parse(String(calls[0]!.body)) as Record<string, unknown>
    const flat = JSON.stringify(body)
    expect(Object.keys(body)).not.toContain('card')
    expect(flat).not.toContain('4111')
    expect(flat).not.toContain('123')
  })

  it('sends the fingerprint the shopper was SHOWN', async () => {
    const calls = payRoute(201, ORDER)
    renderPage()
    await fillAndPay()
    await waitFor(() => expect(calls).toHaveLength(1))
    // DEC-060: the gate compares this against a digest re-derived from live
    // data. Sending anything else defeats it rather than passing it.
    expect(JSON.parse(String(calls[0]!.body)).fingerprint).toBe('fp-courier')
  })

  it('replaces the form with a confirmation carrying the ORDER NUMBER', async () => {
    payRoute(201, ORDER)
    renderPage()
    await fillAndPay()
    expect(await screen.findByText(/VS-20260813-ABC123/)).toBeTruthy()
    // 🔴 The pay button is GONE — leaving it beside a placed order invites a
    // second press.
    expect(screen.queryByRole('button', { name: /confirm and pay/i })).toBeNull()
  })

  it('🔴 a REPLAY says the order exists and was not charged twice', async () => {
    payRoute(200, { ...ORDER, replayed: true, status: 'paid' })
    renderPage()
    await fillAndPay()
    expect(await screen.findByText(/repeat confirmation, not a second charge/i)).toBeTruthy()
    expect(screen.getByText(/VS-20260813-ABC123/)).toBeTruthy()
  })

  it('🔴 a DROPPED CONNECTION never says the order failed', async () => {
    // The §8.12 defect, four times in Checkpoint D. The order may exist, and
    // pressing again is safe because the key is unchanged.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/api/account/profile')) {
          return { status: 200, json: async () => PROFILE_NONE } as unknown as Response
        }
        if (String(url).includes('/api/checkout/pay')) throw new TypeError('network')
        return { status: 200, json: async () => quote() } as unknown as Response
      }),
    )
    renderPage()
    await fillAndPay()
    expect(await screen.findByText(/may still have gone through/i)).toBeTruthy()
  })

  it('🔴 RETRYING reuses the SAME idempotency key — INV-05', async () => {
    const calls = payRoute(402, { error: { code: 'PAYMENT_DECLINED' } })
    renderPage()
    await fillAndPay()
    await waitFor(() => expect(calls).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: /confirm and pay/i }))
    await waitFor(() => expect(calls).toHaveLength(2))

    const first = JSON.parse(String(calls[0]!.body)).idempotencyKey
    const second = JSON.parse(String(calls[1]!.body)).idempotencyKey
    // A key regenerated per press turns one order into two.
    expect(second).toBe(first)
    expect(String(first).length).toBeGreaterThan(0)
  })

  it('a DECLINED payment says the cart is unchanged, and leaves the button', async () => {
    payRoute(402, { error: { code: 'PAYMENT_DECLINED' } })
    renderPage()
    await fillAndPay()
    expect(await screen.findByText(/no order was placed/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /confirm and pay/i })).toBeTruthy()
  })

  it('🔴 CHECKOUT_CHANGED re-renders the NEW figures rather than just complaining', async () => {
    const changed = quote({ totalAmount: '999.00', fingerprint: 'fp-second' })
    payRoute(409, { error: { code: 'CHECKOUT_CHANGED' }, quote: changed })
    renderPage()
    await fillAndPay()
    // REQ-F-042 requires the updated values to be SHOWN and confirmed again.
    expect(await screen.findByText(/please confirm them again/i)).toBeTruthy()
    // DEC-110.3: the refreshed total renders in both the receipt and the
    // mobile jump strip — the pin is scoped to the RECEIPT's own region
    // (review finding: a bare "appears somewhere" would stay green if a
    // regression left a stale total in the receipt while only the strip
    // refreshed).
    const receipt = screen.getByRole('complementary', { name: /order summary/i })
    expect(within(receipt).getAllByText(/999\.00/).length).toBeGreaterThan(0)
  })

  it('a CANCELLED order names it instead of reporting a payment failure', async () => {
    payRoute(409, { error: { code: 'ORDER_CANCELLED' }, orderNumber: 'VS-20260813-ZZZ999' })
    renderPage()
    await fillAndPay()
    expect(await screen.findByText(/VS-20260813-ZZZ999 was cancelled/i)).toBeTruthy()
  })

  it('ISSUE-093 — the save-address box is OFF unless ticked', async () => {
    const calls = payRoute(201, ORDER)
    renderPage()
    const box = await screen.findByRole('checkbox', { name: /save this address/i })
    expect((box as HTMLInputElement).checked).toBe(false)
    await fillAndPay()
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(JSON.parse(String(calls[0]!.body)).saveAddress).toBe(false)
  })

  it('ISSUE-093 — and travels as true once it is', async () => {
    const calls = payRoute(201, ORDER)
    renderPage()
    fireEvent.click(await screen.findByRole('checkbox', { name: /save this address/i }))
    await fillAndPay()
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(JSON.parse(String(calls[0]!.body)).saveAddress).toBe(true)
  })

  it('ISSUE-174 (REQ-F-043 amended by the user): no outcome selector exists; the client always requests success, and a server 402 still renders the declined state', async () => {
    const calls = payRoute(402, { error: { code: 'PAYMENT_DECLINED' } })
    renderPage()
    // The OUTCOME control is GONE — the deviation the user asked for.
    // (Delivery-method radios legitimately remain.)
    await screen.findByRole('button', { name: /pay/i })
    expect(screen.queryByRole('radio', { name: /declined|successful/i })).toBeNull()
    await fillAndPay()
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(JSON.parse(String(calls[0]!.body)).simulatedOutcome).toBe('success')
    // Review fix: the title's second claim is now ASSERTED here too — a 402
    // renders the declined state (was previously only covered by a sibling
    // test this one's title could be mistaken for).
    expect(await screen.findByText(/no order was placed/i)).toBeTruthy()
  })

  it('🔴 a BLOCKED order names its lines on the PAY path too', async () => {
    // The HIGH finding: `blocked` had no branch here, so a 409
    // UNPURCHASABLE_LINE from /pay rendered "the order could not be
    // calculated" while the screen one component above knew how to name every
    // line. §8.12's flattening, in the code that claims to prevent it.
    payRoute(409, {
      error: {
        code: 'UNPURCHASABLE_LINE',
        lines: [{ lineId: 'l1', slug: 'sold-out-one', why: 'SOLD_OUT', available: 0 }],
      },
    })
    renderPage()
    await fillAndPay()
    expect(await screen.findByText('sold-out-one')).toBeTruthy()
    expect(screen.getByText(/sold out/i)).toBeTruthy()
    expect(screen.queryByText(/could not be calculated/i)).toBeNull()
  })

  it('an EMPTY CART on the pay path says so, not "could not be calculated"', async () => {
    payRoute(409, { error: { code: 'EMPTY_CART' } })
    renderPage()
    await fillAndPay()
    expect(await screen.findByText(/cart is empty/i)).toBeTruthy()
    expect(screen.queryByText(/could not be calculated/i)).toBeNull()
  })

  it('an expired session on the PAY path offers a link, like the quote path', async () => {
    payRoute(401, { error: { code: 'AUTHENTICATION_REQUIRED' } })
    renderPage()
    await fillAndPay()
    expect(await screen.findByRole('link', { name: /go to sign in/i })).toBeTruthy()
  })

  it('🔴 a dead pay failure does NOT stick to a fresh quote', async () => {
    payRoute(402, { error: { code: 'PAYMENT_DECLINED' } })
    renderPage()
    await fillAndPay()
    expect(await screen.findByText(/no order was placed/i)).toBeTruthy()

    /*
     * 🔴 WAIT FOR THE NEW QUOTE TO BE READY BEFORE ASSERTING.
     *
     * The first version asserted the notice was gone immediately after the
     * click — and it PASSED WITHOUT THE FIX, because switching sets the page
     * to `loading`, which unmounts the whole payment section including the
     * notice. It caught that gap and proved nothing. The stale notice only
     * reappears once the new quote renders, so that is the moment to look.
     */
    fireEvent.click(screen.getByRole('radio', { name: /self pickup/i }))
    await screen.findByText(/self pickup needs no address/i)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /confirm and pay/i })).toBeTruthy(),
    )
    expect(screen.queryByText(/no order was placed/i)).toBeNull()
  })

  it('locks the delivery radios while a payment is in flight', async () => {
    // Changing the method underneath an in-flight payment is what put a
    // courier summary beside a checked self-pickup radio.
    const release: { fn: () => void } = { fn: () => {} }
    const slow = new Promise<void>((resolve) => {
      release.fn = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/api/account/profile')) {
          return { status: 200, json: async () => PROFILE_NONE } as unknown as Response
        }
        if (String(url).includes('/api/checkout/pay')) {
          await slow
          return { status: 402, json: async () => ({ error: { code: 'PAYMENT_DECLINED' } }) } as unknown as Response
        }
        return { status: 200, json: async () => quote() } as unknown as Response
      }),
    )
    renderPage()
    await fillAndPay()
    await waitFor(() =>
      expect((screen.getByRole('radio', { name: /self pickup/i }) as HTMLInputElement).disabled).toBe(true),
    )
    release.fn()
  })

  it('the confirmation announces itself and takes focus', async () => {
    payRoute(201, ORDER)
    renderPage()
    await fillAndPay()
    const heading = await screen.findByRole('status')
    await waitFor(() => expect(document.activeElement).toBe(heading))
  })

  it('renders the STORED status when a replay reports one', async () => {
    payRoute(200, { ...ORDER, replayed: true, status: 'shipped' })
    renderPage()
    await fillAndPay()
    // F0's labels: `shipped` is נשלחה / Shipped.
    expect(await screen.findByText(/order status/i)).toBeTruthy()
  })

  it('🔴 the card FIELDS exist (2026-08-23, reversing DEC-098) but the pay payload stays card-free', async () => {
    // DEC-098 removed the fields; the lecturer-fixes list brought them back
    // WITH validation. What survives from DEC-098 unbroken: the payload —
    // the exact-key pin below still proves nothing card-shaped travels.
    const calls = payRoute(201, ORDER)
    renderPage()
    await screen.findByRole('button', { name: /pay/i })
    expect(await screen.findByLabelText(/card number/i)).toBeTruthy()
    expect(screen.getByLabelText(/cvv/i)).toBeTruthy()
    expect(screen.getByLabelText(/expiry/i)).toBeTruthy()

    await fillAndPay()
    await waitFor(() => expect(calls).toHaveLength(1))
    /*
     * 🔴 THE EXACT KEY SET, not just "no card-shaped names" — the review
     * caught the regex-only pin allowing ANY non-card field (email, profile
     * data) to ride the pay body unnoticed. This is the whole payload; a new
     * key is a deliberate decision, not a drive-by.
     */
    const keys = Object.keys(JSON.parse(String(calls[0]!.body))).sort()
    expect(keys).toEqual([
      'address',
      'deliveryMethod',
      'fingerprint',
      'idempotencyKey',
      'saveAddress',
      'simulatedOutcome',
    ])
    expect(keys.join(' ')).not.toMatch(/card|cvv|expiry|pan/i)
  })

  it('🔴 THE CONTROL — the button is DISABLED while the address is incomplete', async () => {
    // Without this, every test above could pass against a screen that never
    // guarded the address at all.
    payRoute(201, ORDER)
    renderPage()
    const button = await screen.findByRole('button', { name: /confirm and pay/i })
    expect((button as HTMLButtonElement).disabled).toBe(true)
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
