import { useEffect, useRef, type RefObject } from 'react'
import { NavLink } from 'react-router'
import { useTranslation } from 'react-i18next'
import { FOCUS_RING } from '../ui/focusRing'
import type { NavItem } from './navItems'
import { applyDocumentDirection, type SupportedLanguage } from '../../i18n'

type MobileMenuProps = {
  open: boolean
  onClose: () => void
  triggerRef: RefObject<HTMLButtonElement | null>
  navItems: readonly NavItem[]
}

/**
 * Compact non-modal navigation disclosure anchored to its trigger. It does
 * not trap focus, lock scrolling, make the page inert, or claim modal
 * semantics. Escape and outside pointer interaction dismiss it.
 */
export function MobileMenu({ open, onClose, triggerRef, navItems }: MobileMenuProps) {
  const { t, i18n } = useTranslation('layout')
  const panelRef = useRef<HTMLDivElement>(null)
  const current = i18n.language as SupportedLanguage
  const next: SupportedLanguage = current === 'he' ? 'en' : 'he'

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        onClose()
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
        triggerRef.current?.focus()
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, onClose, triggerRef])

  if (!open) return null

  function changeLanguage() {
    void i18n.changeLanguage(next)
    applyDocumentDirection(next)
    onClose()
  }

  return (
    <div
      ref={panelRef}
      id="mobile-navigation-menu"
      className="absolute start-0 top-full z-[var(--z-dropdown)] mt-2 w-72 max-w-[calc(100vw-24px)] rounded-card border border-border-hairline bg-well p-2 shadow-[0_8px_24px_rgba(31,37,46,0.12)]"
    >
      <nav aria-label={t('nav.mobileLabel')}>
        <ul className="flex flex-col">
          {navItems.map((item) => (
            <li key={item.key}>
              <NavLink
                to={item.to}
                end={item.end}
                onClick={onClose}
                className={({ isActive }) =>
                  `${FOCUS_RING} flex min-h-11 items-center rounded-compact border-s-[3px] px-3 text-sm font-medium text-text-ink transition-colors duration-150 ease-standard ${
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
        <div className="mt-2 border-t border-border-hairline pt-2">
          <button
            type="button"
            onClick={changeLanguage}
            aria-label={t('language.toggleLabel')}
            className={`${FOCUS_RING} flex min-h-11 w-full items-center justify-between rounded-compact px-3 text-sm font-medium text-text-ink hover:bg-surface-sunken`}
          >
            <span>{t('language.toggleLabel')}</span>
            <span lang={next}>{t(`language.${next}` as const)}</span>
          </button>
        </div>
      </nav>
    </div>
  )
}
