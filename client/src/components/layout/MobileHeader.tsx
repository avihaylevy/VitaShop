import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Logo } from '../brand/Logo'
import { SearchBox } from '../ui/SearchBox'
import { IconButton } from '../ui/IconButton'
import { HamburgerIcon } from '../icons'
import { FOCUS_RING } from '../ui/focusRing'
import { AccountMenu } from './AccountMenu'
import { FavouritesControl, CartControl } from './UtilityCluster'
import { MobileMenu } from './MobileMenu'
import { NAV_ITEMS } from './navItems'

/**
 * Mobile header — row 1 (hamburger, logo, account, favourites, cart) + row 2
 * (full-width search), DESIGN_SYSTEM.md §5. No secondary nav bar and no
 * horizontal scrolling — full navigation lives entirely in `MobileMenu`.
 */
export function MobileHeader() {
  const { t } = useTranslation('layout')
  const [menuOpen, setMenuOpen] = useState(false)
  const hamburgerRef = useRef<HTMLButtonElement>(null)

  function closeMenu() {
    setMenuOpen(false)
    hamburgerRef.current?.focus()
  }

  return (
    <header className="border-b border-border-hairline bg-surface-header md:hidden">
      <div className="flex items-center gap-1 px-3 py-2">
        <IconButton
          ref={hamburgerRef}
          icon={<HamburgerIcon />}
          aria-label={t('mobileMenu.openLabel')}
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
        />
        <Link to="/" className={`${FOCUS_RING} mx-1 shrink-0 rounded-card`}>
          <Logo variant="full" />
        </Link>
        <div className="flex-1" />
        <AccountMenu />
        <FavouritesControl />
        <CartControl />
      </div>
      <div className="px-3 pb-2">
        <SearchBox />
      </div>
      <MobileMenu open={menuOpen} onClose={closeMenu} navItems={NAV_ITEMS} />
    </header>
  )
}
