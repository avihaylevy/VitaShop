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

/**
 * 🔴 ISSUE-080 / DEC-059 answer 3 — WHY THE ROW NEEDS A DISCRIMINANT AND NOT
 * ANOTHER BOOLEAN.
 *
 * "Unpurchasable" is ONE condition with three shapes, and the shopper's next
 * action is different in each: a withdrawn product must be REMOVED, a sold-out
 * one must be REMOVED, and a short-stock one is fixed by LOWERING the quantity
 * — the line can still be bought. A boolean would have collapsed the third
 * into the first two and told the shopper to delete a line they can keep.
 *
 * ⚠️ Until Checkpoint F1 the row's only unpurchasability signal was
 * `!isActive`. Nothing rendered from `quantity > stockQuantity`, which is the
 * condition the SERVER blocks on — so a short-stock line blocked checkout
 * while its row said "this is all the stock currently available", which is
 * reassurance printed on the line that is stopping the order.
 *
 * 🔴 ORDER MATTERS. A withdrawn product's stock is irrelevant, and DEC-059
 * requires the two to read differently ("no longer sold" vs "sold out"), so
 * `withdrawn` is tested first and a withdrawn line never reports as sold out.
 */
export type CartLinePurchasability = 'ok' | 'withdrawn' | 'soldOut' | 'shortStock'

function purchasabilityOf(line: CartLine): CartLinePurchasability {
  if (!line.isActive) return 'withdrawn'
  if (line.stockQuantity === 0) return 'soldOut'
  // 🔴 The SERVER's rule, quoted: `orderService`'s guarded decrement needs
  // `stockQuantity >= quantity`, and `lib/purchasability.ts` is where the
  // server states it. A row testing `stockQuantity > 0` instead would call a
  // cart of 3 against a stock of 1 fine, and checkout would refuse it.
  if (line.quantity > line.stockQuantity) return 'shortStock'
  return 'ok'
}

export type CartLineDisplay = {
  /** The LINE id — what PATCH/DELETE address. Never the product id. */
  id: string
  slug: string
  /** Language-resolved from the server's paired names, never stored. */
  name: string
  brandName: string
  packageQuantity: number
  /** Raw dosage-form key — feeds packageUnitLabel for volume forms. */
  dosageForm?: string
  imageFile: string | null
  /** Canonical two-decimal strings, both server-computed. */
  unitPrice: string
  /** The undiscounted figure. Rendered struck through when a discount applies. */
  baseUnitPrice: string
  /**
   * The seventh list, item 2 — whether a club discount is visible on this
   * line. 🔴 A STRING COMPARISON of two server figures, not arithmetic: the
   * client still derives no money, it only notices the server sent two
   * different numbers for the same unit.
   */
  hasClubDiscount: boolean
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
  /** 🔴 ISSUE-080 — which of the three unbuyable shapes this line is, if any. */
  purchasability: CartLinePurchasability
  /**
   * 🔴 F1a: an unpurchasable line contributes to NOTHING (DEC-059 answer 3),
   * so its `lineTotal` is displayed but is NOT part of the subtotal. The row
   * has to say so, or the shopper is left adding the line totals up and
   * getting a different number than the cart shows.
   */
  countsTowardTotal: boolean
}

export function toCartLineDisplay(line: CartLine, language: SupportedLanguage): CartLineDisplay {
  const purchasability = purchasabilityOf(line)
  return {
    purchasability,
    countsTowardTotal: purchasability === 'ok',
    id: line.id,
    slug: line.slug,
    name: language === 'he' ? line.nameHe : line.nameEn,
    // DEC-085 (user, 2026-08-15) — the same pick as mapCatalogProduct: the
    // brand reads in its manufacturer Latin form in BOTH languages, with a
    // per-line fallback to the stored name.
    brandName: line.brandNameEn ?? line.brandName,
    packageQuantity: line.packageQuantity,
    dosageForm: line.dosageForm,
    imageFile: line.imageFile,
    unitPrice: line.unitPrice,
    baseUnitPrice: line.baseUnitPrice,
    hasClubDiscount: line.baseUnitPrice !== line.unitPrice,
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
