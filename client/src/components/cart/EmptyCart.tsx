import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Icon } from '../ui/Icon'
import { CartIcon } from '../icons'
import { FOCUS_RING } from '../ui/focusRing'

/**
 * DESIGN_SYSTEM.md §9 — empty cart: icon, heading, one line of direction and
 * a primary action.
 *
 * 🔴 The §9 pattern also lists a link to favourites. It is deliberately NOT
 * rendered: `/favourites` has no production route yet, and a second dead link
 * is worse than an omission. It returns when that route exists.
 *
 * No product suggestions, no marketing copy, no medical copy, no checkout.
 */
export function EmptyCart() {
  const { t } = useTranslation('cart')

  return (
    <div className="mt-6 flex flex-col items-start gap-3">
      <Icon size={32}>
        <CartIcon />
      </Icon>

      <h2 className="heading-section">{t('empty.heading')}</h2>
      <p className="text-sm text-text-muted">{t('empty.message')}</p>

      <Link
        to="/catalog"
        className={`${FOCUS_RING} inline-flex min-h-11 items-center rounded-compact text-sm font-medium text-brand-teal underline`}
      >
        {t('empty.browseCatalog')}
      </Link>
    </div>
  )
}
