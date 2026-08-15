import { useTranslation } from 'react-i18next'
import { formatPrice } from '../../lib/formatPrice'

type PriceBlockProps = {
  price: string
  /**
   * DESIGN_SYSTEM.md §2: --text-price is 23/700 (18-19 mobile) — the card
   * and detail page pass 'price'; inline/metadata contexts keep 'base'.
   */
  size?: 'base' | 'price'
}

/**
 * DESIGN_SYSTEM.md §2: price stays LTR inside RTL text — isolated via dir="ltr".
 *
 * 🔴 ISSUE-084 — TWO ELEMENTS, ON PURPOSE, and the split is the fix. The
 * dir="ltr" span used to be the outermost element, so wherever a layout
 * blockified it (a flex item in the product card's column), its own
 * `text-align: start` resolved against ITS direction — left, in BOTH
 * languages — and the price was the only element on the card that did not
 * mirror in Hebrew. The outer span carries no `dir`: it inherits the page's
 * direction and aligns by IT (`text-start`), while the inner span keeps the
 * digits LTR. Isolation protects the digits; it must never pin the block.
 */
export function PriceBlock({ price, size = 'base' }: PriceBlockProps) {
  const { i18n } = useTranslation()
  const language = i18n.language === 'he' ? 'he' : 'en'

  return (
    <span className="text-start">
      <span
        dir="ltr"
        className={
          size === 'price'
            ? 'text-lg font-bold tracking-[-0.015em] text-text-ink md:text-[23px]'
            : 'text-base font-semibold text-text-ink'
        }
        style={{ unicodeBidi: 'isolate' }}
      >
        {formatPrice(price, language)}
      </span>
    </span>
  )
}
