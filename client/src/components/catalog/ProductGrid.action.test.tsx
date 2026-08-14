// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { ProductGrid } from './ProductGrid'
import type { ProductCardModel } from '../../types/product'

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
})

afterEach(cleanup)

describe('a SHOPPING card', () => {
  it('🔴 renders an Add to cart button — the catalogue contract', () => {
    renderGrid(<ProductGrid products={[MODEL]} onAddToCart={vi.fn()} />)
    expect(screen.getByRole('button', { name: /add to cart/i })).toBeTruthy()
  })

  it('calls back with the slug, not with translated text', () => {
    const onAddToCart = vi.fn()
    renderGrid(<ProductGrid products={[MODEL]} onAddToCart={onAddToCart} />)
    screen.getByRole('button', { name: /add to cart/i }).click()
    expect(onAddToCart).toHaveBeenCalledWith('fixture-product')
  })

  it('keeps the "one link + one button" shape the ARIA contract states', () => {
    renderGrid(<ProductGrid products={[MODEL]} onAddToCart={vi.fn()} />)
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.getAllByRole('button')).toHaveLength(1)
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
  it('renders the link and NO button', () => {
    renderGrid(<ProductGrid products={[MODEL]} navigational />)
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('🔴 THE CONTROL — the two kinds really differ', () => {
    // Without this pair, either assertion could pass against a card that had
    // lost its button everywhere, or grown one everywhere.
    const { unmount } = renderGrid(<ProductGrid products={[MODEL]} navigational />)
    expect(screen.queryByRole('button')).toBeNull()
    unmount()

    renderGrid(<ProductGrid products={[MODEL]} onAddToCart={vi.fn()} />)
    expect(screen.getByRole('button', { name: /add to cart/i })).toBeTruthy()
  })
})
