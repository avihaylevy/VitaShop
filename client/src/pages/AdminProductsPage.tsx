import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/ui/Button'
import { FOCUS_RING } from '../components/ui/focusRing'
import { Pager } from '../components/ui/Pager'
import { PriceBlock } from '../components/catalog/PriceBlock'
import {
  patchAdminProduct,
  requestAdminProducts,
  setAdminProductActive,
} from '../lib/adminProductsApi'
import { normalizePriceInput } from '../lib/adminPrice'
import { DOSAGE_FORM_KEYS } from '../lib/catalogApi'
import type {
  AdminProductRow,
  AdminProductsFailure,
  AdminProductsPage,
} from '../types/adminProducts'

/**
 * MILESTONE-010 / DEC-088 — the product-admin screen. ISSUE-111's tools:
 * stock updates, price updates, the INV-03 activation toggle, and the way
 * into the create form. DELIBERATELY PLAIN (brief answer 12): one table,
 * the shared primitives, no new design vocabulary.
 *
 * 🔴 THE ASYNC-CONTROL FAMILY RULES (browser-verification.md), applied on
 * arrival: every save/toggle button STAYS MOUNTED through its own success
 * (same button, state-driven label); in-flight presses are ignored via a
 * per-row busy guard; outcomes are announced from a role=status region
 * that is ALWAYS MOUNTED; failures from an always-mounted role=alert.
 *
 * 🔴 INACTIVE ROWS ARE SHOWN, struck and labelled — this list is the ONE
 * surface where a soft-deleted product remains visible (INV-03's audit
 * trail), and hiding them would orphan the reactivation control.
 *
 * ⚠️ DEC-088 O1 stands: a dev re-seed converges these values back to the
 * CSV. Edits here are the live-DB truth between deliberate resets.
 */

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; page: AdminProductsPage }
  | { status: 'failed'; failure: AdminProductsFailure }

type Draft = { price: string; stock: string }

/**
 * ISSUE-153 — the full-edit drawer row. Exactly the PATCH route's editable
 * vocabulary (adminProductForm.ts): names, descriptions, usage, warnings,
 * package quantity, the three dietary claims, and (ISSUE-158) the dosage
 * form. category/brand/slug are NOT patchable — deliberately absent
 * (identity, not facts).
 */
type DetailDraft = {
  nameHe: string
  nameEn: string
  dosageForm: string
  descriptionHe: string
  descriptionEn: string
  usageInstructions: string
  warningsAllergens: string
  packageQuantity: string
  isKosher: '' | 'true' | 'false'
  isGlutenFree: '' | 'true' | 'false'
  isVegan: '' | 'true' | 'false'
}

const DETAIL_DIETARY_KEYS = ['isKosher', 'isGlutenFree', 'isVegan'] as const

function claimValue(claim: boolean | null): '' | 'true' | 'false' {
  return claim === null ? '' : claim ? 'true' : 'false'
}

