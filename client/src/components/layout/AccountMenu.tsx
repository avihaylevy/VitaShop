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
 * יצירת חשבון as two distinct actions." (ISSUE-059 sweep: this note once
 * said neither route was built — both /login and /register shipped with
 * MILESTONE-006 and the links have been live since.)
 */
export function AccountMenu() {
  const { t } = useTranslation('layout')
  const { isSignedIn, isAdmin, firstName, email, signOut } = useSession()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  /*
   * ISSUE-039 — the ARIA menu-button pattern actually followed: opening MOVES
   * FOCUS to the first menuitem (it used to stay on the trigger, so the
   * declared role=menu was a promise the keyboard experience broke), and
   * arrow keys walk the items. Escape already closes and returns focus.
   */
  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [open])

  function handleMenuKeyDown(event: React.KeyboardEvent) {
    // APG: Tab closes a menu rather than leaving it open behind the focus.
    // 🔴 Focus the TRIGGER before closing — the unmount-takes-focus family
    // (.claude/rules/browser-verification.md): closing first removes the
    // focused menuitem, and the browser's default Tab then restarts from the
    // document top instead of the element after the trigger. With focus moved
    // first and the default NOT prevented, Tab/Shift+Tab continue naturally
    // from the trigger. jsdom asserts the focus move; the default-Tab half is
    // browser-verified (it has no default Tab navigation to test).
    if (event.key === 'Tab') {
      triggerRef.current?.focus()
      setOpen(false)
      return
    }
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End']
    if (!keys.includes(event.key)) return
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    if (items.length === 0) return
    event.preventDefault()
    const current = items.indexOf(document.activeElement as HTMLElement)
    // Review finding: with nothing focused, current is -1 and the modular
    // arithmetic sent ArrowUp to items[n-2]. From an unfocused state the
    // arrows enter at the ends: ArrowDown -> first, ArrowUp -> last.
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : current === -1
            ? event.key === 'ArrowDown'
              ? 0
              : items.length - 1
            : event.key === 'ArrowDown'
              ? (current + 1) % items.length
              : (current - 1 + items.length) % items.length
    items[next]?.focus()
  }

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

  /*
   * ISSUE-112 — the signed-in NAME is visible on the page itself, not only
   * inside the opened menu (ISSUE-089 put it there; the user asked for more).
   * The trigger greets by first name when the server sent one; the fail-closed
   * branch (no identity in the session response) falls back to the old label
   * rather than inventing one. firstName is data, not translatable prose —
   * the greeting template is the i18n string.
   */
  const triggerLabel = isSignedIn
    ? firstName !== null
      ? t('account.greeting', { name: firstName })
      : t('account.myAccount')
    : t('account.signInCta')

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
          {/*
           * Review finding (fifty-third pass): firstName has NO server-side
           * length cap (registrationForm.ts caps nothing beyond min(1)), so
           * the greeting must bound itself — truncate + max-width, the same
           * treatment the menu's identity block already applies. 10rem holds
           * every realistic name; a hostile one ellipsizes instead of
           * stretching the header row.
           */}
          <span className="hidden max-w-40 truncate lg:inline">{triggerLabel}</span>
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
          <div ref={menuRef} role="menu" aria-label={t('account.menuLabel')} onKeyDown={handleMenuKeyDown}>
          {isSignedIn ? (
            <>
              {/*
                MILESTONE-010 / DEC-088 O3 (ISSUE-111's first half, the
                user's own report: "as an admin I don't need a My-orders
                tab"). An ADMIN'S menu is the role's toolbox — manage
                orders + manage products — and the shopper entries are
                HIDDEN for the role, not merely de-emphasised.

                🔴 THE SPLIT IS UX, NOT SECURITY (the ISSUE-097 comment's
                rule stands): `isAdmin` comes from the session response
                (DEC-071) and only decides what is DRAWN. Every admin route
                re-reads User.role per request (DEC-065); a shopper who
                forges the markup gets a 403 on use, and a demoted admin's
                cached menu dies the same way.
              */}
              {isAdmin ? (
                <>
                  <Link
                    role="menuitem"
                    to="/admin/orders"
                    onClick={() => setOpen(false)}
                    className={`${FOCUS_RING} block rounded-compact px-3 py-2 text-sm text-text-ink hover:bg-surface-sunken`}
                  >
                    {t('account.adminOrders')}
                  </Link>
                  <Link
                    role="menuitem"
                    to="/admin/products"
                    onClick={() => setOpen(false)}
                    className={`${FOCUS_RING} block rounded-compact px-3 py-2 text-sm text-text-ink hover:bg-surface-sunken`}
                  >
                    {t('account.adminProducts')}
                  </Link>
                </>
              ) : (
                <>
                  <Link
                    role="menuitem"
                    /*
                     * 🔴 ISSUE-102 — THIS POINTED AT `/account`, WHICH HAS NO
                     * ROUTE; every signed-in shopper landed on the 404 page.
                     * Checkpoint G2 built `/account/orders`; the label says
                     * what exists (REQ-F-051's fuller area is still unbuilt).
                     */
                    to="/account/orders"
                    onClick={() => setOpen(false)}
                    className={`${FOCUS_RING} block rounded-compact px-3 py-2 text-sm text-text-ink hover:bg-surface-sunken`}
                  >
                    {t('account.myOrders')}
                  </Link>
                  {/* MILESTONE-012 Checkpoint B — linked the day it shipped. */}
                  <Link
                    role="menuitem"
                    to="/account/club"
                    onClick={() => setOpen(false)}
                    className={`${FOCUS_RING} block rounded-compact px-3 py-2 text-sm text-text-ink hover:bg-surface-sunken`}
                  >
                    {t('account.club')}
                  </Link>
                </>
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
