import { useEffect, useId, useRef } from 'react'
import { Link, NavLink } from 'react-router'
import { useTranslation } from 'react-i18next'
import { CloseIcon } from '../icons'
import { IconButton } from '../ui/IconButton'
import { FOCUS_RING } from '../ui/focusRing'
import type { NavItem } from './navItems'

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

type MobileMenuProps = {
  open: boolean
  /** Must also return focus to the hamburger trigger — this component only traps/cycles focus while open. */
  onClose: () => void
  navItems: readonly NavItem[]
}

/**
 * Full-screen mobile navigation. Implements 3 of the 4 obligations
 * DESIGN_SYSTEM.md §8 defines for modal dialogs — focus trap, Escape
 * closes, focus returns to the trigger (via the caller's `onClose`). It
 * deliberately does NOT make the background `inert`: STATUS.md records the
 * mobile menu as "the reference" for items 1–3, with item 4 (background
 * inert) "not implemented anywhere yet" — that lands with `Modal`/`Drawer`
 * in TASK-010 build order step 4, still out of scope here. `hidden` when
 * closed removes it from the accessibility tree and tab order without a
 * separate `aria-hidden`.
 */
export function MobileMenu({ open, onClose, navItems }: MobileMenuProps) {
  const { t } = useTranslation('layout')
  const containerRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    const container = containerRef.current
    if (!container) return

    const focusables = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    focusables[0]?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !container) return
      const nodes = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      if (nodes.length === 0) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  return (
    <div
      ref={containerRef}
      hidden={!open}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex flex-col bg-surface-page md:hidden"
    >
      <div className="flex items-center justify-between border-b border-border-hairline px-4 py-3">
        <h2 id={titleId} className="text-base font-semibold text-text-ink">
          {t('mobileMenu.title')}
        </h2>
        <IconButton icon={<CloseIcon />} aria-label={t('mobileMenu.closeLabel')} onClick={onClose} />
      </div>
      <nav aria-label={t('nav.mobileLabel')} className="flex-1 overflow-y-auto px-2 py-2">
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
    </div>
  )
}
