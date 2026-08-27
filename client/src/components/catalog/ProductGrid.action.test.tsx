// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { ProductGrid } from './ProductGrid'
import type { ProductCardModel } from '../../types/product'

// ISSUE-115 — the card reads favourites from context; an inert mock keeps
// this file about the CART action shape.
vi.mock('../../state/FavouritesContext', () => ({
  useFavourites: () => ({ count: 0, isFavourite: () => false, toggle: async () => 'added' as const }),
}))

/**
 * DEC-110 (area 1) — the card derives its control from the cart line. The
 * real hook is null-tolerant (no provider → pill), which the "not in cart"
 * tests rely on unmocked; the in-cart tests flip this switchable stub
 * instead of mounting a fetching CartProvider.
 */
const cartLineStub: {
  line: { id: string; quantity: number } | null
  setLineQuantity: ReturnType<typeof vi.fn>
  removeLine: ReturnType<typeof vi.fn>
} = { line: null, setLineQuantity: vi.fn(), removeLine: vi.fn() }

vi.mock('../../state/CartContext', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../state/CartContext')>()
  return {
    ...original,
    useOptionalCartLine: () => ({
      line: cartLineStub.line,
      setLineQuantity: cartLineStub.setLineQuantity,
      removeLine: cartLineStub.removeLine,
      pending: false,
    }),
  }
})

/**
 * MILESTONE-008 Checkpoint F4 — the guard the TYPE used to be.
 *
 * 🔴 NOTHING IN THIS SUITE ASSERTED THAT A CATALOGUE CARD HAS AN ADD TO CART
 * BUTTON. `onAddToCart` was required, so the compiler enforced it and no test
 * needed to. F4 made the home page's shelf navigational, and the first attempt
 * did that by making the prop OPTIONAL — which would have let a later refactor
 * drop the handler from `CatalogPage` with a green type-check and a green
 * suite, silently removing every Add to cart button in the shop.
 *
 * The prop is a discriminated union now, so the compiler still catches it.
 * This file is the belt to that braces: a behavioural assertion that does not
 * depend on the type surviving a future edit.
 */

const MODEL: ProductCardModel = {
  slug: 'fixture-product',
  name: 'Fixture Product',
  categoryNameHe: 'ויטמינים',
  categoryName: 'Vitamins',
  price: '95.00',
  stockQuantity: 10,
  lowStockThreshold: 3,
  imageFile: null,
  brandName: 'Brand',
  dosageForm: 'Capsules',
  packageQuantity: 60,
}

function renderGrid(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  cartLineStub.line = null
  cartLineStub.setLineQuantity = vi.fn()
  cartLineStub.removeLine = vi.fn()
})

afterEach(cleanup)

describe('a SHOPPING card, product NOT in the cart', () => {
  it('🔴 renders an Add to cart button — the catalogue contract', () => {
    renderGrid(<ProductGrid products={[MODEL]} onAddToCart={vi.fn()} />)
    expect(screen.getByRole('button', { name: /add to cart/i })).toBeTruthy()
  })

  it('calls back with the slug and quantity 1 — the card adds one (DEC-110)', () => {
    const onAddToCart = vi.fn()
    renderGrid(<ProductGrid products={[MODEL]} onAddToCart={onAddToCart} />)
    screen.getByRole('button', { name: /add to cart/i }).click()
    expect(onAddToCart).toHaveBeenCalledWith('fixture-product', 1)
  })

  it('keeps the ARIA shape: one accessible link + heart + ONE add button', () => {
    // DEC-110 narrowed the contract: the pre-add stepper left the card
    // (it lives on the detail page); heart + add = 2 buttons.
    renderGrid(<ProductGrid products={[MODEL]} onAddToCart={vi.fn()} />)
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })
})

