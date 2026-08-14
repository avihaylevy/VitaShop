import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { HeartIcon, CartIcon, GlobeIcon } from '../icons'
import { Icon } from '../ui/Icon'
import { FOCUS_RING } from '../ui/focusRing'
import { AccountMenu } from './AccountMenu'
import { useCart } from '../../state/CartContext'
import { useFavourites } from '../../state/FavouritesContext'
import { applyDocumentDirection, type SupportedLanguage } from '../../i18n'

type UtilityClusterProps = {
  className?: string
}

function LanguageToggle() {
  const { t, i18n } = useTranslation('layout')
  const current = i18n.language as SupportedLanguage
  const next: SupportedLanguage = current === 'he' ? 'en' : 'he'

  function handleClick() {
    void i18n.changeLanguage(next)
    applyDocumentDirection(next)
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={t('language.toggleLabel')}
      className={`${FOCUS_RING} group flex h-11 min-w-11 items-center justify-center rounded-card`}
    >
      <span className="inline-flex items-center gap-1.5 rounded-compact px-1.5 py-1 text-sm font-medium text-text-muted transition-colors duration-150 ease-standard group-hover:bg-surface-sunken">
        <Icon size={18}>
          <GlobeIcon />
        </Icon>
        <span className="hidden lg:inline">{t(`language.${next}` as const)}</span>
      </span>
    </button>
  )
}

export function FavouritesControl() {
  const { t } = useTranslation('layout')
  const { count } = useFavourites()
  const ariaLabel = count > 0 ? t('favourites.ariaLabelWithCount', { count }) : t('favourites.ariaLabelEmpty')

  return (
    <Link
      to="/favourites"
      aria-label={ariaLabel}
      className={`${FOCUS_RING} group relative flex h-11 min-w-11 items-center justify-center rounded-card`}
    >
      <span className="inline-flex items-center gap-1.5 rounded-compact px-1.5 py-1 text-sm font-medium text-text-ink transition-colors duration-150 ease-standard group-hover:bg-surface-sunken">
        <span className="relative inline-flex">
          <Icon size={18}>
            <HeartIcon filled={count > 0} />
          </Icon>
          {count > 0 && (
            <span
              aria-hidden="true"
              className="absolute -top-1.5 -end-1.5 flex h-4 min-w-4 items-center justify-center rounded-round border border-brand-teal bg-well px-1 text-[10px] leading-none text-brand-teal"
            >
              {count}
            </span>
          )}
        </span>
        <span className="hidden lg:inline">{t('favourites.label')}</span>
      </span>
    </Link>
  )
}

export function CartControl() {
  const { t } = useTranslation('layout')
  // Total UNITS across every cart line, not the number of distinct lines:
  // adding the same product twice moves the badge 1 -> 2, so the badge and
  // the add-to-cart confirmation can never contradict each other.
  //
  // 🔴 The count is the SERVER's `totalQuantity`, from the last response —
  // never summed here from the rows. A badge that re-derives its own total is
  // a second answer to a question the response already answered, and it is the
  // one part of the cart visible on every page.
  const { cart } = useCart()
  const totalQuantity = cart.totalQuantity
  const ariaLabel =
    totalQuantity > 0 ? t('cart.ariaLabelWithCount', { count: totalQuantity }) : t('cart.ariaLabelEmpty')

  return (
    <Link
      to="/cart"
      aria-label={ariaLabel}
      className={`${FOCUS_RING} group relative flex h-11 min-w-11 items-center justify-center rounded-card text-text-ink`}
    >
      <span className="inline-flex items-center justify-center rounded-compact px-1.5 py-1 transition-colors duration-150 ease-standard group-hover:bg-surface-sunken">
        <Icon size={20}>
          <CartIcon />
        </Icon>
      </span>
      {totalQuantity > 0 && (
        /*
         * ISSUE-113 — keyed by the committed total so every change REMOUNTS
         * the span and restarts the pop animation (index.css). motion-safe:
         * gates the animation only; under prefers-reduced-motion the number
         * still changes, statically. aria-hidden stays — the add-to-cart
         * announcement is the audible confirmation, and animating must not
         * add a second one.
         */
        <span
          key={totalQuantity}
          aria-hidden="true"
          className="absolute -top-1 -end-1 flex h-5 min-w-5 items-center justify-center rounded-round bg-brand-teal px-1 text-[11px] font-medium leading-none text-white motion-safe:animate-[cart-badge-pop_300ms_var(--ease-standard)]"
        >
          {totalQuantity}
        </span>
      )}
    </Link>
  )
}

/**
 * Deliberate hierarchy, not four equal stacks (DESIGN_SYSTEM.md §5): a
 * hairline separates language from account/favourites/cart. Cart's badge
 * is filled teal, favourites' is outline — the two must never compete.
 */
export function UtilityCluster({ className = '' }: UtilityClusterProps) {
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <LanguageToggle />
      <span aria-hidden="true" className="mx-1 h-6 w-px bg-border-hairline" />
      <AccountMenu />
      <FavouritesControl />
      <CartControl />
    </div>
  )
}
