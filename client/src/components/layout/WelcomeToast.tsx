import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useSession } from '../../state/SessionContext'

/**
 * ISSUE-112, second half — the transient welcome the user chose (toast near
 * the header, auto-dismissing). Fires only when SessionContext saw a real
 * sign-in turn the session authenticated; page-load hydration never shows it.
 *
 * 🔴 Deliberately NON-INTERACTIVE — no close button. A dismiss control would
 * unmount itself on use and drop keyboard focus to <body>: the
 * unmount-takes-focus family (.claude/rules/browser-verification.md) that
 * has shipped three times in this project. A six-second status message does
 * not need a control; it needs to leave on its own.
 *
 * The role="status" wrapper is ALWAYS mounted, so the announcement comes
 * from a region that already existed — the live-region rule from the same
 * file. Entrance motion is motion-safe-gated; under prefers-reduced-motion
 * the toast simply appears and disappears.
 */
export function WelcomeToast() {
  const { welcomeName, dismissWelcome } = useSession()
  const { t } = useTranslation('layout')

  useEffect(() => {
    if (welcomeName === null) return
    const timer = window.setTimeout(dismissWelcome, 6000)
    return () => window.clearTimeout(timer)
  }, [welcomeName, dismissWelcome])

  return (
    // top-32 (128px): the visible header's bottom edge measures 113-114px
    // at every width (review finding — top-20 overlapped the nav row), so
    // the toast clears it with a small gap at both breakpoints.
    <div role="status" className="pointer-events-none fixed inset-x-0 top-32 z-[var(--z-dropdown)] flex justify-center px-4">
      {welcomeName !== null && (
        <p className="rounded-card border border-border-hairline bg-well px-4 py-2 text-sm font-medium text-text-ink shadow-[0_8px_24px_rgba(31,37,46,0.12)] motion-safe:animate-[welcome-toast-in_200ms_var(--ease-standard)]">
          {t('welcome.message', { name: welcomeName })}
        </p>
      )}
    </div>
  )
}
