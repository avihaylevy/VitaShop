// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { CartProvider } from '../state/CartContext'
import { HomePage } from './HomePage'
import { NEW_ARRIVALS_COUNT } from '../hooks/useNewArrivals'

/**
 * MILESTONE-008 Checkpoint F4 — DEC-064's NEW ARRIVALS, resolving ISSUE-054.
 *
 * 🔴 THE HOME PAGE PREVIOUSLY DECLARED "never GET /api/products" in its own
 * header. That contract is changed here deliberately, which is why the tests
 * name it.
 */

function product(index: number) {
  return {
    slug: `product-${index}`,
    nameHe: `מוצר ${index}`,
    nameEn: `Product ${index}`,
    categoryNameHe: 'ויטמינים',
    categoryNameEn: 'Vitamins',
    // 🔴 `categorySlug` is REQUIRED by `isCatalogProductDto`. The first
    // fixture omitted it, the envelope was rejected as malformed, and three
    // tests failed reporting "product not rendered" — which looked like a
    // rendering bug and was a fixture that did not match the real contract.
    categorySlug: 'vitamins',
    brandName: 'Brand',
    price: '95.00',
    stockQuantity: 10,
    lowStockThreshold: 3,
    imageFile: null,
    dosageForm: 'CAPSULE',
    packageQuantity: 60,
  }
}

const CATEGORIES = [{ id: 'vitamins', slug: 'vitamins', nameHe: 'ויטמינים', nameEn: 'Vitamins' }]

/** Answers categories always; products according to `productsAnswer`. */
function routed(productsAnswer: () => Promise<Response>) {
  const urls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(String(url))
      if (String(url).includes('/api/products')) return productsAnswer()
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: CATEGORIES }),
      } as unknown as Response
    }),
  )
  return urls
}

function ok(items: unknown[]) {
  return async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({
        items,
        page: 1,
        pageSize: 24,
        totalItems: items.length,
        totalPages: 1,
        fallback: null,
      }),
    }) as unknown as Response
}

