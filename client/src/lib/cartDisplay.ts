import type { Cart, CartLine } from '../types/cart'
import type { SupportedLanguage } from '../i18n'

/**
 * Cart display model — MILESTONE-007 Checkpoint G.
 *
 * Pure mapping from the SERVER's cart line to exactly what a row renders. It
 * exists so `CartItemRow` holds no derivation of its own.
 *
 * 🔴 NO MONEY ARITHMETIC HAPPENS HERE, and now none is possible: `unitPrice`
 * and `lineTotal` both arrive computed from the product row, per request. The
 * prototype reconstructed prices from stored agorot; storing them at all was
 * the §3.4 violation this checkpoint removed.
 *
 * 🔴 NOTHING HERE CLAMPS, REPAIRS OR DEFAULTS. The server decides quantities;
 * this file only asks what a control should look like next to one.
 *
 * ⚠️ The name is resolved from `nameHe`/`nameEn` on every render, so a language
 * toggle now retranslates existing lines. The prototype froze the name at add
 * time (its D4 limitation) because it had no product row to consult. That
 * limitation is gone with the state layer that caused it.
 */

export type CartLineDisplay = {
  /** The LINE id — what PATCH/DELETE address. Never the product id. */
  id: string
  slug: string
  /** Language-resolved from the server's paired names, never stored. */
  name: string
  brandName: string
  packageQuantity: number
  imageFile: string | null
  /** Canonical two-decimal strings, both server-computed. */
  unitPrice: string
  lineTotal: string
  quantity: number
  /** LIVE stock, not a snapshot — the server read it on this request. */
  maxQuantity: number
  lowStockThreshold: number
  /** 🔴 C3: false means the product was withdrawn while the cart was held. */
  isActive: boolean
  canDecrement: boolean
  canIncrement: boolean
  atStockCap: boolean
}

export function toCartLineDisplay(line: CartLine, language: SupportedLanguage): CartLineDisplay {
  return {
    id: line.id,
    slug: line.slug,
    name: language === 'he' ? line.nameHe : line.nameEn,
    brandName: line.brandName,
    packageQuantity: line.packageQuantity,
    imageFile: line.imageFile,
    unitPrice: line.unitPrice,
    lineTotal: line.lineTotal,
    quantity: line.quantity,
    maxQuantity: line.stockQuantity,
    lowStockThreshold: line.lowStockThreshold,
    isActive: line.isActive,
    // Decrement to 0 is a REMOVAL (Checkpoint D), and removal has its own
    // labelled control, so the stepper's floor stays 1.
    canDecrement: line.quantity > 1,
    /**
     * 🔴 BOUNDED BY STOCK ONLY — deliberately NOT by the per-line cap of 10.
     *
     * The cap is a SERVER rule (§7.9 C2, enforced in `cartQuantity.ts`).
     * Repeating the number here would put a second copy of it in the browser,
     * which is the two-sources-of-truth defect this whole checkpoint removes:
     * change the server's cap and the button would silently keep enforcing the
     * old one. Stock is different — it is in the DTO, so honouring it costs
     * nothing and invents nothing.
     *
     * A shopper who reaches the cap therefore presses an ENABLED button and the
     * quantity does not move — which is exactly what `alreadyAtMaximum` exists
     * to explain, and the row says so.
     */
    canIncrement: line.quantity < line.stockQuantity,
    atStockCap: line.quantity >= line.stockQuantity,
  }
}

export function getCartLines(cart: Cart, language: SupportedLanguage): CartLineDisplay[] {
  return cart.items.map((line) => toCartLineDisplay(line, language))
}

export function isCartEmpty(cart: Cart): boolean {
  return cart.items.length === 0
}

/** Distinct product lines, NOT total units — the badge already counts units. */
export function getCartLineCount(cart: Cart): number {
  return cart.items.length
}
