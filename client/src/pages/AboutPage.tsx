import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { LinkButton } from '../components/ui/LinkButton'

/**
 * ISSUE-119 — the אודות page. The store STORY is invented, and that is
 * user-authorized (their explicit answer: an invented store story for the
 * course project; supersedes DEC-075's אודות deferral). What is NOT
 * invented: no medical claims, no service promises the mock store cannot
 * keep — the copy sticks to positioning ("transparency first") and to
 * facts that are true of the catalogue (manufacturer-published info,
 * goal filters). No photography — DEC-032/user answer: existing assets
 * and drawn shapes only; this page carries its warmth through the tone
 * cards and type.
 */
export function AboutPage() {
  const { t } = useTranslation('info')
  const valuesHeadingId = useId()

  // 🔴 NO category tones here (review of this diff): §1 binds tone to
  // Category — on a page where nothing is a category, a tone is exactly
  // the decoration DEC-020 constraint 3 forbids, and it would teach the
  // shopper a false colour code. The cards sit on the neutral section
  // surface; the warmth is the type's job.
  const values = [
    { title: t('about.value1Title'), text: t('about.value1Text') },
    { title: t('about.value2Title'), text: t('about.value2Text') },
    { title: t('about.value3Title'), text: t('about.value3Text') },
  ]

  return (
    <div className="px-7 py-8">
      <div className="mx-auto max-w-2xl">
        <h1 className="heading-page">{t('about.title')}</h1>

        <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-text-ink">
          <p>{t('about.story1')}</p>
          <p>{t('about.story2')}</p>
          <p>{t('about.story3')}</p>
        </div>

        <section aria-labelledby={valuesHeadingId} className="mt-10">
          <h2 id={valuesHeadingId} className="heading-section">
            {t('about.valuesTitle')}
          </h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-3">
            {values.map((value) => (
              <li key={value.title} className="rounded-card border border-border-card bg-surface-section p-4">
                <h3 className="text-base font-semibold text-text-ink">{value.title}</h3>
                <p className="mt-1 text-sm text-text-muted">{value.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <div className="mt-10">
          <LinkButton to="/catalog" size="hero">
            {t('about.cta')}
          </LinkButton>
        </div>
      </div>
    </div>
  )
}
