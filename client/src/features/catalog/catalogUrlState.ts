/**
 * MILESTONE-005 Checkpoint G — pure client URL query-state for `/catalog`
 * (technical/MILESTONE_PLANS.md §5). No React, no hooks, no fetch, no
 * routing, no side effects. Same input -> same output, always.
 *
 * The URL is the SINGLE source of client query state — nothing here is
 * mirrored into React state. This module only parses a URL's query string
 * into a typed state and serializes a state back into a canonical query
 * string; wiring it to `useSearchParams`/navigation and to the server
 * response is Checkpoint H's job ("data layer"). Checkpoint I builds the
 * UI that calls into this module.
 *
 * 1:1 with §4's `GET /api/products` contract, minus `pageSize` (server-
 * fixed, never client-influenced) — same param names, same ID-valued
 * semantics (brand/ingredient/healthGoal carry opaque `Brand.id`/
 * `ActiveIngredient.id`/`HealthGoal.id` values, never display labels;
 * `category` carries the canonical slug, unchanged from DEC-043;
 * `dosageForm` carries the enum identifier). This module does not
 * validate those IDs/enum values beyond shape-level parsing — that is
 * the server's job (Checkpoints C/D); an invalid value is parsed through
 * faithfully so the eventual request 400s and the existing generic error
 * state handles it (§5: "other invalid params surface as the generic
 * error state").
 *
 * 🔴 Faithful pass-through is a whole-module guarantee, not a per-field
 * best-effort — every field either round-trips the caller's literal value
 * or is cleanly omitted; none is silently rewritten into a value the
 * caller never supplied. `page` is the one field that cannot be carried
 * as a raw string (its type is `number`, needed for §5a's arithmetic), so
 * `pageRaw` exists specifically to let a malformed page still round-trip
 * losslessly — see `parsePage`/`buildCatalogSearchParams` below.
 */

// §5 canonical order — q, category, brand*, dosageForm*, ingredient*,
// healthGoal*, minPrice, maxPrice, inStock, sort, page. Matches the exact
// order server/src/lib/catalogQuery.ts's FIELD_ORDER already uses for its
// own deterministic diagnostics — the two ends of the same contract agree.
const CANONICAL_PARAM_ORDER = [
  'q',
  'category',
  'brand',
  'dosageForm',
  'ingredient',
  'healthGoal',
  'minPrice',
  'maxPrice',
  'inStock',
  // DEC-078/DEC-083 — the three dietary filters, same literal-"true" contract
  // and faithful pass-through semantics as inStock.
  'kosher',
  'glutenFree',
  'vegan',
  'sort',
  'page',
] as const

export const DEFAULT_SORT = 'newest'
export const DEFAULT_PAGE = 1

export interface CatalogUrlState {
  q: string | undefined
  category: string | undefined
  brand: string[]
  dosageForm: string[]
  ingredient: string[]
  healthGoal: string[]
  minPrice: string | undefined
  maxPrice: string | undefined
  // Not narrowed to the literal "true" the server accepts (§4:
  // inStockSchema = z.literal('true')) — any other supplied value (e.g.
  // "false", "1") is parsed through faithfully rather than silently
  // mapped to `false`/omitted, so it still reaches the server and its
  // 400 INVALID_QUERY_PARAMETER surfaces the generic error state (§5).
  // `undefined` means the param was absent, not that it was "false".
  inStock: string | undefined
  // DEC-078/DEC-083 — same pass-through contract as inStock: `undefined`
  // means absent; any supplied literal is carried faithfully so a malformed
  // value surfaces as the server's 400 rather than being silently dropped.
  kosher: string | undefined
  glutenFree: string | undefined
  vegan: string | undefined
  // Not narrowed to the four frozen values — an unrecognized sort is
  // parsed through faithfully (see the module doc comment above) rather
  // than silently coerced to a default, which would hide a malformed URL
  // instead of letting the server's 400 surface it.
  sort: string
  page: number
  // The raw `page` string as supplied, preserved ONLY so a malformed page
  // (page: NaN) can round-trip losslessly through buildCatalogSearchParams
  // instead of emitting the literal "NaN" — see parsePage's doc comment.
  // Irrelevant whenever `page` is a valid integer; callers never need to
  // read it directly.
  pageRaw: string | undefined
}