export function AdminProductsPage() {
  const { t, i18n } = useTranslation('admin')
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [pageNumber, setPageNumber] = useState(1)
  const [query, setQuery] = useState('')
  /**
   * 🔴 The SUBMITTED search, separate from the box's text (review finding):
   * the effect keyed on the live `query` leaked half-typed text into every
   * pager/filter request. Only Search's submit promotes the text here.
   */
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  /** Per-row edit drafts. Absent = untouched, so the row shows the server value. */
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  /** ISSUE-153 — which row's full editor is open, and its drafts. */
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailDrafts, setDetailDrafts] = useState<Record<string, DetailDraft>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  /** Keyed announcements so repeat outcomes re-announce (the ClubPage pattern). */
  const [announced, setAnnounced] = useState<{ text: string; id: number } | null>(null)
  const [failureText, setFailureText] = useState('')

  const requestId = useRef(0)

  const load = useCallback(
    async (page: number, q: string, status: 'all' | 'active' | 'inactive') => {
      const id = ++requestId.current
      setState({ status: 'loading' })
      const result = await requestAdminProducts({
        page,
        ...(q.trim() === '' ? {} : { q: q.trim() }),
        ...(status === 'all' ? {} : { status }),
      })
      if (id !== requestId.current) return
      if (result.ok) {
        setState({ status: 'ready', page: result.page })
        // Server truth replaces every draft — a stale draft over a fresh
        // row would look like an unsaved edit that never happened.
        setDrafts({})
        setDetailDrafts({})
      } else {
        setState({ status: 'failed', failure: result.failure })
      }
    },
    [],
  )

  useEffect(() => {
    // One effect, one fetch: submit batches setSubmittedQuery+setPageNumber
    // into a single re-run (review finding: the submit handler ALSO called
    // load directly, double-fetching when searching from page 2+).
    void load(pageNumber, submittedQuery, statusFilter)
  }, [load, pageNumber, submittedQuery, statusFilter])

  function onSearch(event: FormEvent) {
    event.preventDefault()
    setSubmittedQuery(query)
    setPageNumber(1)
  }

  /** ONE initializer (review finding: two copies of it could drift). */
  function initialDraft(row: AdminProductRow): Draft {
    return { price: row.price, stock: String(row.stockQuantity) }
  }

  function draftFor(row: AdminProductRow): Draft {
    return drafts[row.id] ?? initialDraft(row)
  }

  function setDraft(rowId: string, patch: Partial<Draft>, row: AdminProductRow) {
    setDrafts((current) => ({
      ...current,
      [rowId]: { ...(current[rowId] ?? initialDraft(row)), ...patch },
    }))
  }

  /** The same language pick as the visible cell — announcements and sr-only
   *  labels must not name a product in a script the UI's reader may not
   *  read (review finding: nameHe was hardwired everywhere). */
  const rowName = (row: AdminProductRow) => (language === 'he' ? row.nameHe : row.nameEn)

  function announce(text: string) {
    setAnnounced((previous) => ({ text, id: (previous?.id ?? 0) + 1 }))
    setFailureText('')
  }

  function replaceRow(product: AdminProductRow, options: { keepDraft?: boolean } = {}) {
    setState((current) =>
      current.status === 'ready'
        ? {
            status: 'ready',
            page: {
              ...current.page,
              products: current.page.products.map((p) => (p.id === product.id ? product : p)),
            },
          }
        : current,
    )
    // 🔴 The toggle passes keepDraft (review finding): hiding a product
    // must not silently revert a price the admin typed but had not saved.
    if (!options.keepDraft) {
      setDrafts((current) => {
        const { [product.id]: _dropped, ...rest } = current
        return rest
      })
      setDetailDrafts((current) => {
        const { [product.id]: _dropped, ...rest } = current
        return rest
      })
    }
  }

  /** ISSUE-153 — the full editor's draft machinery, the Draft pattern's twin. */
  function initialDetailDraft(row: AdminProductRow): DetailDraft {
    return {
      nameHe: row.nameHe,
      nameEn: row.nameEn,
      dosageForm: row.dosageForm,
      descriptionHe: row.descriptionHe,
      descriptionEn: row.descriptionEn,
      usageInstructions: row.usageInstructions,
      warningsAllergens: row.warningsAllergens,
      packageQuantity: String(row.packageQuantity),
      isKosher: claimValue(row.isKosher),
      isGlutenFree: claimValue(row.isGlutenFree),
      isVegan: claimValue(row.isVegan),
    }
  }

  function detailDraftFor(row: AdminProductRow): DetailDraft {
    return detailDrafts[row.id] ?? initialDetailDraft(row)
  }

  function setDetailDraft(row: AdminProductRow, patch: Partial<DetailDraft>) {
    setDetailDrafts((current) => ({
      ...current,
      [row.id]: { ...(current[row.id] ?? initialDetailDraft(row)), ...patch },
    }))
  }

  /** Changed-fields-only PATCH body — an omitted field is never overwritten. */
  function detailChanges(row: AdminProductRow): Record<string, unknown> {
    const draft = detailDraftFor(row)
    const base = initialDetailDraft(row)
    const body: Record<string, unknown> = {}
    for (const key of [
      'nameHe',
      'nameEn',
      'dosageForm',
      'descriptionHe',
      'descriptionEn',
      'usageInstructions',
      'warningsAllergens',
    ] as const) {
      if (draft[key] !== base[key]) body[key] = draft[key]
    }
    if (draft.packageQuantity !== base.packageQuantity) {
      // A blank travels as NaN → null on the wire; the server refuses BY
      // NAME (the create form's asNumber reasoning, verbatim).
      body.packageQuantity =
        draft.packageQuantity.trim() === '' ? Number.NaN : Number(draft.packageQuantity)
    }
    for (const key of DETAIL_DIETARY_KEYS) {
      if (draft[key] !== base[key]) body[key] = draft[key] === '' ? null : draft[key] === 'true'
    }
    return body
  }

  async function saveDetails(row: AdminProductRow) {
    if (busyId !== null) return
    const body = detailChanges(row)
    if (Object.keys(body).length === 0) return

    setBusyId(row.id)
    setFailureText('')
    const result = await patchAdminProduct(row.id, body)
    setBusyId(null)

    if (!result.ok) {
      if (result.failure.kind === 'invalid') {
        // ALL codes, not codes[0] — the create form's reasoning: one
        // response already names every problem.
        const codes = result.failure.codes
        setFailureText(
          codes.length > 0
            ? codes.map((code) => t([`products.errors.${code}`, 'products.failure.server'])).join(' ')
            : t('products.failure.server'),
        )
      } else {
        setFailureText(failureMessage(result.failure.kind))
      }
      return
    }
    replaceRow(result.product)
    announce(t('products.saved', { name: rowName(result.product) }))
  }

  function failureMessage(kind: string): string {
    if (kind === 'gone') return t('products.failure.gone')
    if (kind === 'rateLimited') return t('state.rateLimited')
    if (kind === 'offline') return t('state.offline')
    return t('products.failure.server')
  }

  async function saveRow(row: AdminProductRow) {
    if (busyId !== null) return
    const draft = draftFor(row)
    /*
     * 🔴 NO CLIENT PRE-CHECK, by the repo's own pattern (review finding —
     * RegisterPage submits and maps the server's named codes; a client
     * regex here was a second copy of the rule that would quietly become
     * the effective enforcer, §3.4's inversion). The server refuses with
     * PRICE_INVALID / STOCK_INVALID and the mapping below says so.
     *
     * 🔴 dirty and the body use the SAME string comparisons (review
     * finding: a semantic body under a string-compare `dirty` sent an
     * empty PATCH for '020' and earned NO_FIELDS on an enabled button).
     * A blank stock parses to null on the wire (JSON has no NaN), which
     * the server refuses BY NAME rather than reading as zero.
     */
    // ISSUE-152: "190" means ₪190.00 — completed BEFORE the dirty check so
    // typing the canonical value's shorthand over itself stays a no-op.
    const normalizedPrice = normalizePriceInput(draft.price)
    const priceChanged = normalizedPrice !== row.price
    const stockChanged = draft.stock !== String(row.stockQuantity)
    if (!priceChanged && !stockChanged) return

    setBusyId(row.id)
    setFailureText('')
    const result = await patchAdminProduct(row.id, {
      // Only what changed — an omitted field is never overwritten.
      ...(priceChanged ? { price: normalizedPrice } : {}),
      ...(stockChanged
        ? { stockQuantity: draft.stock.trim() === '' ? Number.NaN : Number(draft.stock) }
        : {}),
    })
    setBusyId(null)

    if (!result.ok) {
      if (result.failure.kind === 'invalid') {
        const code = result.failure.codes[0]
        // i18next key-fallback: an unmapped code degrades to the generic
        // message instead of a raw key (the JOIN_CLUB lesson, inverted).
        setFailureText(
          code ? t([`products.errors.${code}`, 'products.failure.server']) : t('products.failure.server'),
        )
      } else {
        setFailureText(failureMessage(result.failure.kind))
      }
      return
    }
    replaceRow(result.product)
    announce(t('products.saved', { name: rowName(result.product) }))
  }

  async function toggleActive(row: AdminProductRow) {
    if (busyId !== null) return
    setBusyId(row.id)
    setFailureText('')
    const result = await setAdminProductActive(row.id, !row.isActive)
    setBusyId(null)

    if (!result.ok) {
      setFailureText(
        result.failure.kind === 'invalid'
          ? t('products.failure.server')
          : failureMessage(result.failure.kind),
      )
      return
    }
    // keepDraft: an unsaved price/stock edit survives the toggle.
    replaceRow(result.product, { keepDraft: true })
    announce(
      result.product.isActive
        ? t('products.reactivated', { name: rowName(result.product) })
        : t('products.deactivated', { name: rowName(result.product) }),
    )
  }

  const language = i18n.language === 'he' ? 'he' : 'en'

  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="heading-page">{t('products.title')}</h1>
        <Link
          to="/admin/products/new"
          className={`${FOCUS_RING} flex min-h-11 items-center rounded-card bg-brand-teal px-4 text-sm font-medium text-white hover:bg-brand-teal-strong`}
        >
          {t('products.newCta')}
        </Link>
      </div>

      {/* DEC-088 O1, said where the editing happens rather than in a doc. */}
      <p className="mt-2 text-xs text-text-muted">{t('products.seedNote')}</p>

      <form onSubmit={onSearch} className="mt-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="admin-products-q" className="text-text-ink">
            {t('products.searchLabel')}
          </label>
          <input
            id="admin-products-q"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            // ISSUE-157: the single-frame search focus (border + halo, no
            // offset outline) — the same treatment the header search got.
            className="search-field h-11 w-64 rounded-card border border-border-control bg-well px-3"
          />
        </div>
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="admin-products-status" className="text-text-ink">
            {t('products.statusLabel')}
          </label>
          <select
            id="admin-products-status"
            value={statusFilter}
            onChange={(event) => {
              setPageNumber(1)
              setStatusFilter(event.target.value as 'all' | 'active' | 'inactive')
            }}
            className={`${FOCUS_RING} h-11 rounded-card border border-border-control bg-well px-3`}
          >
            <option value="all">{t('products.statusAll')}</option>
            <option value="active">{t('products.statusActive')}</option>
            <option value="inactive">{t('products.statusInactive')}</option>
          </select>
        </div>
        <Button type="submit" variant="secondary">
          {t('products.searchSubmit')}
        </Button>
      </form>

      {/* 🔴 ALWAYS MOUNTED — a live region that mounts with its message says
          nothing. Keyed so repeat outcomes re-announce. */}
      <p role="status" aria-live="polite" className="mt-3 text-sm text-brand-teal">
        {announced?.text ?? ''}
      </p>
      <p role="alert" className="mt-1 text-sm text-state-error">
        {failureText}
      </p>

      {state.status === 'loading' && (
        <p className="mt-6 text-text-muted">{t('products.loading')}</p>
      )}

      {state.status === 'failed' && (
        <div className="mt-6">
          <p className="text-text-ink">
            {state.failure.kind === 'notAdmin'
              ? t('state.notAdmin')
              : state.failure.kind === 'unauthenticated'
                ? t('state.unauthenticated')
                : state.failure.kind === 'rateLimited'
                  ? t('state.rateLimited')
                  : state.failure.kind === 'offline'
                    ? t('state.offline')
                    : t('products.failure.listUnavailable')}
          </p>
          {(state.failure.kind === 'unavailable' || state.failure.kind === 'offline') && (
            <Button
              type="button"
              variant="secondary"
              className="mt-3"
              onClick={() => void load(pageNumber, query, statusFilter)}
            >
              {t('state.retry')}
            </Button>
          )}
        </div>
      )}

      {state.status === 'ready' && state.page.products.length === 0 && (
        <p className="mt-6 text-text-muted">{t('products.empty')}</p>
      )}

      {state.status === 'ready' && state.page.products.length > 0 && (
        <>
          {/* Wide content scrolls in its own container — the page body never
              scrolls horizontally (browser-verification.md). */}
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border-hairline text-start">
                  <th scope="col" className="px-2 py-2 text-start font-semibold text-text-ink">
                    {t('products.columns.product')}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-semibold text-text-ink">
                    {t('products.columns.brand')}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-semibold text-text-ink">
                    {t('products.columns.price')}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-semibold text-text-ink">
                    {t('products.columns.stock')}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-semibold text-text-ink">
                    {t('products.columns.actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.page.products.map((row) => {
                  const draft = draftFor(row)
                  const busy = busyId === row.id
                  // The SAME normalization as save() — the dirty flag and
                  // the PATCH body must never disagree (this file's own
                  // NO_FIELDS lesson): "190" over "190.00" is NOT dirty.
                  const dirty =
                    normalizePriceInput(draft.price) !== row.price ||
                    draft.stock !== String(row.stockQuantity)
                  const detailOpen = detailId === row.id
                  // Review fix: only the ONE open row pays for its draft
                  // diff — computed per row per render, a keystroke on a
                  // full page churned 50×11 comparisons for rows whose
                  // editor is closed.
                  const detailDraft = detailOpen ? detailDraftFor(row) : null
                  const detailDirty = detailOpen && Object.keys(detailChanges(row)).length > 0
                  const detailAreaClass = `${FOCUS_RING} min-h-20 w-full rounded-card border border-border-control bg-well px-3 py-2`
                  const detailInputClass = `${FOCUS_RING} h-10 w-full rounded-card border border-border-control bg-well px-3`
                  return (
                    <Fragment key={row.id}>
                    <tr
                      className={`${detailOpen ? '' : 'border-b border-border-hairline'} align-top ${row.isActive ? '' : 'opacity-60'}`}
                    >
                      <td className="px-2 py-3">
                        <p
                          className={`font-medium text-text-ink ${row.isActive ? '' : 'line-through decoration-2'}`}
                        >
                          {language === 'he' ? row.nameHe : row.nameEn}
                        </p>
                        <p className="text-xs text-text-muted">
                          <span dir="ltr" style={{ unicodeBidi: 'isolate' }}>
                            {row.slug}
                          </span>
                        </p>
                        {/* Struck AND said in words — never strike-through alone. */}
                        {!row.isActive && (
                          <p className="text-xs font-medium text-state-error">
                            {t('products.inactiveBadge')}
                          </p>
                        )}
                      </td>
                      <td className="px-2 py-3 text-text-muted">
                        {row.brand.nameEn ?? row.brand.name}
                      </td>
                      <td className="px-2 py-3">
                        <label className="flex flex-col gap-1">
                          <span className="sr-only">
                            {t('products.priceInputLabel', { name: rowName(row) })}
                          </span>
                          <input
                            inputMode="decimal"
                            value={draft.price}
                            onChange={(event) => setDraft(row.id, { price: event.target.value }, row)}
                            aria-busy={busy || undefined}
                            className={`${FOCUS_RING} h-10 w-24 rounded-card border border-border-control bg-well px-2`}
                            dir="ltr"
                          />
                        </label>
                        <p className="mt-1 text-xs text-text-muted">
                          <PriceBlock price={row.price} />
                        </p>
                      </td>
                      <td className="px-2 py-3">
                        <label className="flex flex-col gap-1">
                          <span className="sr-only">
                            {t('products.stockInputLabel', { name: rowName(row) })}
                          </span>
                          <input
                            inputMode="numeric"
                            value={draft.stock}
                            onChange={(event) => setDraft(row.id, { stock: event.target.value }, row)}
                            aria-busy={busy || undefined}
                            className={`${FOCUS_RING} h-10 w-20 rounded-card border border-border-control bg-well px-2`}
                            dir="ltr"
                          />
                        </label>
                      </td>
                      <td className="px-2 py-3">
                        <div className="flex flex-wrap gap-2">
                          {/*
                            🔴 aria-disabled, never disabled: a natively
                            disabled focused button is BLURRED by Chromium
                            (the jsdom-vs-browser family), and the save
                            button must survive its own success.
                          */}
                          <Button
                            type="button"
                            variant="secondary"
                            loading={busy}
                            aria-disabled={!dirty || busy || undefined}
                            onClick={() => {
                              if (!dirty || busy) return
                              void saveRow(row)
                            }}
                          >
                            {t('products.save')}
                          </Button>
                          <Button
                            type="button"
                            variant={row.isActive ? 'danger' : 'secondary'}
                            loading={busy}
                            onClick={() => void toggleActive(row)}
                          >
                            {row.isActive ? t('products.deactivate') : t('products.reactivate')}
                          </Button>
                          {/* ISSUE-153 — the full editor's disclosure. The
                              button stays mounted through open/close and
                              through its row's own save (state-driven
                              label, aria-expanded carries the state). */}
                          <Button
                            type="button"
                            variant="secondary"
                            aria-expanded={detailOpen}
                            onClick={() => setDetailId(detailOpen ? null : row.id)}
                          >
                            {detailOpen ? t('products.editClose') : t('products.edit')}
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {detailOpen && (
                      <tr className="border-b border-border-hairline bg-surface-section/60">
                        <td colSpan={5} className="px-2 py-4">
                          <div className="grid gap-3 md:grid-cols-2">
                            <label className="flex flex-col gap-1 text-sm">
                              <span className="text-text-ink">{t('products.form.nameHe')}</span>
                              <input
                                value={detailDraft!.nameHe}
                                onChange={(e) => setDetailDraft(row, { nameHe: e.target.value })}
                                className={detailInputClass}
                              />
                            </label>
                            <label className="flex flex-col gap-1 text-sm">
                              <span className="text-text-ink">{t('products.form.nameEn')}</span>
                              <input
                                value={detailDraft!.nameEn}
                                onChange={(e) => setDetailDraft(row, { nameEn: e.target.value })}
                                className={detailInputClass}
                                dir="ltr"
                              />
                            </label>
                            {/* ISSUE-158 — the dosage form is finally
                                fixable (the PATCH schema gained the same
                                enum rule the create form runs). */}
                            <label className="flex flex-col gap-1 text-sm">
                              <span className="text-text-ink">{t('products.form.dosageForm')}</span>
                              <select
                                value={detailDraft!.dosageForm}
                                onChange={(e) => setDetailDraft(row, { dosageForm: e.target.value })}
                                className={`${FOCUS_RING} h-10 w-40 rounded-card border border-border-control bg-well px-2`}
                              >
                                {DOSAGE_FORM_KEYS.map((formName) => (
                                  <option key={formName} value={formName}>
                                    {t(`products.dosage.${formName}`)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="flex flex-col gap-1 text-sm">
                              <span className="text-text-ink">{t('products.form.descriptionHe')}</span>
                              <textarea
                                value={detailDraft!.descriptionHe}
                                onChange={(e) => setDetailDraft(row, { descriptionHe: e.target.value })}
                                className={detailAreaClass}
                              />
                            </label>
                            <label className="flex flex-col gap-1 text-sm">
                              <span className="text-text-ink">{t('products.form.descriptionEn')}</span>
                              <textarea
                                value={detailDraft!.descriptionEn}
                                onChange={(e) => setDetailDraft(row, { descriptionEn: e.target.value })}
                                className={detailAreaClass}
                                dir="ltr"
                              />
                            </label>
                            <label className="flex flex-col gap-1 text-sm">
                              <span className="text-text-ink">{t('products.form.usage')}</span>
                              <textarea
                                value={detailDraft!.usageInstructions}
                                onChange={(e) =>
                                  setDetailDraft(row, { usageInstructions: e.target.value })
                                }
                                className={detailAreaClass}
                              />
                            </label>
                            <label className="flex flex-col gap-1 text-sm">
                              <span className="text-text-ink">{t('products.form.warnings')}</span>
                              <textarea
                                value={detailDraft!.warningsAllergens}
                                onChange={(e) =>
                                  setDetailDraft(row, { warningsAllergens: e.target.value })
                                }
                                className={detailAreaClass}
                              />
                            </label>
                            <label className="flex flex-col gap-1 text-sm">
                              <span className="text-text-ink">{t('products.form.packageQuantity')}</span>
                              <input
                                inputMode="numeric"
                                value={detailDraft!.packageQuantity}
                                onChange={(e) =>
                                  setDetailDraft(row, { packageQuantity: e.target.value })
                                }
                                className={`${FOCUS_RING} h-10 w-32 rounded-card border border-border-control bg-well px-3`}
                                dir="ltr"
                              />
                              {/* The same ml/g cue the CREATE form carries — an
                                  admin editing an existing drops product must
                                  know the 250 is millilitres, not a count. */}
                              <span className="text-xs text-text-muted">
                                {t('products.form.packageQuantityHint')}
                              </span>
                            </label>
                            <fieldset className="flex flex-wrap gap-3 text-sm">
                              <legend className="mb-1 text-text-ink">
                                {t('products.form.dietary')}
                              </legend>
                              {DETAIL_DIETARY_KEYS.map((key) => (
                                <label key={key} className="flex flex-col gap-1">
                                  <span className="text-text-muted">{t(`products.form.${key}`)}</span>
                                  <select
                                    value={detailDraft![key]}
                                    onChange={(e) =>
                                      setDetailDraft(row, {
                                        [key]: e.target.value as '' | 'true' | 'false',
                                      })
                                    }
                                    className={`${FOCUS_RING} h-10 rounded-card border border-border-control bg-well px-2`}
                                  >
                                    <option value="">{t('products.form.claimNone')}</option>
                                    <option value="true">{t('products.form.claimYes')}</option>
                                    <option value="false">{t('products.form.claimNo')}</option>
                                  </select>
                                </label>
                              ))}
                            </fieldset>
                          </div>
                          <div className="mt-3 flex gap-2">
                            <Button
                              type="button"
                              loading={busy}
                              aria-disabled={!detailDirty || busy || undefined}
                              onClick={() => {
                                if (!detailDirty || busy) return
                                void saveDetails(row)
                              }}
                            >
                              {t('products.save')}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* The shared Pager (review) — one aria-disabled implementation
              for every admin list. */}
          <Pager
            page={state.page.page}
            totalPages={state.page.totalPages}
            onPage={setPageNumber}
          />
        </>
      )}
    </main>
  )
}
