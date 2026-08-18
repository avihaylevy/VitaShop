import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Trans, useTranslation } from 'react-i18next'
import { Button } from '../components/ui/Button'
import { FOCUS_RING } from '../components/ui/focusRing'
import {
  createAdminProduct,
  requestAdminProductOptions,
  uploadAdminProductImage,
} from '../lib/adminProductsApi'
import { DOSAGE_FORM_KEYS } from '../lib/catalogApi'
import type {
  AdminProductDuplicate,
  AdminProductOptions,
  AdminProductRow,
} from '../types/adminProducts'

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

/**
 * The brand select's "new company" sentinel — never a real row id (uuid).
 * Picking it reveals the two new-brand fields; the payload then carries
 * newBrandName/newBrandNameEn INSTEAD of brandId (user report 2026-08-17:
 * a product from a company not yet in the DB was uncreatable).
 */
const NEW_BRAND_VALUE = '__new__'

const EMPTY_FORM = {
  nameHe: '',
  nameEn: '',
  categoryId: '',
  brandId: '',
  newBrandName: '',
  newBrandNameEn: '',
  dosageForm: 'CAPSULE',
  packageQuantity: '',
  usageInstructions: '',
  price: '',
  stockQuantity: '',
  descriptionHe: '',
  descriptionEn: '',
  warningsAllergens: '',
  imageUrl: '',
  // DEC-083 amended — tri-state dietary claims: '' = no claim (null),
  // 'true'/'false' = the admin's stated claim.
  isKosher: '',
  isGlutenFree: '',
  isVegan: '',
}

const DIETARY_KEYS = ['isKosher', 'isGlutenFree', 'isVegan'] as const

type OptionsState =
  | { status: 'loading' }
  | { status: 'ready'; options: AdminProductOptions }
  | { status: 'failed' }

