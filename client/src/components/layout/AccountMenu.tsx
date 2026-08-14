import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { UserIcon, ChevronDownIcon } from '../icons'
import { Icon } from '../ui/Icon'
import { FOCUS_RING } from '../ui/focusRing'
import { useSession } from '../../state/SessionContext'

/**
 * Account control + its dropdown. A WAI-ARIA menu-button disclosure, not a
 * modal — Escape closes and returns focus to the trigger, and a
 * pointerdown outside the menu closes it, but the background is not made
 * inert (that obligation is reserved for real modal dialogs — the cart
 * drawer and the mobile menu — per DESIGN_SYSTEM.md §8 / UI_IMPLEMENTATION_
 * PLAN.md §2, neither of which this is).
 *
 * Real `/login` and `/register` navigation, not a fake instant sign-in —
 * DESIGN_SYSTEM.md §5: "authentication is never communicated by the user
 * icon alone... the signed-out menu exposes התחברות (primary) and
 * יצירת חשבון as two distinct actions." Neither route is built yet
 * (out of scope this slice), same gap as SearchBox's /catalog target.
 */
export function AccountMenu() {
  const { t } = useTranslation('layout')
  const { isSignedIn, isAdmin, firstName, email, signOut } = useSession()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const triggerLabel = isSignedIn ? t('account.myAccount') : t('account.signInCta')

  function closeAndReturnFocus() {
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('account.menuLabel')}
        onClick={() => setOpen((value) => !value)}
        className={`${FOCUS_RING} group flex h-11 min-w-11 items-center justify-center rounded-card`}
      >
        <span
          className={`inline-flex items-center gap-1.5 rounded-compact px-1.5 py-1 text-sm font-medium text-text-ink transition-colors duration-150 ease-standard ${
            open ? 'bg-surface-sunken' : 'group-hover:bg-surface-sunken'
          }`}
        >
          <Icon size={18}>
            <UserIcon />
          </Icon>
          <span className="hidden lg:inline">{triggerLabel}</span>
          <span className="hidden lg:inline-flex">
            <Icon size={14} className={`transition-transform duration-150 ease-standard ${open ? 'rotate-180' : ''}`}>
              <ChevronDownIcon />
            </Icon>
          </span>
        </span>
      </button>

      {open && (
        /*
         * 🔴 THE WRAPPER IS NOT THE MENU — review finding on ISSUE-089's
         * first draft. The identity block sat INSIDE role="menu" as
         * role="presentation", but presentation is not inherited: its <p>
         * children stayed in the accessibility tree as non-menuitem children
         * of a menu — an invalid owned-element structure that screen readers
         * commonly SKIP in menu-reading mode. The block ISSUE-089 exists to
         * deliver would have been inaudible to exactly its audience. The
         * popup styling lives here; role="menu" wraps ONLY the menuitems.
         */
        <div className="absolute end-0 top-full z-[var(--z-dropdown)] mt-2 w-56 rounded-card border border-border-hairline bg-well p-2 shadow-[0_8px_24px_rgba(31,37,46,0.12)]">
          {isSignedIn && (firstName !== null || email !== null) && (
            /*
              🔴 ISSUE-089 — WHO is signed in, finally said out loud. Before
              this, signing in changed one label ("התחברות" -> "החשבון שלי")
              and that was the entire signal.
              ⚠️ Rendered only when the server actually sent an identity —
              its fail-closed branch omits it, and a placeholder would be
              the interface inventing who you are.
            */
            <div className="mb-2 border-b border-border-hairline px-3 pb-2 pt-1">
              <p className="text-xs text-text-muted">{t('account.signedInAs')}</p>
              {firstName !== null && (
                <p className="truncate text-sm font-medium text-text-ink">{firstName}</p>
              )}
              {email !== null && (
                /*
                 * The ISSUE-084 pattern: the OUTER element inherits the
                 * page direction and aligns by it; only the INNER span is
                 * dir="ltr", so the @-parts keep their order without the
                 * block being pinned to the left in Hebrew.
                 */
                <p className="truncate text-xs text-text-muted">
                  <span dir="ltr" style={{ unicodeBidi: 'isolate' }}>
                    {email}
                  </span>
                </p>
              )}
            </div>
          )}
          <div role="menu" aria-label={t('account.menuLabel')}>
          {isSignedIn ? (
            <>
              <Link
                role="menuitem"
                /*
                 * 🔴 ISSUE-102 — THIS POINTED AT `/account`, WHICH HAS NO
                 * ROUTE. Every signed-in shopper who opened this menu and
                 * clicked landed on the 404 page, and had done since the menu
                 * shipped. Checkpoint G2 built `/account/orders`, so the link
                 * now goes somewhere and the label says what it does.
                 *
                 * ⚠️ The personal area REQ-F-051 describes — profile,
                 * addresses, favourites — is still unbuilt. Naming this "my
                 * orders" is the honest description of what exists.
                 */
                to="/account/orders"
                onClick={() => setOpen(false)}
                className={`${FOCUS_RING} block rounded-compact px-3 py-2 text-sm text-text-ink hover:bg-surface-sunken`}
              >
                {t('account.myOrders')}
              </Link>
              {/*
                🔴 ISSUE-097 CLOSED — the admin screen has existed since F3b
                with NOTHING linking to it, so an admin signing in found a site
                that behaved exactly like a shopper's. The user reported it as
                "I cannot do anything as an admin".

                🔴 THIS LINK IS UX, NOT SECURITY. `isAdmin` comes from the
                session response (DEC-071) and only decides whether the entry is
                DRAWN. Every admin route re-reads `User.role` from the database
                per request (DEC-065), so a demoted admin who still has this
                markup cached gets a 403 the moment they use it.
              */}
              {isAdmin && (
                <Link
                  role="menuitem"
                  to="/admin/orders"
                  onClick={() => setOpen(false)}
                  className={`${FOCUS_RING} block rounded-compact px-3 py-2 text-sm text-text-ink hover:bg-surface-sunken`}
                >
                  {t('account.adminOrders')}
                </Link>
              )}
              <button
                role="menuitem"
                type="button"
                onClick={() => {
                  void signOut()
                  closeAndReturnFocus()
                }}
                className={`${FOCUS_RING} block w-full rounded-compact px-3 py-2 text-start text-sm text-text-ink hover:bg-surface-sunken`}
              >
                {t('account.signOut')}
              </button>
            </>
          ) : (
            <>
              <Link
                role="menuitem"
                to="/login"
                onClick={() => setOpen(false)}
                className={`${FOCUS_RING} mb-2 flex h-11 items-center justify-center rounded-card border border-transparent bg-brand-teal px-4 text-sm font-medium text-white hover:bg-brand-teal-strong`}
              >
                {t('account.signInCta')}
              </Link>
              <Link
                role="menuitem"
                to="/register"
                onClick={() => setOpen(false)}
                className={`${FOCUS_RING} flex h-11 items-center justify-center rounded-card px-3 text-sm font-medium text-text-ink hover:bg-surface-sunken`}
              >
                {t('account.registerCta')}
              </Link>
            </>
          )}
          </div>
        </div>
      )}
    </div>
  )
}
