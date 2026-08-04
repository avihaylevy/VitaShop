/**
 * Stock-state derivation — design/DESIGN_SYSTEM.md §6 (Accepted, DEC-035):
 * "In stock shows no indicator. Only scarcity and absence are announced."
 *
 * Pure function, no rendering. `ProductCard`/`StockState` decide what to
 * render for each state; this only classifies the numbers.
 */
export type StockState = 'in' | 'low' | 'out'

export function getStockState(stockQuantity: number, lowStockThreshold: number): StockState {
  if (stockQuantity <= 0) {
    return 'out'
  }
  if (stockQuantity <= lowStockThreshold) {
    return 'low'
  }
  return 'in'
}
