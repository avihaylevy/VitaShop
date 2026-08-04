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

  if (state === 'in') {
    return null
  }

  return <Badge variant={state === 'low' ? 'lowstock' : 'oos'}>{t(`stock.${state}`)}</Badge>
}
