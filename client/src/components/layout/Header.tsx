import { Link, NavLink } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Logo } from '../brand/Logo'
import { SearchBox } from '../ui/SearchBox'
import { UtilityCluster } from './UtilityCluster'
import { FOCUS_RING } from '../ui/focusRing'
import { NAV_ITEMS } from './navItems'

/**
 * Desktop header — two rows (DESIGN_SYSTEM.md §5): brand row (logo,
 * dominant centred search, utilities) then a navigation row. Hidden below
 * `md`; `MobileHeader` takes over there.
 *
 * Active item: subtle tint + weight 600 + a 3px teal edge accent spanning
 * the full item — no pill, no radius. Every item shares identical rest/
 * hover/active treatment, `מבצעים` included — DEC-038: `--state-commerce`
 * is reserved for sale badges and product-level promotional UI, not a
 * persistent navigation label.
 */
export function Header() {
  const { t } = useTranslation('layout')

  return (
    <header className="hidden border-b border-border-hairline bg-surface-header md:block">
      <div className="mx-auto flex max-w-[1440px] items-center gap-6 px-7 py-3">
        <Link to="/" className={`${FOCUS_RING} shrink-0 rounded-card`}>
          <Logo variant="full" />
        </Link>
        <SearchBox className="mx-auto" />
        <UtilityCluster className="shrink-0" />
      </div>
      <nav aria-label={t('nav.mainLabel')} className="border-t border-border-hairline px-7">
        <ul className="flex items-center gap-6">
          {NAV_ITEMS.map((item) => (
            <li key={item.key}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `${FOCUS_RING} flex h-11 items-center border-b-[3px] px-1 text-sm font-medium text-text-ink transition-colors duration-150 ease-standard ${
                    isActive
                      ? 'border-brand-teal bg-surface-sunken font-semibold'
                      : 'border-transparent hover:border-border-hairline hover:bg-surface-sunken/40'
                  }`
                }
              >
                {t(`nav.${item.key}`)}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  )
}
