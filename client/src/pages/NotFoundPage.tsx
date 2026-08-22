import { useTranslation } from 'react-i18next'
import { TextLink } from '../components/ui/TextLink'
import { LinkButton } from '../components/ui/LinkButton'

/**
 * 🔴 ISSUE-066 — the catch-all. Added 2026-08-12.
 *
 * Before this, an unknown URL matched no route and `AppShell` rendered its
 * chrome (header; no site-wide footer exists) around NOTHING. A blank page is indistinguishable from a
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
        {/* The system's primary-CTA clothes, from ONE source (LinkButton
            draws Button's own VARIANT_CLASS) — this was a hand-copied,
            already-drifted class string (the recorded cousin cleanup). */}
        <LinkButton to="/catalog">{t('notFound.toCatalog')}</LinkButton>
        <TextLink to="/">
          {t('notFound.toHome')}
        </TextLink>
      </div>
    </div>
  )
}
