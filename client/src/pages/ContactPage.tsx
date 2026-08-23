import { useId, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Field, FormError } from '../components/auth/AuthLayout'
import { useInViewOnce } from '../hooks/useInViewOnce'
import { Button } from '../components/ui/Button'
import { FOCUS_RING } from '../components/ui/focusRing'
import contactHero from '../assets/brand/contact-hero.png'

/**
 * ISSUE-125 — the יצירת קשר page, REBUILT to the user's sketch
 * (2026-08-23): centred header → two cards (the form; the image with a
 * "here for you" list) → an FAQ strip. Still MOCK BY THE USER'S
 * INSTRUCTION: the form validates and submits NOWHERE — no email service,
 * no API key (DEC-014 untouched).
 *
 * The subject <select> is NATIVE, dressed like the Input siblings —
 * CatalogSortSelect's §10 reasoning: keyboard, screen-reader and mobile
 * behaviour for free. It has a default, so it cannot fail validation.
 *
 * The FAQ answers state only what the store actually does (cancel while
 * processing, checkout delivery estimate, manufacturer-published info) —
 * no invented service promises, same rule as ever. No invented contact
 * details either: the card's image is decorative artwork, not a phone
 * number.
 *
 * 🔴 The received-state contract (the unmount-takes-focus family) is
 * unchanged: submitting NEVER unmounts the form or the button — the
 * confirmation is an ALWAYS-mounted polite region above the fields, the
 * fields clear, and focus stays exactly where the user left it.
 */

const SUBJECT_KEYS = ['subjectProduct', 'subjectOrder', 'subjectSite', 'subjectOther'] as const
type SubjectKey = (typeof SUBJECT_KEYS)[number]

