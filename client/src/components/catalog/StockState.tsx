import { useTranslation } from 'react-i18next'
import { getStockState } from '../../lib/stockState'
import { Badge } from '../ui/Badge'

type StockStateProps = {
  stockQuantity: number
  lowStockThreshold: number
}

/**
 * DESIGN_SYSTEM.md §6: "In stock shows no indicator. Only scarcity and
 * absence are announced." Text-based (Badge), never colour alone.
 */
export function StockState({ stockQuantity, lowStockThreshold }: StockStateProps) {
  const { t } = useTranslation('catalog')
  const state = getStockState(stockQuantity, lowStockThreshold)

  /*
   * 🔴 ISSUE-047, cause 1 of 2. The row is ALWAYS rendered and always 21px
   * tall — the badge's measured height — so a card with a badge is the same
   * height as one without. Previously this returned `null` for in-stock
   * products, which made badged cards 33px taller (measured: 419px vs 386px).
   *
   * ⚠️ The design-system rule is UNCHANGED. DESIGN_SYSTEM.md §6 says "In stock
   * shows no indicator. Only scarcity and absence are announced" — and nothing
   * is announced here. The reserved box is empty and `aria-hidden`, so screen
   * readers and the accessibility tree see exactly what they saw before. What
   * changed is the layout, not the message.
   */
  return (
    <div className="flex min-h-[21px] items-center" aria-hidden={state === 'in' || undefined}>
      {state === 'in' ? null : <Badge variant={state === 'low' ? 'lowstock' : 'oos'}>{t(`stock.${state}`)}</Badge>}
    </div>
  )
}