function renderHome() {
  return render(
    <MemoryRouter>
      {/*
        ISSUE-105 — the shelf now adds to cart, so it needs the cart context.
        `main.tsx` wraps the whole app in this provider, so production has it;
        this mirrors that rather than inventing a lighter one.
      */}
      <CartProvider>
        <HomePage />
      </CartProvider>
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

describe('the New Arrivals shelf', () => {
  it('🔴 asks for the NEWEST products — DEC-064 rejected best sellers', async () => {
    // `sort=popularity` exists, but the seed has zero orders, so every product
    // scores 0 and the result is the tie-break order wearing a meaningful
    // label. `createdAt` is real data.
    const urls = routed(ok([product(1)]))
    renderHome()
    await waitFor(() => expect(urls.some((u) => u.includes('/api/products'))).toBe(true))
    const productsUrl = urls.find((u) => u.includes('/api/products'))!
    expect(productsUrl).toContain('sort=newest')
    expect(productsUrl).not.toContain('popularity')
  })

  it(`shows at most ${NEW_ARRIVALS_COUNT}, even though a page carries 24`, async () => {
    routed(ok(Array.from({ length: 24 }, (_, i) => product(i + 1))))
    renderHome()
    await screen.findByText('Product 1')
    // The server has no page-size parameter, so the slice happens here.
    expect(screen.queryByText(`Product ${NEW_ARRIVALS_COUNT}`)).toBeTruthy()
    expect(screen.queryByText(`Product ${NEW_ARRIVALS_COUNT + 1}`)).toBeNull()
  })

  it('🔴 the cards BOTH link and add to cart — ISSUE-105', async () => {
    /*
     * ⚠️ THIS TEST ASSERTED THE OPPOSITE UNTIL 2026-08-14. Checkpoint F4 made
     * the cards navigational so the drawer, the return-focus choreography and
     * the announcement would not exist twice — then the USER checked the site
     * and asked to buy from the home page, which is their call.
     *
     * 🔴 F4'S REASON IS HONOURED DIFFERENTLY, NOT DISCARDED: the choreography
     * moved into `useAddToCart`, which the catalogue uses too. Still one
     * implementation — and the link stays, so the card does both.
     */
    routed(ok([product(1)]))
    renderHome()

    const link = await screen.findByRole('link', { name: 'Product 1' })
    expect(link.getAttribute('href')).toBe('/product/product-1')
    expect(screen.getByRole('button', { name: /add to cart/i })).toBeTruthy()
  })

  it('🔴 A FAILED SHELF DOES NOT BREAK THE PAGE — the categories still render', async () => {
    routed(async () => {
      throw new TypeError('network')
    })
    renderHome()

    // The categories are the page's actual navigation.
    expect(await screen.findByRole('link', { name: /vitamins/i })).toBeTruthy()
    expect(screen.getByText(/could not be loaded right now/i)).toBeTruthy()
  })

  it('🔴 the shelf message lives in a LIVE REGION, so a retry outcome is announced', async () => {
    /*
     * Loading and failure were separate conditional blocks and the failure one
     * carried no live-region role at all: pressing Retry unmounted the focused
     * button, focus fell to <body>, and whether it worked was announced
     * nowhere. `status` is polite — the "do not shout" intent stated properly
     * rather than by omission.
     */
    routed(async () => {
      throw new TypeError('network')
    })
    renderHome()
    const message = await screen.findByText(/could not be loaded right now/i)
    expect(message.getAttribute('role')).toBe('status')
  })

  it('🔴 THE CONTROL — a working shelf renders no error', async () => {
    // Without this, "the failure is quiet" would pass against a page that
    // showed the error message unconditionally.
    routed(ok([product(1)]))
    renderHome()
    await screen.findByText('Product 1')
    expect(screen.queryByText(/could not be loaded right now/i)).toBeNull()
  })

  it('🔴 RETRY actually re-requests — the path nothing exercised', async () => {
    /*
     * Seven tests covered sort, slice, links, the quiet failure, the control,
     * empty and the heading — and none pressed Retry. The button could have
     * been a no-op with the suite green, which is the "check that verifies
     * nothing" family this project keeps recording.
     */
    let attempt = 0
    const urls = routed(async () => {
      attempt += 1
      if (attempt === 1) throw new TypeError('network')
      return ok([product(1)])()
    })
    renderHome()

    const retry = await screen.findByRole('button', { name: /try again/i })
    const before = urls.filter((u) => u.includes('/api/products')).length
    fireEvent.click(retry)

    await screen.findByText('Product 1')
    expect(urls.filter((u) => u.includes('/api/products')).length).toBe(before + 1)
  })

  it('🔴 a LANGUAGE SWITCH re-renders without re-requesting', async () => {
    /*
     * The DTO carries both names, so the toggle needs no network. Re-fetching
     * blanked a loaded shelf to "Loading…" and, if the network dropped in
     * between, turned working content into an error — a language toggle that
     * can lose the page.
     */
    const urls = routed(ok([product(1)]))
    renderHome()
    await screen.findByText('Product 1')
    const before = urls.filter((u) => u.includes('/api/products')).length

    await act(async () => {
      await i18n.changeLanguage('he')
    })

    expect(await screen.findByText('מוצר 1')).toBeTruthy()
    expect(urls.filter((u) => u.includes('/api/products')).length).toBe(before)
  })

  it('says so when there is nothing new, rather than rendering an empty grid', async () => {
    routed(ok([]))
    renderHome()
    expect(await screen.findByText(/no new products to show yet/i)).toBeTruthy()
  })

  it('carries its own heading, separate from the categories', async () => {
    routed(ok([product(1)]))
    renderHome()
    expect(await screen.findByRole('heading', { name: /new in store/i })).toBeTruthy()
  })
})

/**
 * ISSUE-098 — found by the Checkpoint F4 browser matrix, not by this suite.
 *
 * 🔴 THE SUITE ALREADY TESTED THAT RETRY WORKS, and it does: the request goes
 * out, the cards come back, `RETRY actually re-requests` is green. The defect
 * was in what the DOM did to the user AFTERWARDS — measured in Chromium,
 * `document.activeElement` was `<body>` and the live region held the empty
 * string, so a keyboard user landed back at the top of the page and a screen
 * reader was told nothing at all.
 *
 * ⚠️ THAT IS WHY THESE TESTS ASSERT ON FOCUS AND ON ANNOUNCED TEXT rather than
 * on the products. Asserting the products return would have passed before the
 * fix and after it.
 */
describe('the shelf after a retry — ISSUE-098', () => {
  /**
   * The one live region the shelf owns.
   *
   * ⚠️ Found by its heading's id, NOT by an accessible name — the first version
   * looked the section up as `region, name: /new in store/i` and could not find
   * it in the Hebrew test, because the name is the translated heading.
   */
  function statusRegion() {
    return document.querySelector('[aria-labelledby="new-arrivals-heading"] [role="status"]')!
  }

  it('🔴 announces the COUNT once the retry succeeds', async () => {
    let attempt = 0
    routed(async () => {
      attempt += 1
      if (attempt === 1) throw new TypeError('network')
      return ok([product(1), product(2), product(3), product(4)])()
    })
    renderHome()

    fireEvent.click(await screen.findByRole('button', { name: /try again/i }))

    await screen.findByText('Product 1')
    await waitFor(() => expect(statusRegion().textContent).toBe('4 new products'))
  })

  it('🔴 moves FOCUS to the shelf heading once the retry succeeds', async () => {
    // Measured in Chromium: focus was on <body>. The Retry button only exists
    // in the failed state, so success unmounted it and took the focus along.
    let attempt = 0
    routed(async () => {
      attempt += 1
      if (attempt === 1) throw new TypeError('network')
      return ok([product(1)])()
    })
    renderHome()

    const retry = await screen.findByRole('button', { name: /try again/i })
    retry.focus()
    fireEvent.click(retry)

    await screen.findByText('Product 1')
    const heading = screen.getByRole('heading', { name: /new in store/i })
    await waitFor(() => expect(document.activeElement).toBe(heading))
  })

  it('🔴 THE CONTROL — an ordinary load does NOT steal focus', async () => {
    /*
     * Without this, "move focus to the heading" would pass against a shelf
     * that grabbed focus on every page load — which is worse than the defect
     * it fixes, and would look identical in the passing test above.
     */
    routed(ok([product(1)]))
    renderHome()

    await screen.findByText('Product 1')
    expect(document.activeElement).toBe(document.body)
  })

  /** A retry whose second response this test resolves by hand. */
  function pendingRetry() {
    let resolveSecond: (value: Response) => void = () => {}
    let attempt = 0
    const urls = routed(async () => {
      attempt += 1
      if (attempt === 1) throw new TypeError('network')
      return new Promise<Response>((resolve) => {
        resolveSecond = resolve
      })
    })
    return {
      urls,
      settle: async (items: unknown[]) => {
        await act(async () => {
          resolveSecond(await ok(items)())
        })
      },
    }
  }

  it('🔴 does NOT yank focus back if the user moved on while the retry was in flight', async () => {
    /*
     * 🔴 THE OTHER SIDE OF THIS ISSUE, and it would have been introduced BY the
     * fix. A retry on a slow connection leaves the user free to tab into the
     * header or scroll away; pulling focus to the shelf seconds later — and
     * scrolling the page to it — is WCAG 3.2.5 unexpected change of context.
     * The fix for "focus went nowhere" must not become "focus goes wherever
     * the shelf likes, whenever it finishes".
     */
    const retryInFlight = pendingRetry()
    renderHome()

    fireEvent.click(await screen.findByRole('button', { name: /try again/i }))
    await waitFor(() => expect(statusRegion().textContent).toMatch(/loading new products/i))

    // The user goes somewhere else while it loads.
    const elsewhere = screen.getByRole('link', { name: /vitamins/i })
    elsewhere.focus()
    expect(document.activeElement).toBe(elsewhere)

    await retryInFlight.settle([product(1)])
    await screen.findByText('Product 1')

    expect(document.activeElement).toBe(elsewhere)
    expect(document.activeElement).not.toBe(screen.getByRole('heading', { name: /new in store/i }))
  })

  it('🔴 the in-flight Retry button CANNOT be clicked again', async () => {
    /*
     * `aria-disabled` is a promise to the assistive-technology user, not an
     * enforcement — the element is still clickable, so the handler has to
     * refuse. Without this, "unavailable" would be a label over a control that
     * still fires a second request.
     *
     * ⚠️ THE VISUAL half of this state is NOT asserted here. It lives in
     * `Button`'s `aria-disabled:` variants, and whether those actually WIN the
     * cascade is a browser question — the first attempt put plain classes at
     * this call site, jsdom saw them present, and Chromium rendered a white
     * button because the variant's own `bg-well` outranked them. jsdom cannot
     * tell those two apart; the browser matrix is where that is checked.
     */
    const retryInFlight = pendingRetry()
    const requests = () => retryInFlight.urls.filter((u) => u.includes('/api/products')).length
    renderHome()

    fireEvent.click(await screen.findByRole('button', { name: /try again/i }))
    await waitFor(() => expect(statusRegion().textContent).toMatch(/loading new products/i))

    const before = requests()
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(requests()).toBe(before)

    await retryInFlight.settle([product(1)])
    await screen.findByText('Product 1')
  })

  it('the focus-landing heading carries the shared focus ring', async () => {
    /*
     * DESIGN_SYSTEM §4 — one focus treatment everywhere. A landing target that
     * draws the browser default is an indicator matching nothing else here.
     *
     * ⚠️ THIS ASSERTS THE CLASS, WHICH IS ALL jsdom CAN SEE. `.focus-ring` is
     * `outline: none` plus a `:focus-visible` rule, and jsdom does not model
     * `:focus-visible` — so this cannot tell a drawn ring from an invisible
     * one. Raised in review, and MEASURED in Chromium instead:
     *
     *   keyboard (Tab to Retry, Enter) -> :focus-visible MATCHES,
     *                                     2px solid rgb(14,88,82)
     *   pointer  (real mouse click)    -> no match, outline-style: none
     *
     * 🔴 THE POINTER RESULT IS CORRECT, NOT A DEFECT. That is what
     * `:focus-visible` is for: the keyboard user who pressed Retry gets the
     * ring, and a mouse user gets no focus ring anywhere else on this site
     * either. Drawing one here would be the inconsistency.
     */
    routed(ok([product(1)]))
    renderHome()

    await screen.findByText('Product 1')
    const heading = screen.getByRole('heading', { name: /new in store/i })
    expect(heading.className).toContain('focus-ring')
    expect(heading.getAttribute('tabindex')).toBe('-1')
  })

  it('🔴 the in-flight Retry button is aria-disabled, NEVER disabled', async () => {
    /*
     * 🔴 THIS TEST EXISTS BECAUSE THE BROWSER DISAGREED WITH A GREEN SUITE.
     * The first fix kept the button mounted during the retry but marked it
     * `disabled`, and `a retry that FAILS AGAIN keeps focus` passed. In
     * Chromium focus was on <body>: a disabled element is not focusable, so
     * the browser blurs it the moment the attribute appears. jsdom does not
     * implement that blur, so the assertion could not see the defect.
     *
     * ⚠️ Asserting on the ATTRIBUTE is what makes this checkable in jsdom at
     * all. It goes red the moment `disabled` comes back.
     */
    let resolveSecond: (value: Response) => void = () => {}
    let attempt = 0
    routed(async () => {
      attempt += 1
      if (attempt === 1) throw new TypeError('network')
      return new Promise<Response>((resolve) => {
        resolveSecond = resolve
      })
    })
    renderHome()

    const retry = await screen.findByRole('button', { name: /try again/i })
    fireEvent.click(retry)

    // In flight: still mounted, still focusable, and saying so.
    await waitFor(() => expect(statusRegion().textContent).toMatch(/loading new products/i))
    const inFlight = screen.getByRole('button', { name: /try again/i })
    expect(inFlight.hasAttribute('disabled')).toBe(false)
    expect(inFlight.getAttribute('aria-disabled')).toBe('true')

    await act(async () => {
      resolveSecond(await ok([product(1)])())
    })
    await screen.findByText('Product 1')
  })

  it('🔴 a retry that FAILS AGAIN keeps focus on the Retry button', async () => {
    // The second half of the same defect: the button unmounted while the
    // retry was in flight, so a repeated failure also dropped focus.
    routed(async () => {
      throw new TypeError('network')
    })
    renderHome()

    const retry = await screen.findByRole('button', { name: /try again/i })
    retry.focus()
    fireEvent.click(retry)

    await waitFor(() => expect(statusRegion().textContent).toMatch(/could not be loaded/i))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /try again/i }))
  })

  it('counts in the singular when exactly one product comes back', async () => {
    let attempt = 0
    routed(async () => {
      attempt += 1
      if (attempt === 1) throw new TypeError('network')
      return ok([product(1)])()
    })
    renderHome()

    fireEvent.click(await screen.findByRole('button', { name: /try again/i }))

    await screen.findByText('Product 1')
    await waitFor(() => expect(statusRegion().textContent).toBe('1 new product'))
  })

  it('announces the EMPTY outcome rather than "0 new products"', async () => {
    // A retry that succeeds with nothing to show must still say something —
    // silence here is the defect this issue is about.
    let attempt = 0
    routed(async () => {
      attempt += 1
      if (attempt === 1) throw new TypeError('network')
      return ok([])()
    })
    renderHome()

    fireEvent.click(await screen.findByRole('button', { name: /try again/i }))

    await waitFor(() => expect(statusRegion().textContent).toMatch(/no new products to show yet/i))
  })

  it('announces the count in Hebrew too', async () => {
    await act(async () => {
      await i18n.changeLanguage('he')
    })
    routed(ok([product(1), product(2)]))
    renderHome()

    await screen.findByText('מוצר 1')
    await waitFor(() => expect(statusRegion().textContent).toBe('שני מוצרים חדשים'))
  })
})