export const EMPTY_CATALOG_URL_STATE: CatalogUrlState = {
  q: undefined,
  category: undefined,
  brand: [],
  dosageForm: [],
  ingredient: [],
  healthGoal: [],
  minPrice: undefined,
  maxPrice: undefined,
  inStock: undefined,
  kosher: undefined,
  glutenFree: undefined,
  vegan: undefined,
  sort: DEFAULT_SORT,
  page: DEFAULT_PAGE,
  pageRaw: undefined,
}

function firstValue(params: URLSearchParams, key: string): string | undefined {
  const value = params.get(key)
  return value === null ? undefined : value
}

// A raw string value is "present" only when it is defined and non-empty —
// an empty string (e.g. a cleared controlled input reporting `''`) is
// treated the same as absent, matching §5: "Defaults and empties omitted,
// so the default view is a bare /catalog." Applied uniformly to every
// free-text/opaque-string field (q, category, minPrice, maxPrice,
// inStock) so none of them can special-case emitting a bare `key=`.
export function isPresent(value: string | undefined): value is string {
  return value !== undefined && value.length > 0
}

// Parses a page value permissively — a well-formed positive integer
// becomes that number; anything else (absent, non-numeric, zero,
// negative, fractional) becomes NaN rather than silently defaulting to 1.
// The raw string is returned alongside it (see `pageRaw`) so a malformed
// page can still round-trip through buildCatalogSearchParams as the exact
// literal the caller supplied — this module never invents a "corrected"
// value, and it must not invent an uncorrected-looking one either (a bare
// `String(NaN)` would silently replace the caller's "abc" with "NaN").
function parsePage(raw: string | undefined): { page: number; pageRaw: string | undefined } {
  if (raw === undefined) return { page: DEFAULT_PAGE, pageRaw: undefined }
  if (/^[1-9]\d*$/.test(raw)) return { page: Number.parseInt(raw, 10), pageRaw: undefined }
  // Malformed — only now does the raw literal need to be carried forward.
  return { page: Number.NaN, pageRaw: raw }
}

/** Parses a `/catalog` URL's query string into typed catalogue state. */
export function parseCatalogUrlState(params: URLSearchParams): CatalogUrlState {
  const { page, pageRaw } = parsePage(firstValue(params, 'page'))
  return {
    q: firstValue(params, 'q'),
    category: firstValue(params, 'category'),
    brand: params.getAll('brand'),
    dosageForm: params.getAll('dosageForm'),
    ingredient: params.getAll('ingredient'),
    healthGoal: params.getAll('healthGoal'),
    minPrice: firstValue(params, 'minPrice'),
    maxPrice: firstValue(params, 'maxPrice'),
    inStock: firstValue(params, 'inStock'),
    kosher: firstValue(params, 'kosher'),
    glutenFree: firstValue(params, 'glutenFree'),
    vegan: firstValue(params, 'vegan'),
    sort: firstValue(params, 'sort') ?? DEFAULT_SORT,
    page,
    pageRaw,
  }
}

/**
 * Serializes catalogue state into a canonical query string — §5's frozen
 * field order, defaults and empties omitted (so the default view is a
 * bare `/catalog`, no `?sort=newest&page=1` noise). Repeated ID-valued
 * params are emitted as repeated keys, never comma-joined (§4/REQ-F-011).
 */
