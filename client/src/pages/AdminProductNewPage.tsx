import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Trans, useTranslation } from 'react-i18next'
import { Button } from '../components/ui/Button'
import { FOCUS_RING } from '../components/ui/focusRing'
import { createAdminProduct, requestAdminProductOptions } from '../lib/adminProductsApi'
import { DOSAGE_FORM_KEYS } from '../lib/catalogApi'
import type { AdminProductOptions, AdminProductRow } from '../types/adminProducts'

/**
 * MILESTONE-010 Checkpoint C / DEC-088 O2 — the create form. No image
 * (ISSUE-008 owns that story; the shop renders its placeholder), category
 * and brand from EXISTING rows, the slug derived server-side from nameEn
 * and shown back on success (O4 — the admin should see the identity the
 * server chose).
 *
 * 🔴 Client checks are DISPLAY ONLY; `adminProductForm.ts` decides (§3.4).
 * 🔴 The submit button survives its own success (the async-control
 * family); the confirmation renders in an always-mounted status region and
 * the form RESETS for the next product rather than unmounting.
 */

const EMPTY_FORM = {
  nameHe: '',
  nameEn: '',
  categoryId: '',
  brandId: '',
  dosageForm: 'CAPSULE',
  packageQuantity: '',
  usageInstructions: '',
  price: '',
  stockQuantity: '',
  descriptionHe: '',
  descriptionEn: '',
  warningsAllergens: '',
}

type OptionsState =
  | { status: 'loading' }
  | { status: 'ready'; options: AdminProductOptions }
  | { status: 'failed' }

