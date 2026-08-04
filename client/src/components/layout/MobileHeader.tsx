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

  // The menu's container is `md:hidden`, so growing past md while it is
  // open would leave a display:none dialog mounted — and #root inert with
  // the body scroll locked behind it.
  useCloseAboveBreakpoint(menuOpen, () => setMenuOpen(false))

  // No manual hamburgerRef.current?.focus() here any more: Modal captures
  // the trigger on open and restores focus on unmount (DESIGN_SYSTEM.md §8
  // obligation 3). Doing it here as well would fight the Modal for focus.
  function closeMenu() {
    setMenuOpen(false)
  }

  return (
    <header className="border-b border-border-hairline bg-surface-header md:hidden">
      <div className="flex items-center gap-0 px-1 py-2 min-[375px]:gap-1 min-[375px]:px-3">
        <IconButton
          ref={hamburgerRef}
          icon={<HamburgerIcon />}
          aria-label={t('mobileMenu.openLabel')}
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
        />
        <Link to="/" className={`${FOCUS_RING} shrink-0 rounded-card min-[375px]:mx-1`}>
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