export function buildCatalogSearchParams(state: CatalogUrlState): URLSearchParams {
  const params = new URLSearchParams()

  for (const key of CANONICAL_PARAM_ORDER) {
    switch (key) {
      case 'q':
        if (isPresent(state.q)) params.append('q', state.q)
        break
      case 'category':
        if (isPresent(state.category)) params.append('category', state.category)
        break
      case 'brand':
        for (const value of state.brand) params.append('brand', value)
        break
      case 'dosageForm':
        for (const value of state.dosageForm) params.append('dosageForm', value)
        break
      case 'ingredient':
        for (const value of state.ingredient) params.append('ingredient', value)
        break
      case 'healthGoal':
        for (const value of state.healthGoal) params.append('healthGoal', value)
        break
      case 'minPrice':
        if (isPresent(state.minPrice)) params.append('minPrice', state.minPrice)
        break
      case 'maxPrice':
        if (isPresent(state.maxPrice)) params.append('maxPrice', state.maxPrice)
        break
      case 'inStock':
        if (isPresent(state.inStock)) params.append('inStock', state.inStock)
        break
      case 'kosher':
        if (isPresent(state.kosher)) params.append('kosher', state.kosher)
        break
      case 'glutenFree':
        if (isPresent(state.glutenFree)) params.append('glutenFree', state.glutenFree)
        break
      case 'vegan':
        if (isPresent(state.vegan)) params.append('vegan', state.vegan)
        break
      case 'sort':
        if (state.sort !== DEFAULT_SORT) params.append('sort', state.sort)
        break
      case 'page':
        if (Number.isInteger(state.page)) {
          if (state.page !== DEFAULT_PAGE) params.append('page', String(state.page))
        } else if (isPresent(state.pageRaw)) {
          // A malformed page (page is NaN) — preserve the caller's exact
          // literal rather than inventing "NaN" or silently dropping it.
          params.append('page', state.pageRaw)
        }
        break
    }
  }

  return params
}

/**
 * §5: "`page` resets to 1 whenever any other parameter changes; page
 * changes never touch other params." `changes` carries only the fields
 * being modified by this navigation (a filter toggle, a new search term,
 * a sort pick, or — exclusively — a page change). Returns the next full
 * state: when `changes` touches anything besides `page`, the result's
 * `page` is forced to 1 (and `pageRaw` cleared, since it would otherwise
 * describe a page that no longer applies) regardless of what
 * `changes.page` said (a caller should never pass both, but this makes
 * the rule hold even if one does).
 */
export function nextCatalogUrlState(
  current: CatalogUrlState,
  changes: Partial<CatalogUrlState>,
): CatalogUrlState {
  const changedKeys = Object.keys(changes) as (keyof CatalogUrlState)[]
  const isPageOnlyChange =
    changedKeys.length > 0 && changedKeys.every((key) => key === 'page' || key === 'pageRaw')

  const next: CatalogUrlState = { ...current, ...changes }

  if (!isPageOnlyChange) {
    next.page = DEFAULT_PAGE
    next.pageRaw = undefined
  }

  return next
}

/**
 * §5a — past-the-end page canonicalization, frozen. Pure arithmetic only:
 * decides WHETHER canonicalization is needed and WHAT the canonical state
 * is. Performing the actual `history.replaceState`-style navigation (never
 * push), re-entering the loading contract, and fetching the canonical page
 * are Checkpoint H's job (the data layer) — this function has no access to
 * navigation or fetch and cannot perform them.
 *
 * Returns `null` when no canonicalization applies:
 * - `totalItems === 0` (§4a: `totalItems === 0` -> `totalPages === 0`) —
 *   the zero-total convention explicitly forbids canonicalizing toward
 *   `totalPages === 0`, which would be nonsensical and could loop. The
 *   guard is `totalItems > 0`, never `page > totalPages` alone.
 * - `state.page` is not a valid integer (a malformed page reaching this
 *   function — e.g. after a build that never validated it) — §5a is a
 *   contract about a well-formed page landing past a real totalPages, not
 *   about correcting malformed input. Silently mapping a malformed page
 *   to `totalPages` would be exactly the kind of invented value this
 *   module forbids everywhere else; a malformed page is the server's 400
 *   to reject, not this function's to "fix."
 * - `requestedPage <= totalPages` — nothing to canonicalize.
 *
 * When canonicalization IS needed, every other query parameter is
 * preserved byte-for-byte — only `page` changes.
 */
export function canonicalizePastTheEndPage(
  state: CatalogUrlState,
  totalItems: number,
  totalPages: number,
): CatalogUrlState | null {
  if (totalItems === 0) return null
  if (!Number.isInteger(state.page)) return null
  if (state.page <= totalPages) return null

  return { ...state, page: totalPages, pageRaw: undefined }
}