export function AdminProductNewPage() {
  const { t, i18n } = useTranslation('admin')
  const [optionsState, setOptionsState] = useState<OptionsState>({ status: 'loading' })
  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [failureText, setFailureText] = useState('')
  const [created, setCreated] = useState<{ product: AdminProductRow; id: number } | null>(null)

  useEffect(() => {
    // A staleness flag, honestly named (review finding: an AbortController
    // here never reached the fetch — it LOOKED like request cancellation
    // while only gating the setState).
    let cancelled = false
    void (async () => {
      const result = await requestAdminProductOptions()
      if (cancelled) return
      setOptionsState(result.ok ? { status: 'ready', options: result.options } : { status: 'failed' })
    })()
    return () => {
      cancelled = true
    }
  }, [])

  function set<K extends keyof typeof EMPTY_FORM>(key: K, value: string) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  // i18next key-fallback answers "is this code known" (review finding: a
  // hand-kept list was a third copy of the vocabulary, and a code missing
  // from it silently degraded a specific message to the generic one).
  const codeMessage = (code: string) => t([`products.errors.${code}`, 'products.failure.server'])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setFailureText('')

    /*
     * 🔴 A BLANK numeric field travels as null (JSON has no NaN), which
     * the server refuses BY NAME — review finding: `Number('')` is 0, and
     * a blank "Initial stock" silently created an out-of-stock product
     * while every sibling field refused blank loudly.
     */
    const asNumber = (raw: string) => (raw.trim() === '' ? Number.NaN : Number(raw))

    const result = await createAdminProduct({
      nameHe: form.nameHe,
      nameEn: form.nameEn,
      categoryId: form.categoryId,
      brandId: form.brandId,
      dosageForm: form.dosageForm,
      packageQuantity: asNumber(form.packageQuantity),
      usageInstructions: form.usageInstructions,
      price: form.price,
      stockQuantity: asNumber(form.stockQuantity),
      descriptionHe: form.descriptionHe,
      descriptionEn: form.descriptionEn,
      warningsAllergens: form.warningsAllergens,
    })
    setSubmitting(false)

    if (!result.ok) {
      if (result.failure.kind === 'invalid') {
        // ALL codes, not codes[0] (review finding): one response already
        // names every problem; surfacing one at a time costs the admin a
        // round-trip per field.
        setFailureText(
          result.failure.codes.length > 0
            ? result.failure.codes.map(codeMessage).join(' ')
            : t('products.failure.server'),
        )
      } else if (result.failure.kind === 'notAdmin') {
        setFailureText(t('state.notAdmin'))
      } else if (result.failure.kind === 'unauthenticated') {
        setFailureText(t('state.unauthenticated'))
      } else if (result.failure.kind === 'rateLimited') {
        setFailureText(t('state.rateLimited'))
      } else if (result.failure.kind === 'offline') {
        setFailureText(t('state.offline'))
      } else {
        setFailureText(t('products.failure.server'))
      }
      return
    }

    // Success: announced (keyed, re-announces on repeat), form cleared for
    // the next product — the form itself never unmounts.
    setCreated((previous) => ({ product: result.product, id: (previous?.id ?? 0) + 1 }))
    setForm(EMPTY_FORM)
  }

  const inputClass = `${FOCUS_RING} h-11 rounded-card border border-border-control bg-well px-3`
  const areaClass = `${FOCUS_RING} min-h-24 rounded-card border border-border-control bg-well px-3 py-2`

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <h1 className="heading-page">{t('products.newTitle')}</h1>
      <p className="mt-2 text-sm text-text-muted">{t('products.newIntro')}</p>

      {/* Always-mounted outcome regions. The SLUG is bidi-isolated (review
          finding: a Latin hyphenated token at the end of an RTL sentence
          can reorder — and this screen's whole purpose per DEC-088 O4 is
          showing the identity the server chose, exactly). */}
      <p role="status" aria-live="polite" className="mt-3 text-sm text-brand-teal">
        {created ? (
          <Trans
            i18nKey="products.createdAs"
            t={t}
            values={{
              name: i18n.language === 'he' ? created.product.nameHe : created.product.nameEn,
              slug: created.product.slug,
            }}
            components={{ slugSpan: <span dir="ltr" style={{ unicodeBidi: 'isolate' }} /> }}
          />
        ) : (
          ''
        )}
      </p>
      <p role="alert" className="mt-1 text-sm text-state-error">
        {failureText}
      </p>

      {optionsState.status === 'loading' && (
        <p className="mt-6 text-text-muted">{t('products.loading')}</p>
      )}
      {optionsState.status === 'failed' && (
        <p className="mt-6 text-text-ink">{t('products.failure.optionsUnavailable')}</p>
      )}

      {optionsState.status === 'ready' && (
        <form onSubmit={onSubmit} noValidate className="mt-6 flex flex-col gap-4 text-sm">
          <FieldRow id="np-name-he" label={t('products.form.nameHe')}>
            <input
              id="np-name-he"
              value={form.nameHe}
              onChange={(e) => set('nameHe', e.target.value)}
              className={inputClass}
            />
          </FieldRow>
          <FieldRow id="np-name-en" label={t('products.form.nameEn')} hint={t('products.form.nameEnHint')}>
            <input
              id="np-name-en"
              value={form.nameEn}
              onChange={(e) => set('nameEn', e.target.value)}
              className={inputClass}
              dir="ltr"
            />
          </FieldRow>

          <div className="flex flex-wrap gap-4">
            <FieldRow id="np-category" label={t('products.form.category')} className="min-w-48 flex-1">
              <select
                id="np-category"
                value={form.categoryId}
                onChange={(e) => set('categoryId', e.target.value)}
                className={inputClass}
              >
                <option value="">{t('products.form.pick')}</option>
                {optionsState.options.categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.nameHe}
                  </option>
                ))}
              </select>
            </FieldRow>
            <FieldRow id="np-brand" label={t('products.form.brand')} className="min-w-48 flex-1">
              <select
                id="np-brand"
                value={form.brandId}
                onChange={(e) => set('brandId', e.target.value)}
                className={inputClass}
              >
                <option value="">{t('products.form.pick')}</option>
                {optionsState.options.brands.map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.nameEn ?? brand.name}
                  </option>
                ))}
              </select>
            </FieldRow>
          </div>

          <div className="flex flex-wrap gap-4">
            <FieldRow id="np-dosage" label={t('products.form.dosageForm')} className="min-w-40 flex-1">
              <select
                id="np-dosage"
                value={form.dosageForm}
                onChange={(e) => set('dosageForm', e.target.value)}
                className={inputClass}
              >
                {DOSAGE_FORM_KEYS.map((formName) => (
                  <option key={formName} value={formName}>
                    {t(`products.dosage.${formName}`)}
                  </option>
                ))}
              </select>
            </FieldRow>
            <FieldRow id="np-package" label={t('products.form.packageQuantity')} className="min-w-40 flex-1">
              <input
                id="np-package"
                inputMode="numeric"
                value={form.packageQuantity}
                onChange={(e) => set('packageQuantity', e.target.value)}
                className={inputClass}
                dir="ltr"
              />
            </FieldRow>
          </div>

          <div className="flex flex-wrap gap-4">
            <FieldRow id="np-price" label={t('products.form.price')} hint={t('products.form.priceHint')} className="min-w-40 flex-1">
              <input
                id="np-price"
                inputMode="decimal"
                value={form.price}
                onChange={(e) => set('price', e.target.value)}
                className={inputClass}
                dir="ltr"
              />
            </FieldRow>
            <FieldRow id="np-stock" label={t('products.form.stock')} className="min-w-40 flex-1">
              <input
                id="np-stock"
                inputMode="numeric"
                value={form.stockQuantity}
                onChange={(e) => set('stockQuantity', e.target.value)}
                className={inputClass}
                dir="ltr"
              />
            </FieldRow>
          </div>

          <FieldRow id="np-usage" label={t('products.form.usage')}>
            <textarea
              id="np-usage"
              value={form.usageInstructions}
              onChange={(e) => set('usageInstructions', e.target.value)}
              className={areaClass}
            />
          </FieldRow>
          <FieldRow id="np-desc-he" label={t('products.form.descriptionHe')}>
            <textarea
              id="np-desc-he"
              value={form.descriptionHe}
              onChange={(e) => set('descriptionHe', e.target.value)}
              className={areaClass}
            />
          </FieldRow>
          <FieldRow id="np-desc-en" label={t('products.form.descriptionEn')}>
            <textarea
              id="np-desc-en"
              value={form.descriptionEn}
              onChange={(e) => set('descriptionEn', e.target.value)}
              className={areaClass}
              dir="ltr"
            />
          </FieldRow>
          <FieldRow id="np-warnings" label={t('products.form.warnings')} hint={t('products.form.warningsHint')}>
            <textarea
              id="np-warnings"
              value={form.warningsAllergens}
              onChange={(e) => set('warningsAllergens', e.target.value)}
              className={areaClass}
            />
          </FieldRow>

          <Button type="submit" loading={submitting} className="mt-2">
            {submitting ? t('products.form.submitting') : t('products.form.submit')}
          </Button>
        </form>
      )}

      <p className="mt-6 text-sm">
        <Link to="/admin/products" className={`${FOCUS_RING} rounded-compact text-brand-teal underline`}>
          {t('products.backToList')}
        </Link>
      </p>
    </main>
  )
}

function FieldRow({
  id,
  label,
  hint,
  className,
  children,
}: {
  id: string
  label: string
  hint?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`flex flex-col gap-1 ${className ?? ''}`}>
      <label htmlFor={id} className="text-text-ink">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-text-muted">{hint}</p>}
    </div>
  )
}
