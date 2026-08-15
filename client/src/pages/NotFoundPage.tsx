import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { FOCUS_RING } from '../components/ui/focusRing'

/**
 * 🔴 ISSUE-066 — the catch-all. Added 2026-08-12.
 *
 * Before this, an unknown URL matched no route and `AppShell` rendered its
 * header and footer around NOTHING. A blank page is indistinguishable from a
 * page that failed to load, so a shopper who mistypes a URL — or follows a
 * stale link — cannot tell a wrong address from a broken store.
 *
 * ⚠️ This is wanted REGARDLESS of what the navigation becomes later. The three
 * dead nav tabs that exposed the gap are gone, but the gap was never about
 * them: any unknown path reached it.
 *
 * 🔴 No `<main>` here — `AppShell` already supplies the one main landmark, and
 * a second would break the single-landmark structure every other page relies on.
 *
 * The heading is an `h1` because this IS the page's title, and every other
 * route follows the same rule. Nothing here is a dead end: the two links are
 * the store's two real destinations.
 */
export function NotFoundPage() {
  const { t } = useTranslation('common')

  return (
    <div className="px-7 py-8">
      {/*
        `role="alert"` is deliberately NOT used. A 404 is a destination, not an
        event interrupting the shopper — it is announced by the page's heading
        and title like any other navigation.
      */}
      <h1 className="heading-page">{t('notFound.title')}</h1>
      <p className="mt-3 max-w-prose text-sm text-text-muted">{t('notFound.message')}</p>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Link
          to="/catalog"
          className={`${FOCUS_RING} inline-flex min-h-11 items-center rounded-card bg-brand-teal px-4 text-sm font-medium text-white transition-colors duration-150 ease-standard hover:bg-brand-teal-strong`}
        >
          {t('notFound.toCatalog')}
        </Link>
        <Link
          to="/"
          className={`${FOCUS_RING} inline-flex min-h-11 items-center rounded-compact text-sm font-medium text-brand-teal underline`}
        >
          {t('notFound.toHome')}
        </Link>
      </div>
    </div>
  )
}
