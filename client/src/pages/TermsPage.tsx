import { useTranslation } from 'react-i18next'

/**
 * The user's seventh list, item 3 — the terms-of-use + privacy page the
 * registration checkbox has claimed the user read since MILESTONE-006.
 *
 * The TEXT is agent-drafted generic student-project terms, user-authorized
 * (the /about invented-content precedent): it makes no real legal claims,
 * says plainly that the store is a course project and that payment is
 * simulated, and the privacy section describes only what the system
 * actually stores. Content changes are copy edits in the `info` namespace,
 * never code changes here.
 *
 * 🔴 Linked FROM the registration form the same pass it ships (the
 * ISSUE-097/102/104 family: a route nothing links to is staged, not
 * shipped).
 */
export function TermsPage() {
  const { t } = useTranslation('info')

  return (
    <div className="px-7 py-8">
      <div className="mx-auto max-w-2xl">
        <h1 className="heading-page">{t('terms.title')}</h1>
        <p className="mt-3 text-sm text-text-muted">{t('terms.updated')}</p>

        <div className="mt-6 flex flex-col gap-8">
          {/* Keyed by the section NUMBER, not the translated title (review
              finding): titles are copy, and copy must be free to change —
              or collide — without touching React identity. */}
          {[1, 2, 3, 4, 5, 6, 7].map((n) => (
            <section key={n}>
              <h2 className="heading-section">{t(`terms.s${n}Title`)}</h2>
              <p className="mt-2 text-base leading-relaxed text-text-ink">{t(`terms.s${n}Text`)}</p>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