export function ContactPage() {
  const { t } = useTranslation('info')
  const formTitleId = useId()
  const sideTitleId = useId()
  const faqTitleId = useId()
  const subjectId = useId()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [subject, setSubject] = useState<SubjectKey>('subjectProduct')
  const [message, setMessage] = useState('')
  const [errors, setErrors] = useState<{ name?: string; email?: string; message?: string }>({})
  const [received, setReceived] = useState(false)
  const hasErrors = Object.keys(errors).length > 0

  const sideItems = [t('contact.side1'), t('contact.side2'), t('contact.side3')]
  const faqs = [
    { q: t('contact.faq1Q'), a: t('contact.faq1A') },
    { q: t('contact.faq2Q'), a: t('contact.faq2A') },
    { q: t('contact.faq3Q'), a: t('contact.faq3A') },
  ]

  // The FAQ entrance fires when the strip scrolls into view (the About
  // page's lesson: a mount-time entrance below the fold plays unseen).
  const [faqRef, faqInView] = useInViewOnce<HTMLUListElement>()

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const next: typeof errors = {}
    if (name.trim().length === 0) next.name = t('contact.errorRequired')
    if (email.trim().length === 0) next.email = t('contact.errorRequired')
    // Contact-ONLY shallow shape-check: the auth forms do no client-side
    // email validation (the server decides there), but this mock form HAS
    // no server, so the shallow check is its only guard. It says "this
    // does not look like an address", nothing stronger.
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) next.email = t('contact.errorEmail')
    if (message.trim().length === 0) next.message = t('contact.errorRequired')

    setErrors(next)
    if (Object.keys(next).length > 0) {
      setReceived(false)
      return
    }

    // 🔴 MOCK: nothing is sent anywhere, by instruction.
    // flushSync empties the status region in its OWN commit first: a live
    // region announces on TEXT CHANGE, and a second successful submit
    // re-setting `true` over `true` would render byte-identical text —
    // silence (review of this diff; the class AdminOrdersPage's tests
    // document). Clearing-then-setting produces a change every time.
    flushSync(() => setReceived(false))
    setReceived(true)
    setName('')
    setEmail('')
    setSubject('subjectProduct')
    setMessage('')
  }

  return (
    <div className="px-7 py-8">
      <div className="mx-auto max-w-4xl">
        {/* The centred header band. */}
        <h1 className="heading-page text-center">
          {t('contact.title')}
        </h1>
        <p className="mt-2 text-center text-base text-text-muted">{t('contact.intro')}</p>
        <p className="text-center text-base text-text-muted">{t('contact.introLine2')}</p>

        {/* Two cards. DOM order form → info card: the form is the page's
            purpose, so it reads first — landing on the START side (right
            in Hebrew, left in English; the sketch's arrangement is its
            RTL rendering). */}
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <section
            aria-labelledby={formTitleId}
            className="rounded-card border border-border-card bg-well p-6"
          >
            <h2 id={formTitleId} className="heading-section">
              {t('contact.formTitle')}
            </h2>

            {/* Always mounted — announces the received state politely
                without interrupting, and never appears at the same moment
                as its text. */}
            <p role="status" className="mt-2 min-h-[1.25rem] text-sm font-medium text-brand-teal">
              {received ? t('contact.received') : ''}
            </p>

            <form onSubmit={onSubmit} noValidate>
              <Field
                label={t('contact.nameLabel')}
                autoComplete="name"
                value={name}
                onChange={setName}
                error={errors.name}
              />
              <Field
                label={t('contact.emailLabel')}
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={setEmail}
                error={errors.email}
              />

              <div className="mt-4">
                <label htmlFor={subjectId} className="block text-sm font-medium text-text-ink">
                  {t('contact.subjectLabel')}
                </label>
                <select
                  id={subjectId}
                  value={subject}
                  onChange={(event) => setSubject(event.target.value as SubjectKey)}
                  // bg/text set explicitly — native selects on Windows dark
                  // mode otherwise paint their own colours (guidelines).
                  className={`${FOCUS_RING} mt-1 h-11 w-full cursor-pointer rounded-card border border-border-control bg-well px-3 text-base text-text-ink`}
                >
                  {SUBJECT_KEYS.map((key) => (
                    <option key={key} value={key}>
                      {t(`contact.${key}`)}
                    </option>
                  ))}
                </select>
              </div>

              <Field
                label={t('contact.messageLabel')}
                value={message}
                onChange={setMessage}
                error={errors.message}
                multiline
              />

              {/* The auth forms' assertive form-level region — a failed
                  submit re-renders in place with no focus change, so
                  without this a screen-reader user is told NOTHING. */}
              <FormError message={hasErrors ? t('contact.errorSummary') : undefined} />

              <Button type="submit" variant="primary" className="mt-4 w-full">
                {t('contact.submit')}
              </Button>
            </form>
          </section>

          <section
            aria-labelledby={sideTitleId}
            className="flex h-full flex-col overflow-hidden rounded-card border border-border-card bg-surface-section"
          >
            {/* Decorative brand artwork — no contact details baked in. */}
            {/* flex-1: the image absorbs the height difference so both
                cards stand equal; object-cover keeps the crop honest. */}
            <img src={contactHero} alt="" className="min-h-0 w-full flex-1 object-cover" />
            <div className="p-6">
              <h2 id={sideTitleId} className="heading-section">
                {t('contact.sideTitle')}
              </h2>
              <ul className="mt-4 flex flex-col gap-3">
                {sideItems.map((item) => (
                  <li key={item} className="flex items-center gap-3 text-base text-text-ink">
                    {/* The sketch's ◉ bullet, drawn in the system: a teal
                        ring dot, decorative. */}
                    <span
                      aria-hidden="true"
                      className="size-2.5 shrink-0 rounded-full border-2 border-brand-teal"
                    />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>

        {/* The FAQ strip — real answers only: each one states something the
            store actually does today. */}
        <section aria-labelledby={faqTitleId} className="mt-12">
          <h2 id={faqTitleId} className="heading-section text-center">
            {t('contact.faqTitle')}
          </h2>
          <ul ref={faqRef} className="mt-4 grid gap-3 sm:grid-cols-3">
            {faqs.map((faq, index) => (
              <li
                key={faq.q}
                className={`rounded-card border border-border-card bg-surface-section p-4 ${
                  faqInView ? 'motion-safe:animate-[faq-card-settle_.45s_ease-out_both]' : ''
                }`}
                style={faqInView ? { animationDelay: `${index * 110}ms` } : undefined}
              >
                <h3 className="text-base font-semibold text-text-ink">{faq.q}</h3>
                <p className="mt-1 text-sm text-text-muted">{faq.a}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