describe('a SHOPPING card, product IN the cart (DEC-110 — the stepper takes the pill\'s place)', () => {
  beforeEach(() => {
    cartLineStub.line = { id: 'line-1', quantity: 2 }
  })

  it('🔴 shows the cart-line stepper INSTEAD of the add button, at the server\'s quantity', () => {
    renderGrid(<ProductGrid products={[MODEL]} onAddToCart={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /add to cart/i })).toBeNull()
    expect(screen.getByText('2')).toBeTruthy()
    // ARIA shape: link + heart + − + + = 1 link, 3 buttons.
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.getAllByRole('button')).toHaveLength(3)
  })

  it('🔴 + routes through the ADD choreography (quiet-add rules), − PATCHes the line', () => {
    // + is another add-of-one through onAddToCart — the quiet-add,
    // announcement and clamp-reopens-drawer rules all live there, and a
    // raw PATCH would fork them. − has no add analog, so it edits the
    // line directly, subject = the resolved name.
    const onAddToCart = vi.fn()
    renderGrid(<ProductGrid products={[MODEL]} onAddToCart={onAddToCart} />)
    fireEvent.click(screen.getByRole('button', { name: /increase quantity/i }))
    expect(onAddToCart).toHaveBeenCalledWith('fixture-product', 1)
    expect(cartLineStub.setLineQuantity).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /decrease quantity/i }))
    expect(cartLineStub.setLineQuantity).toHaveBeenCalledWith('line-1', 'Fixture Product', 1)
  })

  it('🔴 − at quantity 1 REMOVES the line (the control hands back to the pill)', () => {
    cartLineStub.line = { id: 'line-1', quantity: 1 }
    cartLineStub.removeLine = vi.fn().mockResolvedValue({ cart: {}, outcome: {} })
    renderGrid(<ProductGrid products={[MODEL]} onAddToCart={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /decrease quantity/i }))
    expect(cartLineStub.removeLine).toHaveBeenCalledWith('line-1', 'Fixture Product')
    expect(cartLineStub.setLineQuantity).not.toHaveBeenCalled()
  })

  it('caps at 10 with aria-disabled, never a focus-dropping disabled attribute', () => {
    cartLineStub.line = { id: 'line-1', quantity: 10 }
    renderGrid(<ProductGrid products={[MODEL]} onAddToCart={vi.fn()} />)
    const increase = screen.getByRole('button', { name: /increase quantity/i })
    expect(increase.getAttribute('aria-disabled')).toBe('true')
    expect(increase.hasAttribute('disabled')).toBe(false)
    fireEvent.click(increase)
    expect(cartLineStub.setLineQuantity).not.toHaveBeenCalled()
  })
})

describe('DEC-110 — the pill↔stepper swap is a DELIBERATE focus hand-off (the unmount-takes-focus family)', () => {
  it('🔴 after a pill press whose add lands, focus moves to the stepper\'s + button', async () => {
    const { rerender } = renderGrid(<ProductGrid products={[MODEL]} onAddToCart={vi.fn()} />)
    const pill = screen.getByRole('button', { name: /add to cart/i })
    pill.focus()
    fireEvent.click(pill)
    // The add lands: the cart now holds the line (stub flip + rerender
    // stands in for the provider's cart replacement).
    cartLineStub.line = { id: 'line-1', quantity: 1 }
    rerender(
      <MemoryRouter>
        <ProductGrid products={[MODEL]} onAddToCart={vi.fn()} />
      </MemoryRouter>,
    )
    const increase = screen.getByRole('button', { name: /increase quantity/i })
    await vi.waitFor(() => expect(document.activeElement).toBe(increase))
  })

  it('🔴 the CONTROL — a cart change the card did NOT initiate moves no focus', async () => {
    // e.g. the drawer added this product: the stepper appears, but focus
    // stays wherever the shopper left it.
    const { rerender } = renderGrid(<ProductGrid products={[MODEL]} onAddToCart={vi.fn()} />)
    const heart = screen.getByRole('button', { name: /favourites/i })
    heart.focus()
    cartLineStub.line = { id: 'line-1', quantity: 1 }
    rerender(
      <MemoryRouter>
        <ProductGrid products={[MODEL]} onAddToCart={vi.fn()} />
      </MemoryRouter>,
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(document.activeElement).toBe(heart)
  })
})

describe('ISSUE-109 — the image is a click surface for the product, not a second link', () => {
  it('🔴 wraps the image in an anchor to the SAME product URL', () => {
    const { container } = renderGrid(<ProductGrid products={[MODEL]} onAddToCart={vi.fn()} />)
    const imageAnchor = container.querySelector('a[aria-hidden="true"]')
    expect(imageAnchor).not.toBeNull()
    expect(imageAnchor?.getAttribute('href')).toBe('/product/fixture-product')
  })

  it('🔴 the image anchor is NOT a tab stop and NOT in the accessibility tree', () => {
    const { container } = renderGrid(<ProductGrid products={[MODEL]} onAddToCart={vi.fn()} />)
    const imageAnchor = container.querySelector('a[aria-hidden="true"]')
    expect(imageAnchor?.getAttribute('tabindex')).toBe('-1')
    // The role query respects aria-hidden, so the accessible-link count
    // staying 1 (the shape test above) is the a11y-tree half of this proof.
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })
})

describe('a NAVIGATIONAL card', () => {
  it('renders the link and ONLY the favourite button — no cart machinery', () => {
    renderGrid(<ProductGrid products={[MODEL]} navigational />)
    expect(screen.getAllByRole('link')).toHaveLength(1)
    // The heart is on every card (ISSUE-115); the stepper and add button
    // are the shopping card's alone.
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /add to cart/i })).toBeNull()
  })

  it('🔴 THE CONTROL — the two kinds really differ', () => {
    // Without this pair, either assertion could pass against a card that had
    // lost its cart button everywhere, or grown one everywhere.
    const { unmount } = renderGrid(<ProductGrid products={[MODEL]} navigational />)
    expect(screen.queryByRole('button', { name: /add to cart/i })).toBeNull()
    unmount()

    renderGrid(<ProductGrid products={[MODEL]} onAddToCart={vi.fn()} />)
    expect(screen.getByRole('button', { name: /add to cart/i })).toBeTruthy()
  })
})
