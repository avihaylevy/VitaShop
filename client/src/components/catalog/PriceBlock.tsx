import { useTranslation } from 'react-i18next'
import { formatPrice } from '../../lib/formatPrice'

type PriceBlockProps = {
  price: string
}

/** DESIGN_SYSTEM.md §2: price stays LTR inside RTL text — isolated via dir="ltr". */
export function PriceBlock({ price }: PriceBlockProps) {
  const { i18n } = useTranslation()
  const language = i18n.language === 'he' ? 'he' : 'en'

  return (
    <span dir="ltr" className="text-base font-semibold text-text-ink" style={{ unicodeBidi: 'isolate' }}>
      {formatPrice(price, language)}
    </span>
  )
}