export function AdminProductNewPage() {
  const { t, i18n } = useTranslation('admin')
  const [optionsState, setOptionsState] = useState<OptionsState>({ status: 'loading' })
  const [form, setForm] = useState(EMPTY_FORM)
  /** EXISTING goals ticked, by id. */
  const [goalIds, setGoalIds] = useState<string[]>([])
  /** NEW goals queued for this product — both names required (DEC-017). */
  const [newGoals, setNewGoals] = useState<{ nameHe: string; nameEn: string }[]>([])
  const [goalDraft, setGoalDraft] = useState({ nameHe: '', nameEn: '' })
  /** DEC-093 — the twin the server refused over; renders the override. */
  const [duplicateOf, setDuplicateOf] = useState<AdminProductDuplicate | null>(null)
  const [allowDuplicate, setAllowDuplicate] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  /** '' | uploading-text | uploaded-text — read by an ALWAYS-mounted status. */
  const [uploadStatus, setUploadStatus] = useState('')
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
    // 🔴 The override consents to ONE SPECIFIC twin (review finding):
    // editing anything that changes which product this IS — names or
    // brand — withdraws the consent, or a ticked "create anyway" would
    // silently override a DIFFERENT twin the admin never saw.
    if (key === 'nameHe' || key === 'nameEn' || key === 'brandId' || key === 'newBrandName') {
      setDuplicateOf(null)
      setAllowDuplicate(false)
    }
  }

  // i18next key-fallback answers "is this code known" (review finding: a
  // hand-kept list was a third copy of the vocabulary, and a code missing
  // from it silently degraded a specific message to the generic one).
  const codeMessage = (code: string) => t([`products.errors.${code}`, 'products.failure.server'])

  /**
   * Queue the drafted new goal. Shared by the add-button AND Enter inside
   * the draft inputs — review finding: Enter in a text input submits the
   * FORM, which would have created the product WITHOUT the goal the admin
   * was mid-typing.
   */
  function addDraftGoal() {
    const nameHe = goalDraft.nameHe.trim()
    const nameEn = goalDraft.nameEn.trim()
    if (nameHe === '' || nameEn === '') return
    setNewGoals((current) =>
      current.some(
        (goal) =>
          goal.nameHe.toLowerCase() === nameHe.toLowerCase() ||
          goal.nameEn.toLowerCase() === nameEn.toLowerCase(),
      )
        ? current
        : [...current, { nameHe, nameEn }],
    )
    setGoalDraft({ nameHe: '', nameEn: '' })
  }

  function addGoalOnEnter(event: React.KeyboardEvent) {
    if (event.key !== 'Enter') return
    event.preventDefault()
    addDraftGoal()
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    // 🔴 uploading blocks too (review finding): submitting mid-upload
    // created the product IMAGELESS, and with no PATCH imageUrl surface
    // the image was unattachable afterwards — a silent permanent loss.
    if (submitting || uploading) return
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
      // Exactly ONE brand shape travels (the server's superRefine rule):
      // an existing row's id, or the new company's name(s).
      ...(form.brandId === NEW_BRAND_VALUE
        ? {
            newBrandName: form.newBrandName,
            ...(form.newBrandNameEn.trim() === ''
              ? {}
              : { newBrandNameEn: form.newBrandNameEn.trim() }),
          }
        : { brandId: form.brandId }),
      dosageForm: form.dosageForm,
      packageQuantity: asNumber(form.packageQuantity),
      usageInstructions: form.usageInstructions,
      price: form.price,
      stockQuantity: asNumber(form.stockQuantity),
      descriptionHe: form.descriptionHe,
      descriptionEn: form.descriptionEn,
      warningsAllergens: form.warningsAllergens,
      // Tri-state claims: '' (no claim) is OMITTED — the column's null is
      // the server-side default, never a value this client invents.
      ...(form.isKosher === '' ? {} : { isKosher: form.isKosher === 'true' }),
      ...(form.isGlutenFree === '' ? {} : { isGlutenFree: form.isGlutenFree === 'true' }),
      ...(form.isVegan === '' ? {} : { isVegan: form.isVegan === 'true' }),
      ...(goalIds.length > 0 ? { healthGoalIds: goalIds } : {}),
      ...(newGoals.length > 0 ? { newHealthGoals: newGoals } : {}),
      // DEC-093 — sent only when the admin ticked the override after
      // seeing the twin; a fresh submit never carries it.
      ...(allowDuplicate ? { allowDuplicate: true } : {}),
      // DEC-089b — absent means the placeholder; an empty field is not a URL.
      ...(form.imageUrl.trim() === '' ? {} : { imageUrl: form.imageUrl.trim() }),
    })
    setSubmitting(false)

    if (!result.ok) {
      if (result.failure.kind === 'duplicate') {
        // DEC-093 — name the twin in the always-mounted alert and reveal
        // the override checkbox. The admin decides; the machine only
        // surfaced the collision.
        const twin = result.failure.duplicate
        setDuplicateOf(twin)
        setFailureText(
          [
            t('products.duplicate.message', {
              name: i18n.language === 'he' ? twin.nameHe : twin.nameEn,
              slug: twin.slug,
            }),
            ...(twin.isActive ? [] : [t('products.duplicate.inactiveHint')]),
          ].join(' '),
        )
        return
      }
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
    // A just-created company joins the picker so the NEXT product can pick
    // it without a reload (the server answers the resolved brand row).
    setOptionsState((current) =>
      current.status === 'ready' &&
      !current.options.brands.some((brand) => brand.id === result.product.brand.id)
        ? {
            status: 'ready',
            options: {
              ...current.options,
              brands: [...current.options.brands, result.product.brand],
            },
          }
        : current,
    )
    // New goals now exist server-side but the create DTO does not carry
    // them — re-fetch the pickers so the NEXT product can tick them.
    if (newGoals.length > 0) {
      void requestAdminProductOptions().then((options) => {
        if (options.ok) setOptionsState({ status: 'ready', options: options.options })
      })
    }
    setForm(EMPTY_FORM)
    setGoalIds([])
    setNewGoals([])
    setGoalDraft({ nameHe: '', nameEn: '' })
    setDuplicateOf(null)
    setAllowDuplicate(false)
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
                <option value={NEW_BRAND_VALUE}>{t('products.form.brandNew')}</option>
              </select>
            </FieldRow>
          </div>

          {/* The new-company fields — revealed by the admin's own pick, so
              this mount/unmount is user-driven, not an async success (the
              saveAddress-checkbox precedent). */}
          {form.brandId === NEW_BRAND_VALUE && (
            <div className="flex flex-wrap gap-4">
              <FieldRow
                id="np-brand-new-name"
                label={t('products.form.brandNewName')}
                className="min-w-48 flex-1"
              >
                <input
                  id="np-brand-new-name"
                  value={form.newBrandName}
                  onChange={(e) => set('newBrandName', e.target.value)}
                  className={inputClass}
                />
              </FieldRow>
              <FieldRow
                id="np-brand-new-name-en"
                label={t('products.form.brandNewNameEn')}
                hint={t('products.form.brandNewNameEnHint')}
                className="min-w-48 flex-1"
              >
                <input
                  id="np-brand-new-name-en"
                  value={form.newBrandNameEn}
                  onChange={(e) => set('newBrandNameEn', e.target.value)}
                  className={inputClass}
                  dir="ltr"
                />
              </FieldRow>
            </div>
          )}

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
          <FieldRow id="np-image-url" label={t('products.form.imageUrl')} hint={t('products.form.imageUrlHint')}>
            <input
              id="np-image-url"
              type="url"
              inputMode="url"
              value={form.imageUrl}
              onChange={(e) => set('imageUrl', e.target.value)}
              className={inputClass}
              dir="ltr"
            />
          </FieldRow>
          {/*
            DEC-089c — upload as the OTHER way to fill the same field: the
            picked file goes up immediately and the returned server path
            lands in the imageUrl input above, visible and editable. One
            downstream pipeline for both.

            🔴 A visible BUTTON drives it (the user's report: the bare
            native file input did not read as clickable). The input stays
            in the DOM, visually hidden but focusable-by-proxy: the button
            clicks it, so the browser's file picker and the change event
            are untouched.
          */}
          <FieldRow id="np-image-file" label={t('products.form.imageFile')} hint={t('products.form.imageFileHint')}>
            <Button
              type="button"
              variant="secondary"
              loading={uploading}
              onClick={() => document.getElementById('np-image-file')?.click()}
            >
              {uploading ? t('products.form.uploading') : t('products.form.imagePick')}
            </Button>
            <input
              id="np-image-file"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-busy={uploading || undefined}
              className="sr-only"
              tabIndex={-1}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (!file || uploading) return
                setUploading(true)
                setUploadStatus(t('products.form.uploading'))
                setFailureText('')
                void uploadAdminProductImage(file).then((result) => {
                  setUploading(false)
                  // The same input can pick again either way.
                  event.target.value = ''
                  if (result.ok) {
                    set('imageUrl', result.url)
                    // 🔴 Success is SAID (review finding: filling a
                    // different field silently left a screen-reader admin
                    // with no signal the upload finished).
                    setUploadStatus(t('products.form.uploaded'))
                    return
                  }
                  setUploadStatus('')
                  if (result.failure.kind === 'invalid') {
                    setFailureText(codeMessage(result.failure.code))
                  } else if (result.failure.kind === 'rateLimited') {
                    setFailureText(t('state.rateLimited'))
                  } else if (result.failure.kind === 'offline') {
                    setFailureText(t('state.offline'))
                  } else {
                    setFailureText(t('products.failure.server'))
                  }
                })
              }}
            />
          </FieldRow>
          {/* ALWAYS mounted — a live region that mounts with its message
              says nothing (the async-control family). */}
          <p role="status" aria-live="polite" className="text-xs text-text-muted">
            {uploadStatus}
          </p>
          <FieldRow id="np-warnings" label={t('products.form.warnings')} hint={t('products.form.warningsHint')}>
            <textarea
              id="np-warnings"
              value={form.warningsAllergens}
              onChange={(e) => set('warningsAllergens', e.target.value)}
              className={areaClass}
            />
          </FieldRow>

          {/* DEC-083 amended — the admin's tri-state dietary claims. "No
              claim" is the default and travels as NOTHING (null column). */}
          <fieldset className="flex flex-col gap-2">
            <legend className="text-text-ink">{t('products.form.dietary')}</legend>
            <p className="text-xs text-text-muted">{t('products.form.dietaryHint')}</p>
            <div className="flex flex-wrap gap-4">
              {DIETARY_KEYS.map((key) => (
                <FieldRow
                  key={key}
                  id={`np-${key}`}
                  label={t(`products.form.${key}`)}
                  className="min-w-40 flex-1"
                >
                  <select
                    id={`np-${key}`}
                    value={form[key]}
                    onChange={(e) => set(key, e.target.value)}
                    className={inputClass}
                  >
                    <option value="">{t('products.form.claimNone')}</option>
                    <option value="true">{t('products.form.claimYes')}</option>
                    <option value="false">{t('products.form.claimNo')}</option>
                  </select>
                </FieldRow>
              ))}
            </div>
          </fieldset>

          {/* Health goals — tick existing, and/or queue NEW bilingual
              goals (user decision 2026-08-17). Queued-goal removal is a
              user-driven control, not an async success unmount. */}
          <fieldset className="flex flex-col gap-2">
            <legend className="text-text-ink">{t('products.form.healthGoals')}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {optionsState.options.healthGoals.map((goal) => (
                <label key={goal.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className={FOCUS_RING}
                    checked={goalIds.includes(goal.id)}
                    onChange={(e) =>
                      setGoalIds((current) =>
                        e.target.checked
                          ? [...current, goal.id]
                          : current.filter((id) => id !== goal.id),
                      )
                    }
                  />
                  {i18n.language === 'he' ? goal.nameHe : goal.nameEn}
                </label>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <FieldRow
                id="np-goal-new-he"
                label={t('products.form.goalNewHe')}
                className="min-w-40 flex-1"
              >
                <input
                  id="np-goal-new-he"
                  value={goalDraft.nameHe}
                  onChange={(e) => setGoalDraft((d) => ({ ...d, nameHe: e.target.value }))}
                  onKeyDown={addGoalOnEnter}
                  className={inputClass}
                />
              </FieldRow>
              <FieldRow
                id="np-goal-new-en"
                label={t('products.form.goalNewEn')}
                className="min-w-40 flex-1"
              >
                <input
                  id="np-goal-new-en"
                  value={goalDraft.nameEn}
                  onChange={(e) => setGoalDraft((d) => ({ ...d, nameEn: e.target.value }))}
                  onKeyDown={addGoalOnEnter}
                  className={inputClass}
                  dir="ltr"
                />
              </FieldRow>
              <Button
                type="button"
                variant="secondary"
                aria-disabled={
                  goalDraft.nameHe.trim() === '' || goalDraft.nameEn.trim() === '' || undefined
                }
                onClick={addDraftGoal}
              >
                {t('products.form.goalAdd')}
              </Button>
            </div>
            <p className="text-xs text-text-muted">{t('products.form.goalNewHint')}</p>
            {newGoals.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {newGoals.map((goal) => (
                  <li
                    key={goal.nameEn}
                    className="flex items-center gap-2 rounded-card border border-border-control px-2 py-1"
                  >
                    <span>
                      {goal.nameHe} · <span dir="ltr">{goal.nameEn}</span>
                    </span>
                    <button
                      type="button"
                      className={`${FOCUS_RING} rounded-compact text-state-error`}
                      onClick={() =>
                        setNewGoals((current) => current.filter((g) => g.nameEn !== goal.nameEn))
                      }
                      aria-label={t('products.form.goalRemove', {
                        name: i18n.language === 'he' ? goal.nameHe : goal.nameEn,
                      })}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>

          {/* DEC-093 — the override, revealed only after a duplicate
              refusal (a user-driven reveal, like the new-brand fields).
              Unticked by default on every reveal: creating a twin must be
              an explicit choice, never a leftover. */}
          {duplicateOf !== null && (
            <label className="flex items-center gap-2 text-state-error">
              <input
                type="checkbox"
                className={FOCUS_RING}
                checked={allowDuplicate}
                onChange={(e) => setAllowDuplicate(e.target.checked)}
              />
              {t('products.duplicate.override')}
            </label>
          )}

          <Button
            type="submit"
            loading={submitting}
            aria-disabled={uploading || undefined}
            className="mt-2"
          >
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
