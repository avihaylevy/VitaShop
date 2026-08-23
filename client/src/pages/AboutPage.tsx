import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { LinkButton } from '../components/ui/LinkButton'
import { useInViewOnce } from '../hooks/useInViewOnce'
import aboutHero from '../assets/brand/about-hero.png'

/**
 * ISSUE-119 — the אודות page, REBUILT to the user's hierarchy (2026-08-23):
 * hero image → title + one-line intro → "why" (two story paragraphs) →
 * values cards → a numbered three-step strip → a statement band between
 * hairlines → closing CTA. The store STORY remains invented and
 * user-authorized; still no medical claims and no service promises the
 * mock store cannot keep.
 *
 * The hero is the user's supplied brand artwork (about-hero.png). Its only
 * baked-in text is the Latin-only wordmark — the recorded wordmark posture,
 * so ONE image serves both languages. Decorative (`alt=""`): the h1 below
 * carries the page's name for assistive tech.
 *
 * 🔴 NO category tones here (unchanged rule): §1 binds tone to Category —
 * on a page where nothing is a category a tone is decoration, which
 * DEC-020 constraint 3 forbids. Cards sit on the neutral section surface.
 *
 * The step numbers (01/02/03) are earned, not decorative: the sequence IS
 * the content — discover, then understand, then choose.
 */
export function AboutPage() {
  const { t } = useTranslation('info')
  const valuesHeadingId = useId()
  const howHeadingId = useId()
  const readyHeadingId = useId()

  const values = [
    { title: t('about.value1Title'), text: t('about.value1Text') },
    { title: t('about.value2Title'), text: t('about.value2Text') },
    { title: t('about.value3Title'), text: t('about.value3Text') },
  ]

  const steps = [t('about.step1'), t('about.step2'), t('about.step3')]

  // The entrance fires when the card grid SCROLLS INTO VIEW, not at mount:
  // the cards sit below the fold, and a mount-time animation was over
  // before anyone saw it (measured — this page's "animation doesn't work").
  const [cardsRef, cardsInView] = useInViewOnce<HTMLUListElement>()

  return (
    <div className="px-7 py-8">
      <div className="mx-auto max-w-2xl">
        {/* max-h + cover: the artwork is a wide band, not a poster — cap its
            height so the page's content starts inside the first viewport. */}
        <img src={aboutHero} alt="" className="max-h-52 w-full rounded-card object-cover" />

        <h1 className="heading-page mt-6 text-center">{t('about.title')}</h1>
        <p className="mt-2 text-center text-base text-text-muted">{t('about.intro')}</p>

        <section aria-labelledby={`${valuesHeadingId}-why`} className="mt-8">
          <h2 id={`${valuesHeadingId}-why`} className="heading-section text-center">
            {t('about.whyTitle')}
          </h2>
          <div className="mt-4 flex flex-col gap-4 text-base leading-relaxed text-text-ink">
            <p>{t('about.story1')}</p>
            <p>{t('about.story2')}</p>
          </div>
        </section>

        <section aria-labelledby={valuesHeadingId} className="mt-8">
          <h2 id={valuesHeadingId} className="heading-section text-center">
            {t('about.valuesTitle')}
          </h2>
          {/* Staggered entrance when the grid ENTERS THE VIEWPORT — the
              page's one authored moment. The animation class is applied
              only on visibility; the default state is fully visible, so a
              browser without IntersectionObserver (or JS at all) shows the
              cards plainly. No hover lift on purpose: these cards are not
              links, and a lift would promise a click. */}
          <ul ref={cardsRef} className="mt-4 grid gap-3 sm:grid-cols-3">
            {values.map((value, index) => (
              <li
                key={value.title}
                className={`rounded-card border border-border-card bg-surface-section p-4 ${
                  cardsInView ? 'motion-safe:animate-[about-card-rise_.5s_ease-out_both]' : ''
                }`}
                style={cardsInView ? { animationDelay: `${index * 110}ms` } : undefined}
              >
                <h3 className="text-base font-semibold text-text-ink">{value.title}</h3>
                <p className="mt-1 text-sm text-text-muted">{value.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby={howHeadingId} className="mt-8">
          <h2 id={howHeadingId} className="heading-section text-center">
            {t('about.howTitle')}
          </h2>
          {/* An ORDERED list — the numbers are the point. tabular-nums keeps
              01/02/03 equal-width; dir="ltr" on the digits only. */}
          <ol className="mt-6 grid grid-cols-3 gap-3 text-center">
            {steps.map((step, index) => (
              <li key={step}>
                <span dir="ltr" aria-hidden="true" className="block font-display text-2xl tabular-nums text-text-muted">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="mt-1 block text-base font-semibold text-text-ink">{step}</span>
              </li>
            ))}
          </ol>
        </section>

        {/* The statement band — display type between two hairlines. A visual
            beat, not a landmark: no heading role, plain paragraphs. */}
        <div className="mt-8 border-y border-border-hairline py-6 text-center">
          <p className="font-display text-2xl text-text-ink">{t('about.statementLine1')}</p>
          <p className="mt-1 font-display text-2xl text-text-ink">{t('about.statementLine2')}</p>
        </div>

        <section aria-labelledby={readyHeadingId} className="mt-8 text-center">
          <h2 id={readyHeadingId} className="heading-section">
            {t('about.readyTitle')}
          </h2>
          <div className="mt-4">
            <LinkButton to="/catalog" size="hero">
              {t('about.cta')}
            </LinkButton>
          </div>
        </section>
      </div>
    </div>
  )
}
