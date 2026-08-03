import { useRef } from 'react'
import { Link, NavLink } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Modal } from '../ui/Modal'
import { FOCUS_RING } from '../ui/focusRing'
import type { NavItem } from './navItems'

type MobileMenuProps = {
  open: boolean
  /** Modal now owns returning focus to the trigger; this only closes. */
  onClose: () => void
  navItems: readonly NavItem[]
}

/**
 * Full-screen mobile navigation, now a `Modal` consumer.
 *
 * It previously hand-implemented 3 of DESIGN_SYSTEM.md §8's 4 obligations
 * and explicitly deferred the fourth. All four now come from `Modal`, so
 * the duplicated FOCUSABLE_SELECTOR, keydown handler and Tab-wrap logic
 * are gone, and the background is finally `inert` while the menu is open —
 * the one intended behavioural change in this migration.
 *
 * 🔴 Everything else is deliberately unchanged: initial focus stays on the
 * close button (passed explicitly via closeButtonRef + initialFocusRef
 * rather than relying on it happening to be first in DOM order), Tab and
 * Shift+Tab still wrap, Escape still closes, focus still returns to the
 * hamburger, and the content, labels, routes and visual design are
 * untouched.
 *
 * No scrim: this is an opaque full-screen panel, so there is nothing
 * behind it to dim. `md:hidden` lives on the Modal container because the
 * panel is portalled to document.body and no longer inherits it from the
 * mobile <header>.
 */
export function MobileMenu({ open, onClose, navItems }: MobileMenuProps) {
  const { t } = useTranslation('layout')
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('mobileMenu.title')}
      closeLabel={t('mobileMenu.closeLabel')}
      closeButtonRef={closeButtonRef}
      initialFocusRef={closeButtonRef}
      scrim={false}
      containerClassName="items-stretch justify-start md:hidden"
      panelClassName="h-full w-full overflow-hidden bg-surface-page"
    >
      <nav aria-label={t('nav.mobileLabel')} className="px-2 py-2">
        <ul className="flex flex-col">
          {navItems.map((item) => (
            <li key={item.key}>
              <NavLink
                to={item.to}
                end={item.end}
                onClick={onClose}
                className={({ isActive }) =>
                  `${FOCUS_RING} flex h-12 items-center rounded-card border-s-[3px] px-3 text-base font-medium text-text-ink transition-colors duration-150 ease-standard ${
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
        <div className="mt-4 flex flex-col gap-2 border-t border-border-hairline px-3 pt-4">
          <Link
            to="/login"
            onClick={onClose}
            className={`${FOCUS_RING} flex h-12 items-center justify-center rounded-card border border-transparent bg-brand-teal text-base font-medium text-white`}
          >
            {t('account.signInCta')}
          </Link>
          <Link
            to="/register"
            onClick={onClose}
            className={`${FOCUS_RING} flex h-12 items-center justify-center rounded-card text-base font-medium text-text-ink hover:bg-surface-sunken`}
          >
            {t('account.registerCta')}
          </Link>
        </div>
      </nav>
    </Modal>
  )
}
