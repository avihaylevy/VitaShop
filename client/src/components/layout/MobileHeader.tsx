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
import { useCloseAboveBreakpoint } from '../../hooks/useCloseAboveBreakpoint'

/**
 * Mobile header — row 1 (hamburger, logo, account, favourites, cart) + row 2
 * (full-width search), DESIGN_SYSTEM.md §5. No secondary nav bar and no
 * horizontal scrolling — full navigation lives entirely in `MobileMenu`.
 */
export function MobileHeader() {
  const { t } = useTranslation('layout')
  const [menuOpen, setMenuOpen] = useState(false)
  const hamburgerRef = useRef<HTMLButtonElement>(null)

  // Close the mobile-only disclosure if the desktop header takes over.
  useCloseAboveBreakpoint(menuOpen, () => setMenuOpen(false))

  function closeMenu() {
    setMenuOpen(false)
  }

  return (
    <header className="border-b border-border-hairline bg-surface-header md:hidden">
      <div className="flex items-center gap-0 px-1 py-2 min-[375px]:gap-1 min-[375px]:px-3">
        <div className="relative shrink-0">
          <IconButton
            ref={hamburgerRef}
            icon={<HamburgerIcon />}
            aria-label={t('mobileMenu.openLabel')}
            aria-expanded={menuOpen}
            aria-controls="mobile-navigation-menu"
            onClick={() => setMenuOpen((value) => !value)}
          />
          <MobileMenu
            open={menuOpen}
            onClose={closeMenu}
            triggerRef={hamburgerRef}
            navItems={NAV_ITEMS}
          />
        </div>
        <Link to="/" className={`${FOCUS_RING} shrink-0 rounded-card min-[375px]:mx-1`}>
          <Logo variant="full" />
        </Link>
        <div className="flex-1" />
        <AccountMenu />
        <FavouritesControl />
        <CartControl />
      </div>
      <div className="px-4 pb-2">
        <div className="mx-auto w-full max-w-[320px]">
          <SearchBox />
        </div>
      </div>
    </header>
  )
}
